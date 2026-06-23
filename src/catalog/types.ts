/**
 * Shared catalog types. Provider, tier, and capability unions plus the
 * task-class union that drives default tier and output-cap routing.
 *
 * TaskClass is inlined here (rather than imported from a framework module) so
 * the catalog stays a self-contained, dependency-free layer.
 */

export type ProviderName = 'anthropic' | 'gemini' | 'openai' | 'local';
export type ModelTier = 'trivial' | 'fast' | 'standard' | 'reasoning';
export type ModelCapability = 'chat' | 'tools' | 'vision' | 'streaming';

/**
 * Task-class labels for capability-based model routing. Each maps to a default
 * model tier and an output token cap that bounds generation.
 */
export type TaskClass =
  | 'slot_fill'
  | 'classify_route'
  | 'draft_short'
  | 'summarise'
  | 'plan_decompose'
  | 'synthesise'
  | 'reason_hard'
  | 'gate_safety';

/** Resolved tier plus output token cap for a task class. */
export interface TaskClassRoute {
  tier: ModelTier;
  outputCap: number;
}

export interface ModelDefinition {
  id: string;
  alias: string;
  provider: ProviderName;
  tier: ModelTier;
  capabilities: Set<ModelCapability>;
  pricing: { inputPerMillion: number; outputPerMillion: number };
  /** Per-task output token cap. Bounds runaway generation in task-class routing. */
  outputCap?: number;
  /**
   * SPDX-style license of the weights (local/self-hosted models only).
   * Informational metadata; never used for routing.
   */
  license?: string;
}
