/*
 * Prepublish guard (spec 11, 13.5): refuse to publish a broken or undated
 * artifact. Runs after tsup in prepublishOnly. Four gates, all must pass:
 *
 *   1. Manifest: runtime deps are EXACTLY @modelcontextprotocol/sdk + zod, with
 *      no workspace: spec and no internal scope (clean-room, npx-installable).
 *   2. Clean-room: dist/index.js contains no @workswarm / @ringdev / @nestjs
 *      import or require, and no Prisma identifier.
 *   3. Catalog: catalog.json validates against the flat serialized schema; every
 *      entry has a non-zero price EXCEPT explicitly-local ones; the catalog and
 *      every entry carry provenance (asOf / source).
 *   4. Bundle: the built server starts over stdio and lists the seven tools.
 *
 * Offline, no keys. Exits non-zero with a clear message on the first failure.
 */

import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const distPath = join(root, 'dist', 'index.js');
const catalogPath = join(root, 'catalog.json');

const EXPECTED_TOOLS = [
  'estimate_cost',
  'predict_cost',
  'select_optimal_model',
  'compare_models',
  'list_models',
  'get_pricing',
  'optimize_request',
];

function fail(message) {
  console.error(`VERIFY FAIL: ${message}`);
  process.exit(1);
}

/* ---- Gate 1: manifest (name + deps are exactly as expected) ------------- */
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/* The package ships under the Workswarm npm org. A scoped public package needs
   `npm publish --access public` (npm defaults scoped packages to restricted). */
const EXPECTED_NAME = '@workswarm/modelcostsaver';
if (pkg.name !== EXPECTED_NAME) {
  fail(`package name must be ${EXPECTED_NAME}; found ${pkg.name || '(none)'}`);
}

const deps = pkg.dependencies ?? {};
const depNames = Object.keys(deps).sort();
const allowed = ['@modelcontextprotocol/sdk', 'zod'];
if (JSON.stringify(depNames) !== JSON.stringify(allowed)) {
  fail(`dependencies must be exactly ${allowed.join(' + ')}; found ${depNames.join(', ') || '(none)'}`);
}
/* Forbid importing OTHER internal packages as runtime deps (would break npx).
   This checks DEPENDENCY names, not this package's own name. */
for (const [name, spec] of Object.entries(deps)) {
  if (String(spec).startsWith('workspace:') || name.startsWith('@workswarm/') || name.startsWith('@ringdev/')) {
    fail(`internal/workspace runtime dependency would break npx: ${name}@${spec}`);
  }
}

/* ---- Gate 2: clean-room (no proprietary identifiers in the bundle) ------ */
let dist;
try {
  dist = readFileSync(distPath, 'utf8');
} catch {
  fail(`dist bundle not found at ${distPath}; run the build first`);
}
/* Strip block comments before scanning so a doc comment cannot trip the gate.
   Line comments are left intact so we do not mangle URLs like https://. */
const distCode = dist.replace(/\/\*[\s\S]*?\*\//g, '');
const forbiddenImport = /(?:from|import|require\()\s*['"]@(?:workswarm|ringdev|nestjs)\//;
if (forbiddenImport.test(distCode)) {
  fail('dist/index.js references an internal/@nestjs package; the bundle is not clean-room');
}
for (const token of ['PrismaService', '@prisma/client', 'WS-SPEC']) {
  if (distCode.includes(token)) {
    fail(`dist/index.js contains a proprietary identifier '${token}'`);
  }
}

/* ---- Gate 3: catalog validates and carries dated, sourced, priced entries */
const CatalogModelSchema = z
  .object({
    id: z.string().min(1),
    alias: z.string().min(1),
    provider: z.string().min(1),
    tier: z.string().min(1),
    capabilities: z.array(z.string()).min(1),
    inputPerMillion: z.number().nonnegative(),
    outputPerMillion: z.number().nonnegative(),
    outputCap: z.number().optional(),
    license: z.string().optional(),
    source: z.string().min(1),
  })
  .passthrough();

const CatalogSchema = z.object({
  catalogVersion: z.string().min(1),
  asOf: z.string().min(1),
  source: z.string().min(1),
  models: z.array(CatalogModelSchema).min(1),
});

let catalogRaw;
try {
  catalogRaw = JSON.parse(readFileSync(catalogPath, 'utf8'));
} catch (err) {
  fail(`catalog.json is missing or not valid JSON: ${err.message}`);
}
const parsed = CatalogSchema.safeParse(catalogRaw);
if (!parsed.success) {
  fail(`catalog.json failed schema validation: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
}
const catalog = parsed.data;

for (const m of catalog.models) {
  const isLocal = m.provider === 'local';
  const priced = m.inputPerMillion > 0 || m.outputPerMillion > 0;
  if (!isLocal && !priced) {
    fail(`non-local model '${m.id}' has a zero price; refusing to publish an unpriced cloud model`);
  }
  if (isLocal && priced) {
    fail(`local model '${m.id}' unexpectedly carries a non-zero price`);
  }
}

/* ---- Gate 4: the bundle starts and lists the seven tools ---------------- */
function listToolsOverStdio() {
  return new Promise((resolve) => {
    const child = spawn('node', [distPath], {
      env: { ...process.env, MODELCOSTSAVER_LEDGER: 'off', MODELCOSTSAVER_REFRESH: 'off' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = '';
    let stderrText = '';
    let nextId = 1;
    const send = (method, params) =>
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params })}\n`);

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      fail(`bundle did not respond within 15s. stderr:\n${stderrText}`);
    }, 15_000);

    child.stderr.on('data', (d) => {
      stderrText += d.toString();
    });
    child.on('error', (err) => fail(`could not spawn the bundle: ${err.message}`));

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() === '') continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          clearTimeout(timer);
          child.kill('SIGTERM');
          fail(`bundle wrote a non-JSON line to stdout: ${JSON.stringify(line)}`);
        }
        if (msg.id === 1) {
          child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
          send('tools/list', {});
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill('SIGTERM');
          resolve((msg.result?.tools ?? []).map((t) => t.name));
        }
      }
    });

    send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'modelcostsaver-verify', version: '1.0.0' },
    });
  });
}

const toolNames = await listToolsOverStdio();
for (const want of EXPECTED_TOOLS) {
  if (!toolNames.includes(want)) {
    fail(`bundle tools/list missing '${want}'. Got: ${toolNames.join(', ')}`);
  }
}

process.stdout.write(
  `verify ok: ${pkg.name}@${pkg.version} publishable. ` +
    `deps=${depNames.join('+')}; clean-room; catalog ${catalog.catalogVersion} (as of ${catalog.asOf}) ` +
    `${catalog.models.length} models priced+sourced; ${EXPECTED_TOOLS.length} tools listed.\n`,
);
