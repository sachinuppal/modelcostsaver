import { describe, it, expect } from 'vitest';
import { compareModels } from '../src/optimizer/compare';

describe('compareModels', () => {
  it('sorts cheapest-first with relativeToCheapest multiples', () => {
    const r = compareModels({ models: ['opus', 'haiku', 'sonnet'], inputTokens: 10000, outputTokens: 2000 });
    expect(r.rows.map((row) => row.model)).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-6',
      'claude-opus-4-8',
    ]);
    expect(r.rows[0].relativeToCheapest).toBe('1.0x');
    /* sonnet 0.06 / haiku 0.02 = 3.0 -> 3.0x */
    expect(r.rows[1].relativeToCheapest).toBe('3.0x');
    /* opus 0.10 / 0.02 = 5.0 -> 5.0x */
    expect(r.rows[2].relativeToCheapest).toBe('5.0x');
  });

  it('reports cheapest and mostCapable callouts', () => {
    const r = compareModels({ models: ['haiku', 'sonnet', 'opus'], inputTokens: 10000, outputTokens: 2000 });
    expect(r.cheapest!.model).toBe('claude-haiku-4-5-20251001');
    /* sonnet and opus both have 4 capabilities; tie broken by pricier -> opus. */
    expect(r.mostCapable!.model).toBe('claude-opus-4-8');
  });

  it('serializes capabilities to a sorted array', () => {
    const r = compareModels({ models: ['haiku'], inputTokens: 1000, outputTokens: 100 });
    expect(r.rows[0].capabilities).toEqual(['chat', 'streaming', 'tools']);
  });

  it('collects unknown model names instead of crashing', () => {
    const r = compareModels({ models: ['haiku', 'not-a-model'], inputTokens: 1000, outputTokens: 100 });
    expect(r.unknownModels).toEqual(['not-a-model']);
    expect(r.rows).toHaveLength(1);
  });

  it('returns empty result when no model resolves', () => {
    const r = compareModels({ models: ['nope'], inputTokens: 1000, outputTokens: 100 });
    expect(r.rows).toHaveLength(0);
    expect(r.cheapest).toBeNull();
    expect(r.mostCapable).toBeNull();
  });
});
