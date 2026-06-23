/**
 * estimate_cost (spec 6.1): cost of a single call for one model when token
 * counts are known (or can be estimated from text). Read-only, offline.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resolveModel } from '../catalog/model-catalog';
import {
  calculateCostUsd,
  calculateCostMicros,
  CostCalculator,
  DEFAULT_LLM_CONSTRAINTS,
} from '../cost/cost-calculator';
import { estimateTokens } from '../cost/tokenizer';
import type { ToolContext } from '../server/context.js';
import { ok, fail, fmtUsd, type ToolResult } from './shared.js';

const inputSchema = {
  model: z.string().describe('Model alias or full id, e.g. "sonnet" or "claude-sonnet-4-6".'),
  inputTokens: z.number().int().nonnegative().optional().describe('Exact input tokens; optional if inputText is given.'),
  outputTokens: z.number().int().nonnegative().optional().describe('Exact output tokens; defaults to the model output cap.'),
  inputText: z.string().max(2_000_000).optional().describe('Prompt text; estimated to tokens if inputTokens is absent.'),
  expectedOutputText: z.string().max(2_000_000).optional().describe('Expected output text; estimated if outputTokens is absent.'),
  charsPerToken: z.number().positive().optional().describe('Override the chars-per-token heuristic divisor.'),
};

const outputSchema = {
  model: z.string(),
  provider: z.string(),
  tier: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  tokensWereEstimated: z.boolean(),
  cost: z.object({ usd: z.number(), usdMicros: z.number(), cents: z.number() }),
  breakdown: z.object({ inputUsd: z.number(), outputUsd: z.number() }),
  pricing: z.object({ inputPerMillion: z.number(), outputPerMillion: z.number() }),
  catalogVersion: z.string(),
  asOf: z.string(),
};

type EstimateArgs = {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  inputText?: string;
  expectedOutputText?: string;
  charsPerToken?: number;
};

export function registerEstimateCostTool(server: McpServer, context: ToolContext): void {
  server.registerTool(
    'estimate_cost',
    {
      title: 'Estimate cost',
      description:
        'Estimate the cost of a single LLM call for one model from known or estimated token counts. Offline, no keys.',
      inputSchema,
      outputSchema,
    },
    (args: EstimateArgs): ToolResult => {
      const model = resolveModel(args.model);
      if (!model) return fail(`Unknown model '${args.model}'.`, 'unknown_model');

      const charsPerToken = args.charsPerToken ?? context.config.charsPerToken;

      let inputTokens: number;
      let estimated = false;
      if (typeof args.inputTokens === 'number') {
        inputTokens = args.inputTokens;
      } else if (typeof args.inputText === 'string') {
        inputTokens = estimateTokens(args.inputText, charsPerToken);
        estimated = true;
      } else {
        return fail('Provide inputTokens or inputText.', 'missing_input');
      }

      let outputTokens: number;
      if (typeof args.outputTokens === 'number') {
        outputTokens = args.outputTokens;
      } else if (typeof args.expectedOutputText === 'string') {
        outputTokens = estimateTokens(args.expectedOutputText, charsPerToken);
        estimated = true;
      } else {
        /* No output signal: use the model output cap, else the conservative default. */
        outputTokens = model.outputCap ?? DEFAULT_LLM_CONSTRAINTS.maxTokens;
        estimated = true;
      }

      const { inputPerMillion, outputPerMillion } = model.pricing;
      const inputUsd = calculateCostUsd(inputTokens, 0, inputPerMillion, outputPerMillion);
      const outputUsd = calculateCostUsd(0, outputTokens, inputPerMillion, outputPerMillion);
      const usd = inputUsd + outputUsd;
      const usdMicros = calculateCostMicros(inputTokens, outputTokens, inputPerMillion, outputPerMillion);

      const structured = {
        model: model.id,
        provider: model.provider,
        tier: model.tier,
        inputTokens,
        outputTokens,
        tokensWereEstimated: estimated,
        cost: { usd, usdMicros, cents: CostCalculator.usdToCents(usd) },
        breakdown: { inputUsd, outputUsd },
        pricing: { inputPerMillion, outputPerMillion },
        catalogVersion: context.catalogMeta.catalogVersion,
        asOf: context.catalogMeta.asOf,
      };

      const text =
        `${model.id} (${model.provider}, ${model.tier}): ${fmtUsd(usd)} ` +
        `for ${inputTokens} in / ${outputTokens} out` +
        `${estimated ? ' (tokens estimated)' : ''}. ` +
        `Catalog ${context.catalogMeta.catalogVersion}.`;

      return ok(text, structured);
    },
  );
}
