/**
 * Regenerate the bundled catalog.json from the in-memory MODEL_CATALOG.
 *
 * Run from the package root: `npx tsx scripts/gen-catalog.mts`. The output is the
 * flat serialized shape (capabilities as arrays) plus catalogVersion/asOf/source
 * and a per-entry source. Keep catalog.json in sync with the catalog by
 * rerunning this whenever a model or price changes; never hand-edit catalog.json.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCatalogPayload } from '../src/catalog/serialize.ts';

/* Per-model price source = the provider's public pricing page (verify at publish
   time and re-stamp asOf). Local models carry no public price. */
const SOURCES: Record<string, string> = {
  anthropic: 'https://www.anthropic.com/pricing',
  openai: 'https://openai.com/api/pricing',
  gemini: 'https://ai.google.dev/gemini-api/docs/pricing',
  local: 'self-hosted (no public price)',
};

const here = dirname(fileURLToPath(import.meta.url));
const payload = buildCatalogPayload();
const models = payload.models.map((m) => ({ ...m, source: SOURCES[m.provider] ?? 'unknown' }));
const out = {
  catalogVersion: payload.catalogVersion,
  asOf: payload.asOf,
  source: payload.source,
  models,
};

const target = join(here, '..', 'catalog.json');
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
process.stderr.write(`wrote ${target} with ${models.length} models\n`);
