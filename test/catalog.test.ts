import { describe, it, expect } from 'vitest';
import {
  resolveModel,
  getModelForTier,
  getModelsWithCapability,
  getFallbackModel,
  TIER_RANK,
} from '../src/catalog/model-catalog';

describe('resolveModel', () => {
  it('resolves by alias', () => {
    expect(resolveModel('sonnet')?.id).toBe('claude-sonnet-4-6');
  });
  it('resolves by full id', () => {
    expect(resolveModel('claude-sonnet-4-6')?.alias).toBe('sonnet');
  });
  it('is case-insensitive', () => {
    expect(resolveModel('CLAUDE-SONNET-4-6')?.id).toBe('claude-sonnet-4-6');
    expect(resolveModel('HAIKU')?.id).toBe('claude-haiku-4-5-20251001');
  });
  it('returns undefined for unknown', () => {
    expect(resolveModel('not-a-model')).toBeUndefined();
  });
});

describe('getModelForTier', () => {
  it('excludes local by default', () => {
    expect(getModelForTier('standard').provider).not.toBe('local');
  });
  it('picks the cheapest at the tier', () => {
    /* trivial tier has only gemini-2.5-flash-lite among public models */
    expect(getModelForTier('trivial').id).toBe('gemini-2.5-flash-lite');
  });
  it('includes local when explicitly preferred', () => {
    expect(getModelForTier('standard', 'local').provider).toBe('local');
  });
});

describe('getModelsWithCapability', () => {
  it('excludes the trivial-tier gemini-2.5-flash-lite from tools (no tools)', () => {
    const ids = getModelsWithCapability('tools').map((m) => m.id);
    expect(ids).not.toContain('gemini-2.5-flash-lite');
  });
  it('includes a tools-capable model', () => {
    const ids = getModelsWithCapability('tools').map((m) => m.id);
    expect(ids).toContain('gemini-2.5-flash');
  });
});

describe('getFallbackModel', () => {
  it('never returns a tier below the primary (degrade up, never down)', () => {
    for (const id of ['haiku', 'sonnet', 'opus', 'gemini-flash-lite']) {
      const primary = resolveModel(id)!;
      const fb = getFallbackModel(id);
      if (fb) {
        expect(TIER_RANK[fb.tier]).toBeGreaterThanOrEqual(TIER_RANK[primary.tier]);
      }
    }
  });
  it('degrades up from the gemini-only trivial tier to a higher anthropic tier', () => {
    const fb = getFallbackModel('gemini-flash-lite');
    expect(fb?.provider).toBe('anthropic');
    expect(TIER_RANK[fb!.tier]).toBeGreaterThanOrEqual(TIER_RANK.trivial);
  });
});
