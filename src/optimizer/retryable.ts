/**
 * Retryable-error classification for failover advice.
 *
 * ModelCostSaver advises; it does not execute provider calls. select_optimal_model
 * returns a fallbackChain, and the guidance tells agents: if a primary call
 * returns a rate-limit / quota / overload / 5xx / timeout error, retry on the
 * next model in the chain. This module is the single source of that pattern set.
 */

/* Matched case-insensitively (isRetryableLlmError lowercases first). Status
   codes and provider quota wording both appear so a call path that surfaces only
   the body (no status code) still classifies as retryable. */
const RETRYABLE_PATTERNS = [
  'credit balance is too low',
  'prepayment credits',
  'credits are depleted',
  'rate limit',
  'too many requests',
  '429',
  'resource_exhausted',
  'quota',
  'overloaded',
  '529',
  '503',
  '500',
  'timeout',
];

/**
 * Whether an error is the provider-unavailable class (rate-limit / quota /
 * depleted-credits / overload / 5xx / timeout), i.e. a failure that warrants
 * cross-provider failover.
 *
 * Robust across throw shapes: an Error, a raw string (some SDK/fetch paths throw
 * strings), or a custom object carrying `message`. Falls back to String(error)
 * so nothing is silently missed.
 */
export function isRetryableLlmError(error: unknown): boolean {
  const rawMsg =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ((error as { message?: string } | null)?.message ?? String(error ?? ''));
  const msg = String(rawMsg).toLowerCase();
  return RETRYABLE_PATTERNS.some((pattern) => msg.includes(pattern));
}

export { RETRYABLE_PATTERNS };
