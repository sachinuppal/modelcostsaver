/**
 * "Can I do better?" optimization (spec 6.6).
 *
 * Given a model the caller plans to use and a token shape, find the cheapest
 * model that still meets the task tier and report the savings. Default behavior
 * is same-provider (switching providers needs a different API key); crossProvider
 * widens the search to all providers. Pure: no I/O.
 */

import {
  MODEL_CATALOG,
  resolveModel,
  TIER_RANK,
  TASK_CLASS_ROUTING,
  type ModelDefinition,
  type ModelTier,
  type ProviderName,
} from '../catalog/model-catalog';
import type { TaskClass } from '../catalog/types';
import { calculateCostUsd, calculateCostMicros } from '../cost/cost-calculator';

export interface OptimizeInput {
  currentModel: string;
  inputTokens: number;
  outputTokens: number;
  /** Task class; sets the tier floor the recommendation must still meet. */
  taskClass?: TaskClass;
  /** When false (default), only the current model's provider is considered. */
  crossProvider?: boolean;
  /**
   * Availability allowlist (spec 5.4). When set, candidates are restricted to
   * these providers; composes with crossProvider so a cross-provider search for
   * the agent's own inference stays within what this client can actually invoke.
   * The current model's own provider is always permitted so a same-provider
   * recommendation is never filtered out.
   */
  allowedProviders?: ProviderName[];
  includeLocal?: boolean;
}

export interface OptimizeCost {
  model: string;
  provider: ProviderName;
  tier: string;
  usd: number;
  usdMicros: number;
}

export interface OptimizeResult {
  current: OptimizeCost | null;
  recommended: OptimizeCost | null;
  savingsUsd: number;
  savingsPct: number;
  reasoning: string[];
  /** True when the current model is already the cheapest capable option. */
  alreadyOptimal: boolean;
  /** The unknown model id when currentModel does not resolve. */
  unknownModel?: string;
}

function toCost(m: ModelDefinition, inTok: number, outTok: number): OptimizeCost {
  return {
    model: m.id,
    provider: m.provider,
    tier: m.tier,
    usd: calculateCostUsd(inTok, outTok, m.pricing.inputPerMillion, m.pricing.outputPerMillion),
    usdMicros: calculateCostMicros(inTok, outTok, m.pricing.inputPerMillion, m.pricing.outputPerMillion),
  };
}

/**
 * Find the cheapest capable alternative to currentModel and quantify the saving.
 * The recommendation tier floor is max(currentModel.tier, taskClass.tier) so the
 * suggestion never drops below either the model's class or the task's needs.
 */
export function optimizeRequest(input: OptimizeInput): OptimizeResult {
  const reasoning: string[] = [];
  const current = resolveModel(input.currentModel);
  if (!current) {
    return {
      current: null,
      recommended: null,
      savingsUsd: 0,
      savingsPct: 0,
      reasoning: [`Unknown model '${input.currentModel}'.`],
      alreadyOptimal: false,
      unknownModel: input.currentModel,
    };
  }

  const includeLocal = input.includeLocal ?? false;
  const crossProvider = input.crossProvider ?? false;

  /*
   * Tier floor = the quality bar the recommendation must still meet. When a task
   * class is given, the bar is the TASK tier (the point of the tool is to find
   * over-provisioning: an opus call for a 'summarise' task should drop to the
   * fast tier). With no task signal, the only safe bar is the current model's
   * own tier, so the recommendation is never weaker than what the caller chose.
   */
  let floorTier: ModelTier;
  if (input.taskClass) {
    floorTier = TASK_CLASS_ROUTING[input.taskClass].tier;
    reasoning.push(
      `Task class '${input.taskClass}' sets the quality bar at tier '${floorTier}'.`,
    );
  } else {
    floorTier = current.tier;
    reasoning.push(`No task class; the recommendation must meet the current tier '${floorTier}'.`);
  }

  if (crossProvider) {
    reasoning.push('Cross-provider search enabled (a switch may need a different API key).');
  } else {
    reasoning.push(`Same-provider search (provider '${current.provider}').`);
  }

  /* Availability allowlist (spec 5.4); the current model's provider is always
     allowed so a same-provider recommendation survives the filter. */
  const allowed = input.allowedProviders;
  if (allowed && allowed.length > 0) {
    reasoning.push(`Availability scope: ${[...allowed].sort().join(', ')}.`);
  }
  const providerAllowed = (p: ProviderName): boolean =>
    !allowed || allowed.length === 0 || allowed.includes(p) || p === current.provider;

  /*
   * Candidate set = models at or above the tier floor, within the provider
   * constraints. Capabilities are intentionally NOT filtered against the current
   * model here: the quality bar is the tier, and a task that needed a specific
   * capability would be expressed through select_optimal_model.
   */
  const floorRank = TIER_RANK[floorTier];
  const candidates = Object.values(MODEL_CATALOG)
    .filter((m) => TIER_RANK[m.tier] >= floorRank)
    .filter((m) => (crossProvider ? true : m.provider === current.provider))
    .filter((m) => providerAllowed(m.provider))
    .filter((m) => m.provider !== 'local' || includeLocal);

  const currentCost = toCost(current, input.inputTokens, input.outputTokens);

  const priced = candidates
    .map((m) => toCost(m, input.inputTokens, input.outputTokens))
    .sort((a, b) => a.usd - b.usd || TIER_RANK[a.tier as ModelTier] - TIER_RANK[b.tier as ModelTier]);

  const cheapest = priced[0] ?? currentCost;

  /* Already optimal when nothing is cheaper than the current model. */
  if (cheapest.usd >= currentCost.usd) {
    reasoning.push(`${current.id} is already the cheapest capable option at this tier.`);
    return {
      current: currentCost,
      recommended: currentCost,
      savingsUsd: 0,
      savingsPct: 0,
      reasoning,
      alreadyOptimal: true,
    };
  }

  const savingsUsd = currentCost.usd - cheapest.usd;
  const savingsPct = currentCost.usd > 0 ? (savingsUsd / currentCost.usd) * 100 : 0;
  reasoning.push(
    `${cheapest.model} costs $${cheapest.usd.toFixed(6)} vs $${currentCost.usd.toFixed(6)} for ${current.id}: save $${savingsUsd.toFixed(6)} (${savingsPct.toFixed(1)}%).`,
  );

  return {
    current: currentCost,
    recommended: cheapest,
    savingsUsd,
    savingsPct,
    reasoning,
    alreadyOptimal: false,
  };
}
