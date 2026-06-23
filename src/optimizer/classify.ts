/**
 * Transparent task-to-tier heuristic (spec 7.4). No LLM call: a small keyword
 * and size ruleset maps free-text task descriptions to a model tier. The
 * matched rule is returned so the selection reasoning can echo it, and the agent
 * can always override by passing an explicit taskClass.
 *
 * The ruleset is exported so config can replace or extend it.
 */

import type { ModelTier } from '../catalog/types';
import { TIER_RANK } from '../catalog/model-catalog';

export interface ClassifyRule {
  tier: ModelTier;
  /** Lowercase keyword fragments; a substring match on any fires the rule. */
  keywords: string[];
}

/**
 * Default ruleset, ordered from strongest tier to weakest. The first rule whose
 * keyword matches wins, so a "debug a hard architecture problem" task resolves
 * to reasoning before it could match the weaker "design" standard rule.
 */
export const DEFAULT_CLASSIFY_RULES: ClassifyRule[] = [
  {
    tier: 'reasoning',
    keywords: [
      'prove',
      'proof',
      'debug hard',
      'hard bug',
      'architecture',
      'architect',
      'long reasoning',
      'complex reasoning',
      'root cause',
      'formal',
      'theorem',
    ],
  },
  {
    tier: 'standard',
    keywords: [
      'refactor',
      'plan',
      'decompose',
      'multi-file',
      'multi file',
      'design',
      'implement',
      'synthesise',
      'synthesize',
      'report',
    ],
  },
  {
    tier: 'fast',
    keywords: ['summarise', 'summarize', 'summary', 'draft', 'rename', 'rewrite', 'translate'],
  },
  {
    tier: 'trivial',
    keywords: [
      'classify',
      'extract',
      'yes/no',
      'yes or no',
      'route',
      'detect',
      'label',
      'is this',
      'does this',
      'slot',
    ],
  },
];

/** Tier applied when no rule matches. */
export const DEFAULT_TIER: ModelTier = 'fast';

/**
 * Prompts longer than this many characters bias the tier UP by one step. A long
 * prompt usually means more context to reason over; the bump is capped at
 * reasoning and never lowers a tier.
 */
export const SIZE_BUMP_CHARS = 6000;

export interface ClassifyResult {
  tier: ModelTier;
  /** Human-readable explanation of why this tier was chosen. */
  reason: string;
}

const TIER_ORDER: ModelTier[] = ['trivial', 'fast', 'standard', 'reasoning'];

function bumpTier(tier: ModelTier): ModelTier {
  const next = TIER_ORDER[TIER_RANK[tier] + 1];
  return next ?? tier;
}

export interface ClassifyOptions {
  rules?: ClassifyRule[];
  defaultTier?: ModelTier;
  sizeBumpChars?: number;
}

/**
 * Classify a free-text task into a model tier. Deterministic and explainable.
 */
export function classifyTask(task: string, options: ClassifyOptions = {}): ClassifyResult {
  const rules = options.rules ?? DEFAULT_CLASSIFY_RULES;
  const defaultTier = options.defaultTier ?? DEFAULT_TIER;
  const sizeBumpChars = options.sizeBumpChars ?? SIZE_BUMP_CHARS;
  const text = (task ?? '').toLowerCase();

  let tier = defaultTier;
  let reason = `No keyword matched; defaulted to tier '${defaultTier}'.`;

  for (const rule of rules) {
    const hit = rule.keywords.find((k) => text.includes(k));
    if (hit) {
      tier = rule.tier;
      reason = `Matched keyword '${hit}' to tier '${rule.tier}'.`;
      break;
    }
  }

  if (text.length > sizeBumpChars) {
    const bumped = bumpTier(tier);
    if (bumped !== tier) {
      reason += ` Prompt exceeds ${sizeBumpChars} chars; bumped tier up to '${bumped}'.`;
      tier = bumped;
    }
  }

  return { tier, reason };
}
