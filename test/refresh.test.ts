/**
 * Opt-in catalog refresh (spec Section 8): fetch a static JSON, zod-validate it
 * BEFORE it can replace anything, cache it under the config dir with a TTL, and
 * ALWAYS fall back to the bundled catalog on a bad or unreachable source. Refresh
 * must never hard-fail; a network or validation failure is a warning, not a crash.
 *
 * fetch, the clock, and the cache directory are injected so these tests are fully
 * deterministic and never touch the network or the real config dir.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogRefreshSchema, refreshCatalog, CATALOG_CACHE_FILENAME } from '../src/catalog/refresh';
import { buildCatalogPayload } from '../src/catalog/serialize';
import { BUNDLED_CATALOG_META } from '../src/catalog/meta';

/* A minimal, valid refresh payload in the FLAT serialized shape. */
function validPayload() {
  return {
    catalogVersion: '2026-07-01.1',
    asOf: '2026-07-01',
    source: 'https://example.test/catalog.json',
    models: [
      {
        id: 'claude-sonnet-4-6',
        alias: 'sonnet',
        provider: 'anthropic',
        tier: 'standard',
        capabilities: ['chat', 'tools', 'vision', 'streaming'],
        inputPerMillion: 2.5,
        outputPerMillion: 12,
        source: 'https://www.anthropic.com/pricing',
      },
    ],
  };
}

/** Build a Response-like object good enough for the refresh code path. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'modelcostsaver-refresh-'));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

describe('CatalogRefreshSchema', () => {
  it('accepts a valid flat payload', () => {
    expect(CatalogRefreshSchema.safeParse(validPayload()).success).toBe(true);
  });

  it('rejects a payload missing asOf', () => {
    const bad = validPayload() as Record<string, unknown>;
    delete bad.asOf;
    expect(CatalogRefreshSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a payload with no models', () => {
    const bad = validPayload();
    bad.models = [];
    expect(CatalogRefreshSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-object payload', () => {
    expect(CatalogRefreshSchema.safeParse('not json').success).toBe(false);
    expect(CatalogRefreshSchema.safeParse(null).success).toBe(false);
  });
});

describe('refreshCatalog', () => {
  it('replaces the catalog when the fetched payload is valid', async () => {
    const fetchImpl = async () => jsonResponse(validPayload());
    const result = await refreshCatalog({
      url: 'https://example.test/catalog.json',
      cacheDir,
      ttlMs: 60_000,
      fetchImpl,
      now: () => 1000,
    });
    expect(result.source).toBe('remote');
    expect(result.payload.catalogVersion).toBe('2026-07-01.1');
    expect(result.payload.models[0].inputPerMillion).toBe(2.5);
    /* The valid payload is cached for next time. */
    expect(existsSync(join(cacheDir, CATALOG_CACHE_FILENAME))).toBe(true);
  });

  it('falls back to bundled when the payload is malformed', async () => {
    const fetchImpl = async () => jsonResponse({ catalogVersion: 'x', models: 'nope' });
    const result = await refreshCatalog({
      url: 'https://example.test/catalog.json',
      cacheDir,
      ttlMs: 60_000,
      fetchImpl,
      now: () => 1000,
    });
    expect(result.source).toBe('bundled');
    expect(result.payload.catalogVersion).toBe(BUNDLED_CATALOG_META.catalogVersion);
    /* A malformed remote payload must never be cached. */
    expect(existsSync(join(cacheDir, CATALOG_CACHE_FILENAME))).toBe(false);
  });

  it('falls back to bundled when fetch throws (unreachable)', async () => {
    const fetchImpl = async () => {
      throw new Error('ENOTFOUND');
    };
    const result = await refreshCatalog({
      url: 'https://example.test/catalog.json',
      cacheDir,
      ttlMs: 60_000,
      fetchImpl,
      now: () => 1000,
    });
    expect(result.source).toBe('bundled');
    expect(result.payload.catalogVersion).toBe(BUNDLED_CATALOG_META.catalogVersion);
  });

  it('falls back to bundled on a non-ok HTTP status', async () => {
    const fetchImpl = async () => jsonResponse({}, false, 503);
    const result = await refreshCatalog({
      url: 'https://example.test/catalog.json',
      cacheDir,
      ttlMs: 60_000,
      fetchImpl,
      now: () => 1000,
    });
    expect(result.source).toBe('bundled');
  });

  it('serves a fresh cache without fetching again (TTL not expired)', async () => {
    /* Pre-seed a valid cache stamped at t=0. */
    const cached = { fetchedAt: 0, payload: validPayload() };
    writeFileSync(join(cacheDir, CATALOG_CACHE_FILENAME), JSON.stringify(cached), 'utf8');

    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      return jsonResponse(validPayload());
    };
    const result = await refreshCatalog({
      url: 'https://example.test/catalog.json',
      cacheDir,
      ttlMs: 60_000,
      fetchImpl,
      now: () => 30_000, // within the 60s TTL
    });
    expect(fetchCalls).toBe(0);
    expect(result.source).toBe('cache');
    expect(result.payload.catalogVersion).toBe('2026-07-01.1');
  });

  it('refetches when the cache is older than the TTL', async () => {
    const cached = { fetchedAt: 0, payload: validPayload() };
    writeFileSync(join(cacheDir, CATALOG_CACHE_FILENAME), JSON.stringify(cached), 'utf8');

    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      const fresh = validPayload();
      fresh.catalogVersion = '2026-07-02.1';
      return jsonResponse(fresh);
    };
    const result = await refreshCatalog({
      url: 'https://example.test/catalog.json',
      cacheDir,
      ttlMs: 60_000,
      fetchImpl,
      now: () => 90_000, // past the 60s TTL
    });
    expect(fetchCalls).toBe(1);
    expect(result.source).toBe('remote');
    expect(result.payload.catalogVersion).toBe('2026-07-02.1');
  });

  it('falls back to a stale cache when a refetch fails', async () => {
    const cached = { fetchedAt: 0, payload: validPayload() };
    writeFileSync(join(cacheDir, CATALOG_CACHE_FILENAME), JSON.stringify(cached), 'utf8');

    const fetchImpl = async () => {
      throw new Error('offline');
    };
    const result = await refreshCatalog({
      url: 'https://example.test/catalog.json',
      cacheDir,
      ttlMs: 60_000,
      fetchImpl,
      now: () => 90_000, // TTL expired, but refetch fails
    });
    /* A stale-but-valid cache beats the bundled fallback. */
    expect(result.source).toBe('stale-cache');
    expect(result.payload.catalogVersion).toBe('2026-07-01.1');
  });

  it('ignores a corrupt cache file and refetches', async () => {
    writeFileSync(join(cacheDir, CATALOG_CACHE_FILENAME), '{ not valid json', 'utf8');
    const fetchImpl = async () => jsonResponse(validPayload());
    const result = await refreshCatalog({
      url: 'https://example.test/catalog.json',
      cacheDir,
      ttlMs: 60_000,
      fetchImpl,
      now: () => 1000,
    });
    expect(result.source).toBe('remote');
    expect(result.payload.catalogVersion).toBe('2026-07-01.1');
  });

  it('the bundled payload itself validates against the refresh schema', () => {
    /* Guards against drift: the shape we ship must be a shape we would accept. */
    const bundled = buildCatalogPayload();
    const withSources = {
      ...bundled,
      models: bundled.models.map((m) => ({ ...m, source: 'x' })),
    };
    expect(CatalogRefreshSchema.safeParse(withSources).success).toBe(true);
  });
});
