/**
 * Opt-in catalog refresh (spec Section 8).
 *
 * Default behavior is offline: the bundled catalog is the only source and no
 * network call is made. When refresh is enabled (MODELCOSTSAVER_REFRESH=on) this
 * fetches a single static JSON, validates it with zod BEFORE it is allowed to
 * replace anything, and caches it under the config dir with a TTL. The
 * cardinal rule (spec 8.2): a bad or unreachable refresh ALWAYS falls back to
 * the bundled catalog and never hard-fails. The fetched payload is validated
 * before it can touch the in-memory catalog, so a malformed remote source can
 * never poison pricing.
 *
 * fetch, the clock, and the cache directory are injected so the logic is pure
 * and fully testable without the network or the real config dir. Production
 * wiring (built-in fetch, real clock, real config dir) lives in loadCatalogPayload.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { buildCatalogPayload, type CatalogPayload } from './serialize.js';
import { configDir } from '../config/config.js';
import { log } from '../server/log.js';
import type { ResolvedConfig } from '../config/config.js';

/** Cache file under the config dir holding the last valid remote payload + fetch time. */
export const CATALOG_CACHE_FILENAME = 'catalog-cache.json';

/** Default refresh TTL: a remote catalog is re-fetched at most once per six hours. */
export const DEFAULT_REFRESH_TTL_MS = 6 * 60 * 60 * 1000;

/** Default refresh source. A placeholder host; real hosting is a pre-publish decision. */
export const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/workswarm/modelcostsaver-catalog/main/catalog.json';

/**
 * Validated shape of a refreshed catalog. This is the FLAT serialized shape that
 * catalog.json ships and that list_models returns, NOT the nested in-memory
 * ModelDefinition. Unknown top-level keys are tolerated so a newer catalog format
 * does not break an older binary; the model fields it relies on are required.
 */
const RefreshModelSchema = z
  .object({
    id: z.string().min(1),
    alias: z.string().min(1),
    provider: z.string().min(1),
    tier: z.string().min(1),
    capabilities: z.array(z.string()),
    inputPerMillion: z.number().nonnegative(),
    outputPerMillion: z.number().nonnegative(),
    outputCap: z.number().optional(),
    license: z.string().optional(),
    source: z.string().optional(),
  })
  .passthrough();

export const CatalogRefreshSchema = z
  .object({
    catalogVersion: z.string().min(1),
    asOf: z.string().min(1),
    source: z.string().min(1),
    models: z.array(RefreshModelSchema).min(1),
  })
  .passthrough();

export type CatalogRefreshPayload = z.infer<typeof CatalogRefreshSchema>;

/** Where the active catalog payload came from, for honest provenance in logs. */
export type CatalogSource = 'remote' | 'cache' | 'stale-cache' | 'bundled';

export interface RefreshResult {
  source: CatalogSource;
  payload: CatalogPayload;
}

/** Shape persisted in the cache file: the validated payload plus its fetch time. */
interface CacheEnvelope {
  fetchedAt: number;
  payload: CatalogRefreshPayload;
}

export interface RefreshOptions {
  url: string;
  cacheDir: string;
  ttlMs: number;
  /** Injected fetch (built-in fetch in production); enables deterministic tests. */
  fetchImpl: typeof fetch;
  /** Injected clock (Date.now in production). */
  now: () => number;
}

/** The bundled catalog as a refresh result. Always available, never fails. */
function bundledResult(): RefreshResult {
  return { source: 'bundled', payload: buildCatalogPayload() };
}

/** Normalize a validated refresh payload into the CatalogPayload return shape. */
function toCatalogPayload(p: CatalogRefreshPayload): CatalogPayload {
  return {
    catalogVersion: p.catalogVersion,
    asOf: p.asOf,
    source: p.source,
    models: p.models.map((m) => ({
      id: m.id,
      alias: m.alias,
      provider: m.provider,
      tier: m.tier,
      capabilities: [...m.capabilities],
      inputPerMillion: m.inputPerMillion,
      outputPerMillion: m.outputPerMillion,
      outputCap: m.outputCap,
      license: m.license,
    })),
  };
}

/** Read and validate the cache file. Returns null on any read/parse/validation miss. */
function readCache(cacheDir: string): CacheEnvelope | null {
  const path = join(cacheDir, CATALOG_CACHE_FILENAME);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.warn('catalog cache is not valid JSON; ignoring it.');
    return null;
  }
  const env = parsed as { fetchedAt?: unknown; payload?: unknown };
  if (typeof env?.fetchedAt !== 'number') return null;
  const validated = CatalogRefreshSchema.safeParse(env.payload);
  if (!validated.success) {
    log.warn('catalog cache failed validation; ignoring it.');
    return null;
  }
  return { fetchedAt: env.fetchedAt, payload: validated.data };
}

/** Write a validated payload to the cache. Best-effort: a write failure is non-fatal. */
function writeCache(cacheDir: string, env: CacheEnvelope): void {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, CATALOG_CACHE_FILENAME), JSON.stringify(env), 'utf8');
  } catch (err) {
    log.warn(`could not write catalog cache: ${(err as Error).message}`);
  }
}

/**
 * Fetch and validate the remote catalog. Returns the validated payload, or null
 * on any failure (network error, non-ok status, non-JSON body, schema mismatch).
 * Never throws: every failure is converted to a null so the caller can fall back.
 */
async function fetchRemote(
  url: string,
  fetchImpl: typeof fetch,
): Promise<CatalogRefreshPayload | null> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    log.warn(`catalog refresh fetch failed: ${(err as Error).message}`);
    return null;
  }
  if (!response.ok) {
    log.warn(`catalog refresh got HTTP ${response.status}; keeping current catalog.`);
    return null;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    log.warn(`catalog refresh response was not JSON: ${(err as Error).message}`);
    return null;
  }
  const validated = CatalogRefreshSchema.safeParse(body);
  if (!validated.success) {
    log.warn(
      `catalog refresh payload failed validation: ${validated.error.issues[0]?.message ?? 'invalid'}; keeping current catalog.`,
    );
    return null;
  }
  return validated.data;
}

/**
 * Resolve the active catalog with the opt-in refresh policy:
 *   1. A fresh cache (within TTL) is used as-is, no network call.
 *   2. Otherwise fetch + validate; on success cache it and use it (source remote).
 *   3. On fetch/validation failure, fall back to a stale-but-valid cache if one
 *      exists (source stale-cache), else the bundled catalog (source bundled).
 * Never throws and never replaces the catalog with an unvalidated payload.
 */
export async function refreshCatalog(opts: RefreshOptions): Promise<RefreshResult> {
  const { url, cacheDir, ttlMs, fetchImpl, now } = opts;

  const cached = readCache(cacheDir);
  if (cached && now() - cached.fetchedAt < ttlMs) {
    return { source: 'cache', payload: toCatalogPayload(cached.payload) };
  }

  const remote = await fetchRemote(url, fetchImpl);
  if (remote) {
    writeCache(cacheDir, { fetchedAt: now(), payload: remote });
    return { source: 'remote', payload: toCatalogPayload(remote) };
  }

  /* Refresh failed: prefer a stale-but-valid cache over the bundled fallback so a
     transient outage does not discard freshly verified prices. */
  if (cached) {
    return { source: 'stale-cache', payload: toCatalogPayload(cached.payload) };
  }
  return bundledResult();
}

/**
 * Production entry: resolve the catalog payload honoring config. When refresh is
 * off (the default) this returns the bundled catalog with no network call. When
 * on, it delegates to refreshCatalog with built-in fetch, the real clock, and the
 * config dir, and still falls back to bundled on any failure.
 */
export async function loadCatalogPayload(config: ResolvedConfig): Promise<RefreshResult> {
  if (!config.refresh) {
    return bundledResult();
  }
  if (typeof fetch !== 'function') {
    log.warn('global fetch is unavailable (Node < 18); using the bundled catalog.');
    return bundledResult();
  }
  return refreshCatalog({
    url: config.catalogUrl ?? DEFAULT_CATALOG_URL,
    cacheDir: configDir(),
    ttlMs: DEFAULT_REFRESH_TTL_MS,
    fetchImpl: fetch,
    now: () => Date.now(),
  });
}
