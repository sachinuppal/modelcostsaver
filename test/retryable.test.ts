import { describe, it, expect } from 'vitest';
import { isRetryableLlmError, RETRYABLE_PATTERNS } from '../src/optimizer/retryable';

describe('isRetryableLlmError', () => {
  it('classifies rate-limit / quota / overload / 5xx / timeout as retryable', () => {
    expect(isRetryableLlmError(new Error('Rate limit exceeded'))).toBe(true);
    expect(isRetryableLlmError('429 Too Many Requests')).toBe(true);
    expect(isRetryableLlmError({ message: 'RESOURCE_EXHAUSTED: quota' })).toBe(true);
    expect(isRetryableLlmError('Overloaded')).toBe(true);
    expect(isRetryableLlmError('503 Service Unavailable')).toBe(true);
    expect(isRetryableLlmError('request timeout')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isRetryableLlmError('TIMEOUT')).toBe(true);
    expect(isRetryableLlmError('Quota exceeded')).toBe(true);
  });

  it('does not classify a plain validation error as retryable', () => {
    expect(isRetryableLlmError(new Error('invalid request: missing field'))).toBe(false);
    expect(isRetryableLlmError('400 Bad Request')).toBe(false);
  });

  it('handles null and undefined without throwing', () => {
    expect(isRetryableLlmError(null)).toBe(false);
    expect(isRetryableLlmError(undefined)).toBe(false);
  });

  it('exposes the pattern set', () => {
    expect(RETRYABLE_PATTERNS).toContain('429');
    expect(RETRYABLE_PATTERNS).toContain('timeout');
  });
});
