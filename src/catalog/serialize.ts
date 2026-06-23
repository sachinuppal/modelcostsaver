import type { ModelDefinition } from './types';
import { MODEL_CATALOG } from './model-catalog';
import { BUNDLED_CATALOG_META, type CatalogMeta } from './meta';

/**
 * JSON-safe shape of a model. Intentionally FLAT (top-level
 * inputPerMillion/outputPerMillion) while the in-memory ModelDefinition keeps
 * pricing NESTED. catalog.json, list_models/get_pricing, and the refresh and
 * verify schemas all validate this flat serialized shape.
 */
export interface SerializedModel {
  id: string;
  alias: string;
  provider: string;
  tier: string;
  capabilities: string[];
  inputPerMillion: number;
  outputPerMillion: number;
  outputCap?: number;
  license?: string;
}

/**
 * Convert a ModelDefinition (capabilities is a Set) to a JSON-safe shape.
 * A Set does not survive JSON.stringify, so it must be expanded to an array
 * before any tool result or resource read.
 */
export function serializeModel(m: ModelDefinition): SerializedModel {
  return {
    id: m.id,
    alias: m.alias,
    provider: m.provider,
    tier: m.tier,
    capabilities: [...m.capabilities].sort(),
    inputPerMillion: m.pricing.inputPerMillion,
    outputPerMillion: m.pricing.outputPerMillion,
    outputCap: m.outputCap,
    license: m.license,
  };
}

/** The full JSON-safe catalog: provenance metadata plus the serialized models. */
export interface CatalogPayload extends CatalogMeta {
  models: SerializedModel[];
}

/**
 * Build the serializable catalog payload (capabilities expanded to arrays) for
 * the bundled catalog.json, the modelcostsaver://catalog resource, and the
 * publish verifier. Models are sorted by input price for stable, inspectable output.
 */
export function buildCatalogPayload(meta: CatalogMeta = BUNDLED_CATALOG_META): CatalogPayload {
  const models = Object.values(MODEL_CATALOG)
    .map(serializeModel)
    .sort((a, b) => a.inputPerMillion - b.inputPerMillion || a.id.localeCompare(b.id));
  return { ...meta, models };
}
