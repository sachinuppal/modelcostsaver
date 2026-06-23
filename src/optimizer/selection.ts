/**
 * Deterministic, explainable model selection.
 *
 * Given task constraints and a token shape, return the single cheapest model
 * that satisfies them, with the full reasoning trace, the runner-up, the
 * rejected candidates and why, and a cross-provider fallback chain. Pure: no
 * I/O, no env reads, no provider calls.
 *
 * The tier/capability/fallback primitives are reused from the catalog; the new
 * pieces here are the budget filter, the reasoning trace, and (with Task 3.5)
 * the two-axis client-aware availability scoping.
 */

import {
  MODEL_CATALOG,
  TIER_RANK,
  TASK_CLASS_ROUTING,
  getFallbackModel,
  getTerminalFallbackModel,
  type ModelDefinition,
  type ModelTier,
  type ModelCapability,
  type ProviderName,
} from '../catalog/model-catalog';
import type { TaskClass } from '../catalog/types';
import { calculateCostUsd, calculateCostMicros } from '../cost/cost-calculator';

/** Source of the resolved provider availability scope (spec 5.4). */
export type ScopeSource = 'arg' | 'env' | 'config' | 'client' | 'default-all';

export interface SelectInput {
  /** Explicit task class; overrides the heuristic and sets the target tier. */
  taskClass?: TaskClass;
  /** Target tier when the caller already knows it (used if no taskClass). */
  targetTier?: ModelTier;
  /** Tier floor. The resolved tier is raised to at least this by TIER_RANK. */
  minTier?: ModelTier;
  requiredCapabilities?: ModelCapability[];
  /** Single-provider bias (composes with the providers allowlist below). */
  preferredProvider?: ProviderName;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  /** Budget ceiling for the predicted call cost. */
  maxCostUsd?: number;
  /** Axis 1: provider availability allowlist (spec 5.4). */
  providers?: ProviderName[];
  /** Axis 2: what is being optimized. 'self' applies the client scope. */
  target?: 'self' | 'code';
  /** Pre-resolved Axis-1 scope from the client/env/config layer (Task 3.5). */
  providerScope?: ProviderName[];
  /** Source label for the resolved scope, echoed in the result. */
  scopeSource?: ScopeSource;
  includeLocal?: boolean;
}

export interface CostShape {
  usd: number;
  usdMicros: number;
}

export interface SelectedModel {
  model: string;
  provider: string;
  tier: string;
  predictedCost: CostShape;
}

export interface CheaperIfAvailable {
  model: string;
  provider: string;
  predictedCost: CostShape;
  reason: string;
}

export interface SelectResult {
  selected: SelectedModel | null;
  runnerUp?: { model: string; predictedCost: CostShape };
  rejected: { model: string; reason: string }[];
  reasoning: string[];
  fallbackChain: string[];
  budgetExceeded?: boolean;
  shortfallUsd?: number;
  /** Active provider availability scope (spec 5.4). */
  providerScope?: ProviderName[];
  scopeSource?: ScopeSource;
  /** A globally-cheaper model outside the actionable scope, surfaced honestly. */
  cheaperIfAvailable?: CheaperIfAvailable;
}

interface Forecast {
  model: ModelDefinition;
  usd: number;
  usdMicros: number;
}

const TIER_FALLBACK: ModelTier = 'standard';

function forecast(
  model: ModelDefinition,
  inputTokens: number,
  outputTokens: number,
): Forecast {
  return {
    model,
    usd: calculateCostUsd(
      inputTokens,
      outputTokens,
      model.pricing.inputPerMillion,
      model.pricing.outputPerMillion,
    ),
    usdMicros: calculateCostMicros(
      inputTokens,
      outputTokens,
      model.pricing.inputPerMillion,
      model.pricing.outputPerMillion,
    ),
  };
}

function asSelected(f: Forecast): SelectedModel {
  return {
    model: f.model.id,
    provider: f.model.provider,
    tier: f.model.tier,
    predictedCost: { usd: f.usd, usdMicros: f.usdMicros },
  };
}

/** Cost asc, then lower TIER_RANK (lowest sufficient tier) on a cost tie. */
function byCostThenTier(a: Forecast, b: Forecast): number {
  return a.usd - b.usd || TIER_RANK[a.model.tier] - TIER_RANK[b.model.tier];
}

/**
 * Resolve the target tier from the explicit task class, else an explicit target
 * tier, else a safe default. The result is raised to the minTier floor.
 */
function resolveTier(input: SelectInput, reasoning: string[]): ModelTier {
  let tier: ModelTier;
  if (input.taskClass) {
    tier = TASK_CLASS_ROUTING[input.taskClass].tier;
    reasoning.push(`Task class '${input.taskClass}' maps to tier '${tier}'.`);
  } else if (input.targetTier) {
    tier = input.targetTier;
    reasoning.push(`Target tier '${tier}' supplied by caller.`);
  } else {
    tier = TIER_FALLBACK;
    reasoning.push(`No task class or target tier given; defaulting to tier '${tier}'.`);
  }
  if (input.minTier && TIER_RANK[input.minTier] > TIER_RANK[tier]) {
    reasoning.push(`Raised tier to floor '${input.minTier}' (was '${tier}').`);
    tier = input.minTier;
  }
  return tier;
}

/**
 * The effective Axis-1 provider allowlist. Precedence within the caller's hands:
 * an explicit per-call `providers` arg wins, then a pre-resolved `providerScope`
 * (from the client/env/config layer, Task 3.5). When target is 'code', the
 * client-derived scope does not apply (the developer supplies the key in their
 * own app), so only an explicit `providers` arg narrows the set.
 */
function effectiveProviderScope(input: SelectInput): {
  scope: ProviderName[] | undefined;
  source: ScopeSource | undefined;
} {
  if (input.providers && input.providers.length > 0) {
    return { scope: input.providers, source: 'arg' };
  }
  if (input.target === 'code') {
    return { scope: undefined, source: undefined };
  }
  if (input.providerScope && input.providerScope.length > 0) {
    return { scope: input.providerScope, source: input.scopeSource ?? 'client' };
  }
  return { scope: undefined, source: input.scopeSource };
}

function localEligible(m: ModelDefinition, includeLocal: boolean): boolean {
  return m.provider !== 'local' || includeLocal;
}

function hasAllCapabilities(m: ModelDefinition, required: ModelCapability[]): boolean {
  return required.every((c) => m.capabilities.has(c));
}

/**
 * Build the candidate set: tier at or above the target (degrade up, never
 * below), capabilities superset of required, preferred-provider bias, and
 * local-gating. The Axis-1 scope filter is applied separately so the
 * globally-cheapest (pre-scope) model can still be surfaced as cheaperIfAvailable.
 */
function buildCandidates(
  input: SelectInput,
  targetTier: ModelTier,
  required: ModelCapability[],
): ModelDefinition[] {
  const includeLocal = input.includeLocal ?? false;
  const targetRank = TIER_RANK[targetTier];
  return Object.values(MODEL_CATALOG)
    .filter((m) => TIER_RANK[m.tier] >= targetRank)
    .filter((m) => hasAllCapabilities(m, required))
    .filter((m) => (input.preferredProvider ? m.provider === input.preferredProvider : true))
    .filter((m) => localEligible(m, includeLocal));
}

/** Deterministic budget-aware model selection. */
export function selectOptimalModel(input: SelectInput): SelectResult {
  const reasoning: string[] = [];
  const required = input.requiredCapabilities ?? [];

  const targetTier = resolveTier(input, reasoning);
  if (required.length > 0) {
    reasoning.push(`Required capabilities: ${[...required].sort().join(', ')}.`);
  } else {
    reasoning.push('No capability requirements beyond the default chat baseline.');
  }

  /* Pre-scope candidate set (tier + capabilities + preferred provider + local). */
  const preScope = buildCandidates(input, targetTier, required);

  /* Axis 1: apply the provider availability scope, if any. */
  const { scope, source } = effectiveProviderScope(input);
  let candidates = preScope;
  if (scope) {
    candidates = preScope.filter((m) => scope.includes(m.provider));
    reasoning.push(
      `Availability scope: ${[...scope].sort().join(', ')} (${source ?? 'arg'}).`,
    );
  } else if (source) {
    reasoning.push(`Availability scope: all providers (${source}).`);
  }

  if (candidates.length === 0) {
    reasoning.push('No model satisfies the tier, capability, and provider constraints.');
    return {
      selected: null,
      rejected: [],
      reasoning,
      fallbackChain: [],
      providerScope: scope,
      scopeSource: source,
    };
  }

  /* Forecast every candidate, then split by the budget ceiling. */
  const forecasts = candidates
    .map((m) => forecast(m, input.estimatedInputTokens, input.estimatedOutputTokens))
    .sort(byCostThenTier);

  const rejected: { model: string; reason: string }[] = [];
  let survivors = forecasts;
  if (typeof input.maxCostUsd === 'number') {
    survivors = [];
    for (const f of forecasts) {
      if (f.usd > input.maxCostUsd) {
        rejected.push({
          model: f.model.id,
          reason: `predicted $${f.usd.toFixed(6)} exceeds budget $${input.maxCostUsd.toFixed(6)}`,
        });
      } else {
        survivors.push(f);
      }
    }
    reasoning.push(
      `Filtered ${forecasts.length} candidate(s) by budget $${input.maxCostUsd.toFixed(6)}: ${survivors.length} survive.`,
    );
  }

  /* Empty-survivor path: everything is over budget. Return the single cheapest
     overall (ignoring budget) so the caller can decide, flagged honestly. */
  if (survivors.length === 0) {
    const cheapest = forecasts[0];
    const shortfallUsd = cheapest.usd - (input.maxCostUsd ?? 0);
    reasoning.push(
      `All candidates exceed the budget; returning the cheapest overall (${cheapest.model.id}) with a $${shortfallUsd.toFixed(6)} shortfall.`,
    );
    return {
      selected: asSelected(cheapest),
      rejected,
      reasoning,
      fallbackChain: buildFallbackChain(cheapest.model.id),
      budgetExceeded: true,
      shortfallUsd,
      providerScope: scope,
      scopeSource: source,
      cheaperIfAvailable: computeCheaperIfAvailable(input, scope, preScope, cheapest),
    };
  }

  const winner = survivors[0];
  const runnerUp = survivors[1];
  reasoning.push(
    `Cheapest survivor: ${winner.model.id} ($${winner.usd.toFixed(6)}) at tier '${winner.model.tier}'.`,
  );
  if (winner.model.tier !== targetTier) {
    reasoning.push(
      `Degraded up from target tier '${targetTier}' to '${winner.model.tier}' (no cheaper candidate met the requirements at the target tier).`,
    );
  }

  return {
    selected: asSelected(winner),
    runnerUp: runnerUp
      ? { model: runnerUp.model.id, predictedCost: { usd: runnerUp.usd, usdMicros: runnerUp.usdMicros } }
      : undefined,
    rejected,
    reasoning,
    fallbackChain: buildFallbackChain(winner.model.id),
    providerScope: scope,
    scopeSource: source,
    cheaperIfAvailable: computeCheaperIfAvailable(input, scope, preScope, winner),
  };
}

/**
 * When an Axis-1 scope hid a globally-cheaper model, surface it honestly so the
 * agent can act on it (for example by passing target=code). Returns undefined
 * when no scope is active or nothing cheaper exists outside it.
 */
function computeCheaperIfAvailable(
  input: SelectInput,
  scope: ProviderName[] | undefined,
  preScope: ModelDefinition[],
  winner: Forecast,
): CheaperIfAvailable | undefined {
  if (!scope) return undefined;
  const outside = preScope
    .filter((m) => !scope.includes(m.provider))
    .map((m) => forecast(m, input.estimatedInputTokens, input.estimatedOutputTokens))
    .sort(byCostThenTier);
  const cheaper = outside.find((f) => f.usd < winner.usd);
  if (!cheaper) return undefined;
  const scoped = [...scope].sort().join(', ');
  return {
    model: cheaper.model.id,
    provider: cheaper.model.provider,
    predictedCost: { usd: cheaper.usd, usdMicros: cheaper.usdMicros },
    reason: `not available in this client (${scoped}-scoped); pass target=code if this is for an app you are building`,
  };
}

/** [winner, alternate-provider fallback, terminal local fallback] deduped. */
function buildFallbackChain(winnerId: string): string[] {
  const chain = [winnerId];
  const fb = getFallbackModel(winnerId);
  if (fb) chain.push(fb.id);
  const terminal = getTerminalFallbackModel();
  if (terminal) chain.push(terminal.id);
  return [...new Set(chain)];
}
