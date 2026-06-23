/**
 * Side-by-side model comparison (spec 6.4) for a fixed token shape. Produces a
 * normalized, cheapest-first table with each row's multiple of the cheapest, and
 * callouts for the cheapest and the most capable model.
 */

import {
  resolveModel,
  type ModelDefinition,
  type ProviderName,
} from '../catalog/model-catalog';
import { calculateCostUsd, calculateCostMicros } from '../cost/cost-calculator';

export interface CompareInput {
  models: string[];
  inputTokens: number;
  outputTokens: number;
}

export interface CompareRow {
  model: string;
  provider: ProviderName;
  tier: string;
  capabilities: string[];
  cost: { usd: number; usdMicros: number };
  /** Multiple of the cheapest row, e.g. "1.0x", "6.4x". */
  relativeToCheapest: string;
}

export interface CompareResult {
  rows: CompareRow[];
  cheapest: CompareRow | null;
  mostCapable: CompareRow | null;
  unknownModels: string[];
}

function relative(usd: number, cheapestUsd: number): string {
  /* When the cheapest is free (local $0), a ratio is undefined; report 1.0x for
     the free row and avoid a divide-by-zero infinity for the rest. */
  if (cheapestUsd <= 0) return usd <= 0 ? '1.0x' : 'n/a';
  return `${(usd / cheapestUsd).toFixed(1)}x`;
}

export function compareModels(input: CompareInput): CompareResult {
  const resolved: ModelDefinition[] = [];
  const unknownModels: string[] = [];
  for (const name of input.models) {
    const m = resolveModel(name);
    if (m) resolved.push(m);
    else unknownModels.push(name);
  }

  if (resolved.length === 0) {
    return { rows: [], cheapest: null, mostCapable: null, unknownModels };
  }

  const priced = resolved.map((m) => ({
    model: m,
    usd: calculateCostUsd(input.inputTokens, input.outputTokens, m.pricing.inputPerMillion, m.pricing.outputPerMillion),
    usdMicros: calculateCostMicros(input.inputTokens, input.outputTokens, m.pricing.inputPerMillion, m.pricing.outputPerMillion),
  }));

  priced.sort((a, b) => a.usd - b.usd);
  const cheapestUsd = priced[0].usd;

  const rows: CompareRow[] = priced.map((p) => ({
    model: p.model.id,
    provider: p.model.provider,
    tier: p.model.tier,
    capabilities: [...p.model.capabilities].sort(),
    cost: { usd: p.usd, usdMicros: p.usdMicros },
    relativeToCheapest: relative(p.usd, cheapestUsd),
  }));

  /* Most capable = most capabilities, tie-broken by the pricier model (a proxy
     for stronger). Deterministic given the catalog. */
  const mostCapable = [...rows].sort(
    (a, b) => b.capabilities.length - a.capabilities.length || b.cost.usd - a.cost.usd,
  )[0];

  return { rows, cheapest: rows[0], mostCapable, unknownModels };
}
