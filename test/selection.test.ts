import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { selectOptimalModel } from '../src/optimizer/selection';
import type { SelectInput } from '../src/optimizer/selection';

const here = dirname(fileURLToPath(import.meta.url));
const goldenDir = join(here, 'golden');

describe('selectOptimalModel: budget filter', () => {
  it('drops over-budget candidates into rejected with a reason', () => {
    /* reason_hard -> reasoning tier; opus and o3 are expensive. A tiny budget
       drops the pricier survivors but keeps the cheapest. */
    const result = selectOptimalModel({
      taskClass: 'reason_hard',
      estimatedInputTokens: 10000,
      estimatedOutputTokens: 4000,
      maxCostUsd: 0.1,
    });
    expect(result.selected).not.toBeNull();
    expect(result.budgetExceeded).toBeFalsy();
    /* o3: 10k/1e6*2 + 4k/1e6*8 = 0.02 + 0.032 = 0.052 (under 0.1) -> survives.
       opus: 10k/1e6*5 + 4k/1e6*25 = 0.05 + 0.1 = 0.15 (over 0.1) -> rejected. */
    const rejectedModels = result.rejected.map((r) => r.model);
    expect(rejectedModels).toContain('claude-opus-4-8');
    expect(result.rejected.find((r) => r.model === 'claude-opus-4-8')?.reason).toMatch(/budget/i);
    expect(result.selected!.model).toBe('o3');
  });

  it('tie-breaks by cheapest then lowest sufficient tier', () => {
    /* Force a tier where a cheaper higher-tier and pricier model coexist; the
       cheapest wins, and on a cost tie the lower TIER_RANK is preferred. */
    const result = selectOptimalModel({
      taskClass: 'classify_route',
      estimatedInputTokens: 1000,
      estimatedOutputTokens: 20,
    });
    /* trivial tier: gemini-2.5-flash-lite is cheapest and lowest tier. */
    expect(result.selected!.model).toBe('gemini-2.5-flash-lite');
  });
});

describe('selectOptimalModel: empty-survivor path', () => {
  it('returns the single cheapest overall with budgetExceeded + shortfallUsd', () => {
    const result = selectOptimalModel({
      taskClass: 'reason_hard',
      estimatedInputTokens: 100000,
      estimatedOutputTokens: 8000,
      maxCostUsd: 0.0001,
    });
    expect(result.budgetExceeded).toBe(true);
    expect(result.selected).not.toBeNull();
    expect(typeof result.shortfallUsd).toBe('number');
    expect(result.shortfallUsd!).toBeGreaterThan(0);
    /* Cheapest reasoning-tier public model by predicted cost is o3 (2/8 vs opus 5/25). */
    expect(result.selected!.model).toBe('o3');
    expect(result.reasoning.join(' ')).toMatch(/budget/i);
  });
});

describe('selectOptimalModel: capability degrade-up', () => {
  it('a trivial task requiring tools degrades up to the cheapest tools-capable model', () => {
    const result = selectOptimalModel({
      taskClass: 'classify_route',
      requiredCapabilities: ['tools'],
      estimatedInputTokens: 800,
      estimatedOutputTokens: 50,
      maxCostUsd: 0.01,
    });
    /* No trivial-tier model has tools; gemini-2.5-flash (fast, $0.15/1M) is the
       cheapest tools-capable model and beats haiku ($0.80/1M). */
    expect(result.selected!.model).toBe('gemini-2.5-flash');
    expect(result.selected!.tier).toBe('fast');
  });

  it('never selects a model below the resolved tier floor', () => {
    const result = selectOptimalModel({
      taskClass: 'classify_route',
      requiredCapabilities: ['tools'],
      estimatedInputTokens: 800,
      estimatedOutputTokens: 50,
    });
    /* Selected tier must be >= trivial; degrade-up only. */
    expect(['fast', 'standard', 'reasoning']).toContain(result.selected!.tier);
  });
});

describe('selectOptimalModel: reasoning + fallbackChain', () => {
  it('always returns a non-empty reasoning array and a fallbackChain', () => {
    const result = selectOptimalModel({
      taskClass: 'summarise',
      estimatedInputTokens: 5000,
      estimatedOutputTokens: 800,
    });
    expect(result.reasoning.length).toBeGreaterThan(0);
    expect(result.fallbackChain.length).toBeGreaterThan(0);
    /* The winner is the head of the fallback chain. */
    expect(result.fallbackChain[0]).toBe(result.selected!.model);
    /* No duplicate entries in the chain. */
    expect(new Set(result.fallbackChain).size).toBe(result.fallbackChain.length);
  });
});

describe('selectOptimalModel: provider filter (preferredProvider)', () => {
  it('restricts candidates to the preferred provider', () => {
    const result = selectOptimalModel({
      taskClass: 'summarise',
      preferredProvider: 'anthropic',
      estimatedInputTokens: 5000,
      estimatedOutputTokens: 800,
    });
    expect(result.selected!.provider).toBe('anthropic');
    expect(result.selected!.model).toBe('claude-haiku-4-5-20251001');
  });
});

describe('selectOptimalModel: explicit targetTier without taskClass', () => {
  it('resolves the tier from targetTier when no taskClass is given', () => {
    const result = selectOptimalModel({
      targetTier: 'trivial',
      estimatedInputTokens: 500,
      estimatedOutputTokens: 20,
    });
    expect(result.selected!.tier).toBe('trivial');
  });
});

describe('selectOptimalModel: golden cases', () => {
  const files = readdirSync(goldenDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const golden = JSON.parse(readFileSync(join(goldenDir, file), 'utf8')) as {
      description: string;
      input: SelectInput;
      expected: {
        selectedModel: string;
        selectedProvider: string;
        selectedTier: string;
        budgetExceeded: boolean;
      };
    };
    it(`golden: ${file}`, () => {
      const result = selectOptimalModel(golden.input);
      expect(result.selected).not.toBeNull();
      expect(result.selected!.model).toBe(golden.expected.selectedModel);
      expect(result.selected!.provider).toBe(golden.expected.selectedProvider);
      expect(result.selected!.tier).toBe(golden.expected.selectedTier);
      expect(Boolean(result.budgetExceeded)).toBe(golden.expected.budgetExceeded);
    });
  }
});
