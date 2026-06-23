/**
 * Predictive cost engine (spec 6.2, 7.1, 7.2).
 *
 * Forecast token usage and per-model cost BEFORE a call is made: estimate input
 * tokens from the prompt and context, infer output tokens from the task class or
 * an explicit value, then cost every candidate in full-precision USD plus
 * integer micro-dollars. Every forecast carries the assumptions used so the
 * estimate is honestly labeled approximate.
 */

import {
  MODEL_CATALOG,
  resolveModel,
  TASK_CLASS_ROUTING,
  type ModelDefinition,
  type ProviderName,
} from '../catalog/model-catalog';
import type { TaskClass } from '../catalog/types';
import { calculateCostUsd, calculateCostMicros, DEFAULT_LLM_CONSTRAINTS } from '../cost/cost-calculator';
import { estimateTokens, DEFAULT_CHARS_PER_TOKEN } from '../cost/tokenizer';

export interface PredictInput {
  /** The prompt text; estimated via the tokenizer when token counts are absent. */
  prompt?: string;
  /** Known context already loaded (added to the estimated input tokens). */
  contextTokens?: number;
  /** Exact input tokens; when set, the prompt is not re-estimated. */
  inputTokens?: number;
  /** Exact output tokens; highest priority for the output estimate. */
  expectedOutputTokens?: number;
  /** Candidate models (alias or id). Defaults to all public chat-capable models. */
  candidates?: string[];
  /** Drives the default output cap and is echoed in assumptions. */
  taskClass?: TaskClass;
  charsPerToken?: number;
  includeLocal?: boolean;
}

export interface ModelForecast {
  model: string;
  provider: ProviderName;
  tier: string;
  predictedInputTokens: number;
  predictedOutputTokens: number;
  cost: { usd: number; usdMicros: number };
  assumptions: string[];
}

export interface PredictResult {
  forecasts: ModelForecast[];
  cheapest: ModelForecast | null;
  notes: string[];
}

/** Resolve the candidate model set, defaulting to public chat-capable models. */
function resolveCandidates(input: PredictInput): ModelDefinition[] {
  const includeLocal = input.includeLocal ?? false;
  if (input.candidates && input.candidates.length > 0) {
    const resolved: ModelDefinition[] = [];
    for (const name of input.candidates) {
      const m = resolveModel(name);
      if (m) resolved.push(m);
    }
    return resolved;
  }
  return Object.values(MODEL_CATALOG)
    .filter((m) => m.capabilities.has('chat'))
    .filter((m) => includeLocal || m.provider !== 'local');
}

/**
 * Estimate input tokens: exact when supplied, else tokenizer over the prompt
 * plus any known context tokens.
 */
function estimateInput(
  input: PredictInput,
  charsPerToken: number,
  assumptions: string[],
): { tokens: number; estimated: boolean } {
  const context = input.contextTokens ?? 0;
  if (typeof input.inputTokens === 'number') {
    const total = input.inputTokens + context;
    if (context > 0) assumptions.push(`Added ${context} known context tokens.`);
    return { tokens: total, estimated: false };
  }
  const fromPrompt = estimateTokens(input.prompt ?? '', charsPerToken);
  assumptions.push(
    `Input tokens estimated from prompt via ~${charsPerToken} chars/token heuristic (approximate).`,
  );
  if (context > 0) assumptions.push(`Added ${context} known context tokens.`);
  return { tokens: fromPrompt + context, estimated: true };
}

/**
 * Estimate output tokens per the priority: explicit value, then the task-class
 * output cap, then the model's own output cap, then the conservative default.
 */
function estimateOutput(
  input: PredictInput,
  model: ModelDefinition,
  assumptions: string[],
): number {
  if (typeof input.expectedOutputTokens === 'number') {
    return input.expectedOutputTokens;
  }
  if (input.taskClass) {
    const cap = TASK_CLASS_ROUTING[input.taskClass].outputCap;
    assumptions.push(`Output tokens from task class '${input.taskClass}' cap (${cap}).`);
    return cap;
  }
  if (typeof model.outputCap === 'number') {
    assumptions.push(`Output tokens from the model's output cap (${model.outputCap}).`);
    return model.outputCap;
  }
  assumptions.push(`Output tokens from the default ceiling (${DEFAULT_LLM_CONSTRAINTS.maxTokens}).`);
  return DEFAULT_LLM_CONSTRAINTS.maxTokens;
}

/** Forecast token usage and cost for each candidate, cheapest first. */
export function predictCost(input: PredictInput): PredictResult {
  const charsPerToken = input.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  const notes: string[] = [];
  const candidates = resolveCandidates(input);

  if (candidates.length === 0) {
    notes.push('No candidate models resolved.');
    return { forecasts: [], cheapest: null, notes };
  }

  /* Input tokens are model-independent; compute once and reuse. The explicit
     assumptions list is rebuilt per candidate so output-cap notes are accurate. */
  const inputProbe: string[] = [];
  const inputEstimate = estimateInput(input, charsPerToken, inputProbe);
  if (typeof input.expectedOutputTokens === 'number') {
    notes.push('Output tokens supplied explicitly.');
  }

  const forecasts: ModelForecast[] = candidates.map((model) => {
    const assumptions = [...inputProbe];
    if (!inputEstimate.estimated) assumptions.unshift('Input tokens supplied explicitly.');
    const outputTokens = estimateOutput(input, model, assumptions);
    const usd = calculateCostUsd(
      inputEstimate.tokens,
      outputTokens,
      model.pricing.inputPerMillion,
      model.pricing.outputPerMillion,
    );
    const usdMicros = calculateCostMicros(
      inputEstimate.tokens,
      outputTokens,
      model.pricing.inputPerMillion,
      model.pricing.outputPerMillion,
    );
    return {
      model: model.id,
      provider: model.provider,
      tier: model.tier,
      predictedInputTokens: inputEstimate.tokens,
      predictedOutputTokens: outputTokens,
      cost: { usd, usdMicros },
      assumptions,
    };
  });

  forecasts.sort((a, b) => a.cost.usd - b.cost.usd);
  return { forecasts, cheapest: forecasts[0] ?? null, notes };
}
