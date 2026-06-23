import { describe, it, expect } from 'vitest';
import { optimizeRequest } from '../src/optimizer/optimize';

describe('optimizeRequest: worked example (spec Appendix C)', () => {
  it('opus summarise -> haiku saves ~80% same-provider', () => {
    /* opus: 5000/1e6*5 + 800/1e6*25 = 0.025 + 0.02 = 0.045
       haiku: 5000/1e6*1.0 + 800/1e6*5 = 0.005 + 0.004 = 0.009
       savings = 0.036 (80.0%). */
    const result = optimizeRequest({
      currentModel: 'opus',
      inputTokens: 5000,
      outputTokens: 800,
      taskClass: 'summarise',
      crossProvider: false,
    });
    expect(result.alreadyOptimal).toBe(false);
    expect(result.current?.model).toBe('claude-opus-4-8');
    expect(result.recommended?.model).toBe('claude-haiku-4-5-20251001');
    expect(result.current?.usd).toBeCloseTo(0.045, 9);
    expect(result.recommended?.usd).toBeCloseTo(0.009, 9);
    expect(result.savingsUsd).toBeCloseTo(0.036, 9);
    expect(result.savingsPct).toBeGreaterThan(79);
    expect(result.savingsPct).toBeLessThan(81);
  });
});

describe('optimizeRequest: same-provider default vs crossProvider', () => {
  it('same-provider keeps the recommendation on the current provider', () => {
    const result = optimizeRequest({
      currentModel: 'opus',
      inputTokens: 5000,
      outputTokens: 800,
      taskClass: 'summarise',
    });
    expect(result.recommended?.provider).toBe('anthropic');
  });

  it('crossProvider can surface a cheaper other-vendor model', () => {
    const same = optimizeRequest({
      currentModel: 'opus',
      inputTokens: 5000,
      outputTokens: 800,
      taskClass: 'summarise',
      crossProvider: false,
    });
    const cross = optimizeRequest({
      currentModel: 'opus',
      inputTokens: 5000,
      outputTokens: 800,
      taskClass: 'summarise',
      crossProvider: true,
    });
    /* The cross-provider winner is at least as cheap as the same-provider one. */
    expect(cross.recommended!.usd).toBeLessThanOrEqual(same.recommended!.usd);
    /* gpt-4.1-mini (0.4/1.6) is the cheapest fast-or-higher model overall at this
       shape: $0.00328 vs gemini-2.5-flash $0.0035 (its output rose to 2.50). */
    expect(cross.recommended?.provider).toBe('openai');
  });
});

describe('optimizeRequest: already optimal', () => {
  it('returns recommended === current when nothing is cheaper', () => {
    /* haiku is the cheapest anthropic model at the summarise (fast) tier. */
    const result = optimizeRequest({
      currentModel: 'haiku',
      inputTokens: 1000,
      outputTokens: 100,
      taskClass: 'summarise',
      crossProvider: false,
    });
    expect(result.alreadyOptimal).toBe(true);
    expect(result.recommended?.model).toBe(result.current?.model);
    expect(result.savingsUsd).toBe(0);
  });
});

describe('optimizeRequest: tier floor never drops below the task tier', () => {
  it('a reason_hard task keeps the recommendation at the reasoning tier', () => {
    const result = optimizeRequest({
      currentModel: 'opus',
      inputTokens: 5000,
      outputTokens: 800,
      taskClass: 'reason_hard',
      crossProvider: true,
    });
    /* reasoning tier: o3 (2/8) is cheaper than opus (5/25); both reasoning. */
    expect(result.recommended?.tier).toBe('reasoning');
    expect(result.recommended?.model).toBe('o3');
  });
});

describe('optimizeRequest: tier-based, no task class', () => {
  it('with no task class the floor is the current model tier (never weaker)', () => {
    /* sonnet is standard; with no task class the recommendation stays at
       standard+ . gemini-2.5-pro (1.25/10) is the cheapest standard model and is
       cheaper than sonnet (3/15). The fast-tier haiku is below the floor. */
    const result = optimizeRequest({
      currentModel: 'sonnet',
      inputTokens: 5000,
      outputTokens: 800,
      crossProvider: true,
    });
    const rec = result.recommended!;
    expect(['standard', 'reasoning']).toContain(rec.tier);
    expect(rec.model).not.toBe('claude-haiku-4-5-20251001');
    expect(rec.model).toBe('gemini-2.5-pro');
  });
});

describe('optimizeRequest: allowedProviders scope', () => {
  it('restricts a cross-provider search to the allowlist, current provider always allowed', () => {
    const result = optimizeRequest({
      currentModel: 'opus',
      inputTokens: 5000,
      outputTokens: 800,
      taskClass: 'summarise',
      crossProvider: true,
      allowedProviders: ['anthropic'],
    });
    /* Scoped to anthropic: the gemini option is hidden; haiku wins. */
    expect(result.recommended?.provider).toBe('anthropic');
    expect(result.recommended?.model).toBe('claude-haiku-4-5-20251001');
  });
});

describe('optimizeRequest: unknown model', () => {
  it('returns an unknownModel flag and no recommendation', () => {
    const result = optimizeRequest({ currentModel: 'not-a-model', inputTokens: 10, outputTokens: 10 });
    expect(result.unknownModel).toBe('not-a-model');
    expect(result.recommended).toBeNull();
  });
});
