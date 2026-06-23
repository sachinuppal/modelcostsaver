/**
 * Cost helpers. The catalog stores USD per 1M tokens; these convert a token
 * shape and a per-million price pair to cost.
 *
 * Predictions are kept in full-precision USD plus integer micro-dollars
 * (1e-6 USD) so a fractional-cent call never rounds to zero. Integer cents are
 * available only for a "round to billing units" view, never for a prediction.
 */

export class CostCalculator {
  static usdToCents(usd: number): number {
    return Math.round(usd * 100);
  }

  /**
   * Integer-cents cost. Lossy below one cent (a sub-cent call rounds to 0);
   * use calculateCostUsd / calculateCostMicros for predictions.
   */
  static calculateCost(
    inputTokens: number,
    outputTokens: number,
    inputPerMillion: number,
    outputPerMillion: number,
  ): number {
    const inputUsd = (inputTokens / 1_000_000) * inputPerMillion;
    const outputUsd = (outputTokens / 1_000_000) * outputPerMillion;
    return this.usdToCents(inputUsd + outputUsd);
  }
}

/** Full-precision USD. inputPerMillion/outputPerMillion are USD per 1e6 tokens. */
export function calculateCostUsd(
  inputTokens: number,
  outputTokens: number,
  inputPerMillion: number,
  outputPerMillion: number,
): number {
  return (inputTokens / 1e6) * inputPerMillion + (outputTokens / 1e6) * outputPerMillion;
}

/** Integer micro-dollars (1e-6 USD); exact, never rounds a sub-cent value to 0. */
export function calculateCostMicros(
  inputTokens: number,
  outputTokens: number,
  inputPerMillion: number,
  outputPerMillion: number,
): number {
  return Math.round(
    calculateCostUsd(inputTokens, outputTokens, inputPerMillion, outputPerMillion) * 1e6,
  );
}

export const DEFAULT_LLM_CONSTRAINTS = {
  maxTokens: 4096,
  temperature: 0.7,
  topP: 0.9,
} as const;
