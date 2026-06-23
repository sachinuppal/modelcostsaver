import { describe, it, expect } from 'vitest';
import { predictCost } from '../src/optimizer/predict';

describe('predictCost token pipeline', () => {
  it('uses exact tokens when supplied and adds known context', () => {
    const r = predictCost({
      inputTokens: 1000,
      contextTokens: 500,
      expectedOutputTokens: 200,
      candidates: ['haiku'],
    });
    const f = r.forecasts[0];
    expect(f.predictedInputTokens).toBe(1500);
    expect(f.predictedOutputTokens).toBe(200);
    /* 1500/1e6*1.0 + 200/1e6*5 = 0.0015 + 0.0010 = 0.0025 */
    expect(f.cost.usd).toBeCloseTo(0.0025, 9);
    expect(f.cost.usdMicros).toBe(2500);
    expect(f.assumptions.some((a) => /supplied explicitly/i.test(a))).toBe(true);
  });

  it('estimates input tokens from the prompt when none supplied', () => {
    const r = predictCost({ prompt: 'a'.repeat(40), candidates: ['haiku'], expectedOutputTokens: 0 });
    /* 40 chars / 4 = 10 input tokens. */
    expect(r.forecasts[0].predictedInputTokens).toBe(10);
    expect(r.forecasts[0].assumptions.some((a) => /heuristic/i.test(a))).toBe(true);
  });

  it('output priority: explicit beats task class', () => {
    const r = predictCost({
      inputTokens: 100,
      candidates: ['haiku'],
      taskClass: 'summarise',
      expectedOutputTokens: 33,
    });
    expect(r.forecasts[0].predictedOutputTokens).toBe(33);
  });

  it('output priority: task class cap when no explicit value', () => {
    const r = predictCost({ inputTokens: 100, candidates: ['haiku'], taskClass: 'summarise' });
    expect(r.forecasts[0].predictedOutputTokens).toBe(800);
    expect(r.forecasts[0].assumptions.some((a) => /task class/i.test(a))).toBe(true);
  });

  it("output priority: model output cap when no explicit value or task class", () => {
    const r = predictCost({ inputTokens: 100, candidates: ['gemini-flash-lite'] });
    expect(r.forecasts[0].predictedOutputTokens).toBe(100);
    expect(r.forecasts[0].assumptions.some((a) => /output cap/i.test(a))).toBe(true);
  });

  it('output priority: default ceiling as the last resort', () => {
    /* haiku has no outputCap and no task class -> default 4096. */
    const r = predictCost({ inputTokens: 100, candidates: ['haiku'] });
    expect(r.forecasts[0].predictedOutputTokens).toBe(4096);
    expect(r.forecasts[0].assumptions.some((a) => /default ceiling/i.test(a))).toBe(true);
  });

  it('ranks candidates cheapest-first and reports cheapest', () => {
    const r = predictCost({
      inputTokens: 10000,
      expectedOutputTokens: 1000,
      candidates: ['opus', 'haiku', 'gemini-flash-lite'],
    });
    expect(r.forecasts[0].model).toBe('gemini-2.5-flash-lite');
    expect(r.cheapest!.model).toBe('gemini-2.5-flash-lite');
    const costs = r.forecasts.map((f) => f.cost.usd);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  it('defaults to public chat-capable models when no candidates given', () => {
    const r = predictCost({ inputTokens: 100, expectedOutputTokens: 10 });
    expect(r.forecasts.length).toBeGreaterThan(0);
    expect(r.forecasts.every((f) => f.provider !== 'local')).toBe(true);
  });

  it('ignores unknown candidate names', () => {
    const r = predictCost({ inputTokens: 100, expectedOutputTokens: 10, candidates: ['haiku', 'nope'] });
    expect(r.forecasts.map((f) => f.model)).toEqual(['claude-haiku-4-5-20251001']);
  });
});
