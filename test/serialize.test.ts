import { describe, it, expect } from 'vitest';
import { serializeModel } from '../src/catalog/serialize';
import { resolveModel } from '../src/catalog/model-catalog';

describe('serializeModel', () => {
  it('expands the capabilities Set to a sorted array', () => {
    const m = resolveModel('sonnet')!;
    const s = serializeModel(m);
    expect(Array.isArray(s.capabilities)).toBe(true);
    expect(s.capabilities).toEqual(['chat', 'streaming', 'tools', 'vision']);
  });

  it('round-trips capabilities through JSON.stringify (Sets do not)', () => {
    const m = resolveModel('haiku')!;
    const s = serializeModel(m);
    const parsed = JSON.parse(JSON.stringify(s));
    expect(parsed.capabilities).toEqual(['chat', 'streaming', 'tools']);
  });

  it('flattens nested pricing to top-level per-million fields', () => {
    const s = serializeModel(resolveModel('haiku')!);
    expect(s.inputPerMillion).toBe(1.0);
    expect(s.outputPerMillion).toBe(5.0);
  });

  it('directly serializing a model with a Set loses capabilities (the trap)', () => {
    const m = resolveModel('haiku')!;
    const naive = JSON.parse(JSON.stringify(m));
    /* A Set serializes to {} so the naive path drops the data; serializeModel fixes it. */
    expect(naive.capabilities).toEqual({});
  });
});
