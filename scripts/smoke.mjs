/*
 * stdio JSON-RPC smoke test (spec 13.3).
 *
 * Spawns the built server over stdio, drives the MCP handshake (initialize ->
 * notifications/initialized -> tools/list -> tools/call estimate_cost), and
 * asserts two things:
 *   1. tools/list returns the expected tool surface and estimate_cost returns a
 *      well-formed structured result (a positive USD cost with a usdMicros).
 *   2. stdout carried ONLY valid JSON-RPC: every non-empty line parses as JSON
 *      and looks like a JSON-RPC message. A single stray log byte on stdout
 *      corrupts the MCP stream, so this is the load-bearing assertion.
 *
 * Offline, no API keys. Exits 0 on success, non-zero with a clear message on any
 * failure or a 15s timeout.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverPath = join(here, '..', 'dist', 'index.js');

/* The seven tools that must be present with the ledger off (record_usage is
   opt-in and intentionally absent). */
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
  console.error(`SMOKE FAIL: ${message}`);
  process.exit(1);
}

/* Force the ledger off so the default seven-tool surface is what we assert,
   regardless of the caller's environment. */
const child = spawn('node', [serverPath], {
  env: { ...process.env, MODELCOSTSAVER_LEDGER: 'off', MODELCOSTSAVER_REFRESH: 'off' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let nextId = 1;
function send(method, params) {
  const req = { jsonrpc: '2.0', id: nextId++, method, params };
  child.stdin.write(`${JSON.stringify(req)}\n`);
}
function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

/* Capture EVERY byte stdout emits so we can prove it was JSON-RPC only. */
const stdoutLines = [];
let buffer = '';
const responses = new Map();

const timer = setTimeout(() => fail('timed out after 15s waiting for responses'), 15_000);

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  const parts = buffer.split('\n');
  buffer = parts.pop() ?? '';
  for (const line of parts) {
    if (line.trim() === '') continue;
    stdoutLines.push(line);
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(`non-JSON line on stdout (stdout must be JSON-RPC only): ${JSON.stringify(line)}`);
    }
    if (msg.jsonrpc !== '2.0') {
      fail(`stdout line is not a JSON-RPC 2.0 message: ${line}`);
    }
    if (typeof msg.id === 'number') responses.set(msg.id, msg);
    drive();
  }
});

/* The server logs readiness and shutdown to stderr; surface it only on failure. */
let stderrText = '';
child.stderr.on('data', (d) => {
  stderrText += d.toString();
});

child.on('error', (err) => fail(`failed to spawn server: ${err.message}`));
child.on('close', (code) => {
  if (code !== 0 && code !== null) {
    fail(`server exited with code ${code}. stderr:\n${stderrText}`);
  }
});

let stage = 0;
function drive() {
  /* Stage 1: after initialize (id 1), announce initialized and list tools. */
  if (stage === 0 && responses.has(1)) {
    stage = 1;
    const init = responses.get(1);
    if (!init.result || init.error) fail(`initialize failed: ${JSON.stringify(init.error ?? init)}`);
    notify('notifications/initialized', {});
    send('tools/list', {});
    return;
  }

  /* Stage 2: validate the tool list, then call estimate_cost (id 3). */
  if (stage === 1 && responses.has(2)) {
    stage = 2;
    const list = responses.get(2);
    const tools = list.result?.tools ?? [];
    const names = tools.map((t) => t.name);
    for (const want of EXPECTED_TOOLS) {
      if (!names.includes(want)) fail(`tools/list missing '${want}'. Got: ${names.join(', ')}`);
    }
    if (names.includes('record_usage')) {
      fail('record_usage should be absent with the ledger off');
    }
    send('tools/call', {
      name: 'estimate_cost',
      arguments: { model: 'sonnet', inputTokens: 12000, outputTokens: 1500 },
    });
    return;
  }

  /* Stage 3: validate the structured result and finish. */
  if (stage === 2 && responses.has(3)) {
    stage = 3;
    clearTimeout(timer);
    const call = responses.get(3);
    if (call.error) fail(`estimate_cost errored: ${JSON.stringify(call.error)}`);
    const structured = call.result?.structuredContent;
    if (!structured) fail('estimate_cost returned no structuredContent');
    if (structured.error) fail(`estimate_cost structured error: ${JSON.stringify(structured.error)}`);
    if (typeof structured.cost?.usd !== 'number' || structured.cost.usd <= 0) {
      fail(`estimate_cost returned a non-positive usd: ${JSON.stringify(structured.cost)}`);
    }
    if (!Number.isInteger(structured.cost?.usdMicros) || structured.cost.usdMicros <= 0) {
      fail(`estimate_cost returned a bad usdMicros: ${JSON.stringify(structured.cost)}`);
    }
    if (!structured.catalogVersion) fail('estimate_cost result missing catalogVersion');
    const content = call.result?.content ?? [];
    if (!content.some((c) => c.type === 'text' && typeof c.text === 'string')) {
      fail('estimate_cost returned no human text content block');
    }

    console.error(
      `SMOKE PASS: ${EXPECTED_TOOLS.length} tools listed; estimate_cost = $${structured.cost.usd} ` +
        `(${structured.cost.usdMicros} usdMicros); ${stdoutLines.length} stdout lines, all valid JSON-RPC.`,
    );
    child.kill('SIGTERM');
    process.exit(0);
  }
}

send('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'modelcostsaver-smoke', version: '1.0.0' },
});
