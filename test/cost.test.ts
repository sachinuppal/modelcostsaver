import { describe, it, expect } from 'vitest';
import {
  calculateCostUsd,
  calculateCostMicros,
  CostCalculator,
} from '../src/cost/cost-calculator';
import { estimateTokens } from '../src/cost/tokenizer';

describe('sub-cent precision', () => {
  it('does not round a fractional-cent Haiku call to zero', () => {
    /* 1000 in @ 1.00/1e6 = 0.0010 ; 100 out @ 5.00/1e6 = 0.0005 -> 0.0015 USD */
    expect(calculateCostUsd(1000, 100, 1.0, 5.0)).toBeCloseTo(0.0015, 9);
    expect(calculateCostMicros(1000, 100, 1.0, 5.0)).toBe(1500);
  });

  it('integer-cents path rounds a sub-cent call to zero (why micros exist)', () => {
    expect(CostCalculator.calculateCost(1000, 100, 1.0, 5.0)).toBe(0);
  });

  it('micros are an exact integer', () => {
    const micros = calculateCostMicros(12000, 1500, 3, 15);
    expect(Number.isInteger(micros)).toBe(true);
    expect(micros).toBe(58500);
  });
});

describe('estimateTokens heuristic', () => {
  it('uses ~4 chars/token by default and ceilings', () => {
    expect(estimateTokens('a'.repeat(8))).toBe(2);
    expect(estimateTokens('a'.repeat(9))).toBe(3);
  });
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });
  it('honors a custom charsPerToken', () => {
    expect(estimateTokens('a'.repeat(10), 5)).toBe(2);
  });
  it('falls back to the default for an invalid divisor', () => {
    expect(estimateTokens('a'.repeat(8), 0)).toBe(2);
    expect(estimateTokens('a'.repeat(8), -1)).toBe(2);
  });
});
