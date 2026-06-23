/**
 * Heuristic token estimator. The default is a chars-per-token approximation
 * (~4 chars/token for English code and prose), clearly labeled as approximate.
 * A later plugin can override via the Tokenizer interface for exact counts.
 *
 * The error is roughly common-mode across candidates, so the heuristic is fine
 * for the relative ranking that model selection needs.
 */

export const DEFAULT_CHARS_PER_TOKEN = 4;

export interface Tokenizer {
  estimateTokens(text: string, charsPerToken?: number): number;
}

/**
 * Estimate the token count of a string. Returns 0 for empty input; never
 * negative. charsPerToken is clamped to a sane lower bound so a misconfigured
 * value cannot produce an absurd or non-finite estimate.
 */
export function estimateTokens(text: string, charsPerToken: number = DEFAULT_CHARS_PER_TOKEN): number {
  if (!text) return 0;
  const divisor = Number.isFinite(charsPerToken) && charsPerToken >= 1 ? charsPerToken : DEFAULT_CHARS_PER_TOKEN;
  return Math.ceil(text.length / divisor);
}

/** Default heuristic tokenizer instance. */
export const heuristicTokenizer: Tokenizer = {
  estimateTokens,
};
