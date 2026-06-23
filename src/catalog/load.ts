/**
 * Resolve the active catalog provenance (spec 8).
 *
 * The in-memory MODEL_CATALOG is the data source for all pricing math; this
 * module resolves which provenance (catalogVersion / asOf / source) is active.
 * With refresh off (the default) the bundled metadata is returned and no network
 * call is made. With refresh on, the opt-in remote refresh prefers the freshest
 * valid source and ALWAYS falls back to the bundled catalog, never hard-failing.
 */

import { BUNDLED_CATALOG_META, type CatalogMeta } from './meta.js';
import { loadCatalogPayload } from './refresh.js';
import { log } from '../server/log.js';
import type { ResolvedConfig } from '../config/config.js';

/**
 * Active catalog metadata, synchronous and offline. Bundled is the safe default;
 * used where an await is not available. The async resolver below is preferred at
 * boot so an enabled refresh updates the provenance.
 */
export function loadActiveCatalogMeta(_config: ResolvedConfig): CatalogMeta {
  return BUNDLED_CATALOG_META;
}

/**
 * Resolve the active catalog provenance honoring the opt-in refresh. When refresh
 * is off this returns the bundled metadata with no network call; when on it
 * reflects the provenance of the freshest valid source (remote or a cache),
 * falling back to bundled on any failure. The provenance source is logged so an
 * operator can see which catalog is live.
 */
export async function resolveActiveCatalogMeta(config: ResolvedConfig): Promise<CatalogMeta> {
  const { source, payload } = await loadCatalogPayload(config);
  if (config.refresh) {
    log.info(`catalog provenance: ${source} (version ${payload.catalogVersion}, as of ${payload.asOf}).`);
  }
  return {
    catalogVersion: payload.catalogVersion,
    asOf: payload.asOf,
    source: payload.source,
  };
}
