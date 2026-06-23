/**
 * Catalog provenance metadata.
 *
 * Every cost-bearing tool result and the catalog resource echo catalogVersion
 * and asOf so a consumer can see how fresh the pricing is. This is a trust
 * feature, not decoration: prices change often and a stale catalog is worse than
 * none. catalogVersion is date-stamped (YYYY-MM-DD.N) and bumps independently of
 * the package version when prices change.
 */

export const CATALOG_VERSION = '2026-06-23.2';

/** Date the bundled prices were last verified against provider pricing pages. */
export const CATALOG_AS_OF = '2026-06-23';

/** Where the seed prices were verified from (per-entry sources live in catalog.json). */
export const CATALOG_SOURCE = 'provider public pricing pages';

export interface CatalogMeta {
  catalogVersion: string;
  asOf: string;
  source: string;
}

export const BUNDLED_CATALOG_META: CatalogMeta = {
  catalogVersion: CATALOG_VERSION,
  asOf: CATALOG_AS_OF,
  source: CATALOG_SOURCE,
};
