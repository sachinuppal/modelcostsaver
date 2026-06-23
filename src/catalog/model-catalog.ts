/**
 * Model catalog: single source of truth for LLM model ids, aliases, providers,
 * capabilities, and pricing.
 *
 * No model strings should appear outside this file. Add a new entry to
 * MODEL_CATALOG, then resolve by alias or full id via resolveModel().
 *
 * Pricing is per 1M tokens in USD. The cost layer converts to full-precision
 * USD plus integer micro-dollars at estimate time.
 */

import type {
  ProviderName,
  ModelTier,
  ModelCapability,
  ModelDefinition,
  TaskClass,
  TaskClassRoute,
} from './types';

export type {
  ProviderName,
  ModelTier,
  ModelCapability,
  ModelDefinition,
  TaskClassRoute,
} from './types';

export const MODEL_CATALOG: Record<string, ModelDefinition> = {
  'claude-haiku-4-5-20251001': {
    id: 'claude-haiku-4-5-20251001',
    alias: 'haiku',
    provider: 'anthropic',
    tier: 'fast',
    capabilities: new Set(['chat', 'tools', 'streaming']),
    pricing: { inputPerMillion: 1.0, outputPerMillion: 5.0 },
  },
  'claude-sonnet-4-6': {
    id: 'claude-sonnet-4-6',
    alias: 'sonnet',
    provider: 'anthropic',
    tier: 'standard',
    capabilities: new Set(['chat', 'tools', 'vision', 'streaming']),
    pricing: { inputPerMillion: 3, outputPerMillion: 15 },
  },
  /* Latest Opus generation. The bare alias 'opus' resolves here, so any caller
     resolving 'opus' gets 4.8. Listed before 4.7 so equal-priced reasoning-tier
     selection prefers the latest. */
  'claude-opus-4-8': {
    id: 'claude-opus-4-8',
    alias: 'opus',
    provider: 'anthropic',
    tier: 'reasoning',
    capabilities: new Set(['chat', 'tools', 'vision', 'streaming']),
    pricing: { inputPerMillion: 5, outputPerMillion: 25 },
  },
  /* Previous Opus generation, retained as an explicitly selectable model via
     alias 'opus-4-7' or its full id. Not the bare 'opus' alias. */
  'claude-opus-4-7': {
    id: 'claude-opus-4-7',
    alias: 'opus-4-7',
    provider: 'anthropic',
    tier: 'reasoning',
    capabilities: new Set(['chat', 'tools', 'vision', 'streaming']),
    pricing: { inputPerMillion: 5, outputPerMillion: 25 },
  },

  /* Gemini 2.5 Flash Lite: cheapest model floor for trivial tasks. Gate
     classifiers, slot filling, binary decisions. Note: no tools capability. */
  'gemini-2.5-flash-lite': {
    id: 'gemini-2.5-flash-lite',
    alias: 'gemini-flash-lite',
    provider: 'gemini',
    tier: 'trivial',
    capabilities: new Set(['chat', 'streaming']),
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.4 },
    outputCap: 100,
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    alias: 'gemini-flash',
    provider: 'gemini',
    tier: 'fast',
    capabilities: new Set(['chat', 'tools', 'vision', 'streaming']),
    pricing: { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  },
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    alias: 'gemini-pro',
    provider: 'gemini',
    tier: 'standard',
    capabilities: new Set(['chat', 'tools', 'vision', 'streaming']),
    pricing: { inputPerMillion: 1.25, outputPerMillion: 10.0 },
  },

  'gpt-4.1-mini': {
    id: 'gpt-4.1-mini',
    alias: 'gpt-mini',
    provider: 'openai',
    tier: 'fast',
    capabilities: new Set(['chat', 'tools', 'vision', 'streaming']),
    pricing: { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  },
  'gpt-4.1': {
    id: 'gpt-4.1',
    alias: 'gpt',
    provider: 'openai',
    tier: 'standard',
    capabilities: new Set(['chat', 'tools', 'vision', 'streaming']),
    pricing: { inputPerMillion: 2.0, outputPerMillion: 8.0 },
  },
  o3: {
    id: 'o3',
    alias: 'o3',
    provider: 'openai',
    tier: 'reasoning',
    capabilities: new Set(['chat', 'tools', 'streaming']),
    pricing: { inputPerMillion: 2, outputPerMillion: 8 },
  },

  /*
   * Local / self-hosted models served at zero price. Excluded from tier
   * auto-selection unless explicitly included (getModelForTier filters local out
   * unless 'local' is the preferred provider, or includeLocal is set), so a
   * default install never surfaces them. local-fast / local-standard are
   * retained so getTerminalFallbackModel resolves local-standard as the terminal
   * fallback. Default distribution prefers permissive weights; license is
   * recorded for informational purposes only.
   */
  'local-fast': {
    id: 'local-fast',
    alias: 'local-fast',
    provider: 'local',
    tier: 'fast',
    capabilities: new Set(['chat', 'tools', 'streaming']),
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
  },
  'local-standard': {
    id: 'local-standard',
    alias: 'local',
    provider: 'local',
    tier: 'standard',
    capabilities: new Set(['chat', 'tools', 'streaming']),
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
  },
};

const ALIAS_INDEX = new Map<string, ModelDefinition>();
for (const model of Object.values(MODEL_CATALOG)) {
  ALIAS_INDEX.set(model.alias, model);
  ALIAS_INDEX.set(model.id, model);
}

export function resolveModel(nameOrAlias: string): ModelDefinition | undefined {
  return ALIAS_INDEX.get(nameOrAlias) || ALIAS_INDEX.get(nameOrAlias.toLowerCase());
}

/**
 * Whether a model is eligible given local-gating. Local models are excluded
 * unless explicitly preferred or includeLocal is set.
 */
function localEligible(
  m: ModelDefinition,
  preferredProvider: ProviderName | undefined,
  includeLocal: boolean,
): boolean {
  if (m.provider !== 'local') return true;
  return preferredProvider === 'local' || includeLocal;
}

export function getModelForTier(
  tier: ModelTier,
  preferredProvider?: ProviderName,
  includeLocal = false,
): ModelDefinition {
  const candidates = Object.values(MODEL_CATALOG)
    .filter((m) => m.tier === tier)
    .filter((m) => (preferredProvider ? m.provider === preferredProvider : true))
    .filter((m) => localEligible(m, preferredProvider, includeLocal))
    .sort((a, b) => a.pricing.inputPerMillion - b.pricing.inputPerMillion);

  return candidates[0] || Object.values(MODEL_CATALOG)[0];
}

export function getModelsWithCapability(
  capability: ModelCapability,
  tier?: ModelTier,
  includeLocal = false,
): ModelDefinition[] {
  return Object.values(MODEL_CATALOG)
    .filter((m) => m.capabilities.has(capability))
    .filter((m) => !tier || m.tier === tier)
    .filter((m) => localEligible(m, undefined, includeLocal));
}

export function modelSupports(modelId: string, capability: ModelCapability): boolean {
  const model = resolveModel(modelId);
  return model?.capabilities.has(capability) ?? false;
}

export function getProviderForModel(modelId: string): ProviderName | undefined {
  return resolveModel(modelId)?.provider;
}

/**
 * Tier capability ordering (cheap/weak to expensive/strong). Used to degrade UP
 * when an alternate provider has no peer at the primary's exact tier, never
 * down, so a failover cannot silently route to a weaker model.
 */
export const TIER_RANK: Record<ModelTier, number> = {
  trivial: 0,
  fast: 1,
  standard: 2,
  reasoning: 3,
};

/**
 * Alternate-provider failover target for a model.
 *
 * Prefers an exact same-tier peer. When the alternate provider has NO model at
 * the primary's tier (for example the Gemini-only 'trivial' tier), it degrades
 * UP to the cheapest alternate model at the nearest higher tier. Degrading up
 * (never down) means a routing call can be answered by a stronger model, never a
 * weaker one.
 */
export function getFallbackModel(modelId: string): ModelDefinition | undefined {
  const primary = resolveModel(modelId);
  if (!primary) return undefined;

  const alternate: ProviderName = primary.provider === 'anthropic' ? 'gemini' : 'anthropic';
  const primaryRank = TIER_RANK[primary.tier];

  const candidates = Object.values(MODEL_CATALOG)
    .filter((m) => m.provider === alternate && TIER_RANK[m.tier] >= primaryRank)
    .sort(
      (a, b) =>
        TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
        a.pricing.inputPerMillion - b.pricing.inputPerMillion,
    );

  return candidates[0];
}

/**
 * Terminal local fallback model. Returned after the cloud providers are
 * exhausted. Undefined when no local model is registered.
 */
export function getTerminalFallbackModel(): ModelDefinition | undefined {
  const locals = Object.values(MODEL_CATALOG).filter((m) => m.provider === 'local');
  return locals.find((m) => m.tier === 'standard') ?? locals[0];
}

/**
 * Single source of truth for task-class routing. Each TaskClass maps to a
 * default model tier and an output token cap that bounds generation.
 */
export const TASK_CLASS_ROUTING: Record<TaskClass, TaskClassRoute> = {
  slot_fill: { tier: 'trivial', outputCap: 50 },
  classify_route: { tier: 'trivial', outputCap: 20 },
  draft_short: { tier: 'fast', outputCap: 200 },
  summarise: { tier: 'fast', outputCap: 800 },
  plan_decompose: { tier: 'standard', outputCap: 2000 },
  synthesise: { tier: 'standard', outputCap: 4000 },
  reason_hard: { tier: 'reasoning', outputCap: 8000 },
  gate_safety: { tier: 'trivial', outputCap: 20 },
};

/** All task-class labels in declaration order. */
export const TASK_CLASSES = Object.keys(TASK_CLASS_ROUTING) as TaskClass[];

/** Resolved tier plus output cap for a task class. */
export function getTaskClassRoute(taskClass: TaskClass): TaskClassRoute {
  return TASK_CLASS_ROUTING[taskClass];
}
