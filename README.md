# ModelCostSaver

**Predict the cost of an LLM call before you make it, and pick the cheapest model that still does the job, offline, from your editor.**

[![No API keys](https://img.shields.io/badge/API%20keys-none-brightgreen)](#trust-no-keys-offline-no-telemetry)
[![Offline by default](https://img.shields.io/badge/network-none%20by%20default-brightgreen)](#trust-no-keys-offline-no-telemetry)
[![No telemetry](https://img.shields.io/badge/telemetry-off-brightgreen)](#trust-no-keys-offline-no-telemetry)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Dependencies](https://img.shields.io/badge/runtime%20deps-2-blue)](#trust-no-keys-offline-no-telemetry)

ModelCostSaver is a [Model Context Protocol](https://modelcontextprotocol.io) server. It gives any AI coding agent or IDE a free, zero-config tool that answers the three questions every agent should ask before an LLM call:

1. **What will this prompt cost on each candidate model?** (`predict_cost`, `estimate_cost`)
2. **Which is the cheapest model that meets the task?** (`select_optimal_model`)
3. **How do my options compare side by side?** (`compare_models`)

It is pure pricing-and-routing math over a bundled, dated catalog, so the core needs **no API keys and makes no network calls**.

---

## Quick start

Run it directly with `npx` (no install, no keys):

```bash
npx -y @workswarm/modelcostsaver
```

Or write the config for your editor in one command:

```bash
npx -y @workswarm/modelcostsaver install --client cursor
```

**[Add to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=modelcostsaver&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkB3b3Jrc3dhcm0vbW9kZWxjb3N0c2F2ZXIiXX0=)** &mdash; one click installs it in Cursor. Or drop the block below into `~/.cursor/mcp.json`, or run `npx -y @workswarm/modelcostsaver install --client cursor`.

Listed on the official [MCP registry](https://registry.modelcontextprotocol.io) and editor MCP directories as `io.github.sachinuppal/modelcostsaver`.

---

## The seven tools

| Tool | What it answers |
|---|---|
| `estimate_cost` | Cost of one call when you already know (or can estimate) the token counts. |
| `predict_cost` | Forecast cost across a candidate set from a prompt, before the call. Ranked cheapest-first. |
| `select_optimal_model` | The cheapest model that meets the task tier, capabilities, and budget, with full reasoning. |
| `compare_models` | A side-by-side cost table for a fixed token shape, with `relativeToCheapest`. |
| `list_models` / `get_pricing` | The pricing catalog, filterable by provider, tier, capability, or max input price. |
| `optimize_request` | "I plan to call model X, can I do better?" Returns the cheaper option and the savings. |
| `record_usage` | Append a local usage record (opt-in; off unless `MODELCOSTSAVER_LEDGER=on`). |

Every cost-bearing result carries `catalogVersion` and `asOf` so you can see how fresh the prices are. Every selection carries a `reasoning` array, never a black-box pick.

---

## Trust: no keys, offline, no telemetry

For a tool that sits in your editor, trust is the whole pitch. ModelCostSaver is:

- **No API keys.** The core does pricing math, not provider calls. Nothing to leak.
- **Offline by default.** The core tools return correct answers with no network access. The only outbound request is an opt-in catalog refresh (`MODELCOSTSAVER_REFRESH=on`), a single GET of a static JSON, zod-validated before it can replace the bundled catalog, and it always falls back to the bundle on any failure.
- **No telemetry.** Ever. The default is silent and local. `record_usage` only writes when you set `MODELCOSTSAVER_LEDGER=on`, and only to a JSONL file under your own config dir.
- **Two dependencies.** `@modelcontextprotocol/sdk` and `zod`. Nothing else. Small supply-chain surface, fast `npx` cold start.
- **Apache-2.0.** An open-source developer tool published by Workswarm as `@workswarm/modelcostsaver`. The shipped bundle contains no proprietary or internal-service code: no internal-framework imports and no internal identifiers, just dependency-free pricing-and-routing math.

stdout carries only JSON-RPC; all logs go to stderr.

---

## Install per IDE

ModelCostSaver speaks stdio MCP, so the entry is the same `npx` command everywhere. Use `install --client <name>` to write it idempotently, or paste the block by hand.

### Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{ "mcpServers": { "modelcostsaver": { "command": "npx", "args": ["-y", "@workswarm/modelcostsaver"] } } }
```

```bash
npx -y @workswarm/modelcostsaver install --client cursor
```

### Claude Code

```bash
claude mcp add modelcostsaver -- npx -y @workswarm/modelcostsaver
```

or a `.mcp.json` in the repo root (which `install --client claude` writes):

```json
{ "mcpServers": { "modelcostsaver": { "command": "npx", "args": ["-y", "@workswarm/modelcostsaver"], "env": { "MODELCOSTSAVER_PROVIDERS": "anthropic" } } } }
```

Claude clients run Claude for their own inference, so the install seeds `MODELCOSTSAVER_PROVIDERS=anthropic` as a sensible default for `target: self` recommendations. Override it per call or with the env var. See [Self vs code](#two-axes-self-vs-code).

### Claude Desktop

Add the same `mcpServers` block to `claude_desktop_config.json`.

### VS Code / GitHub Copilot

`.vscode/mcp.json`:

```json
{ "servers": { "modelcostsaver": { "command": "npx", "args": ["-y", "@workswarm/modelcostsaver"], "type": "stdio" } } }
```

```bash
npx -y @workswarm/modelcostsaver install --client vscode
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json` with the same `mcpServers` block, or:

```bash
npx -y @workswarm/modelcostsaver install --client windsurf
```

### Cline / Zed / Antigravity

Same stdio `command`/`args`. Use the matching installer:

```bash
npx -y @workswarm/modelcostsaver install --client cline
npx -y @workswarm/modelcostsaver install --client zed
npx -y @workswarm/modelcostsaver install --client antigravity
```

After adding the server, restart the client and confirm the seven tools appear in the tool list.

---

## Two axes: self vs code

ModelCostSaver advises; it does not route traffic. So every recommendation is filtered to what you can actually act on, along two independent axes.

**Axis 1, availability.** Recommendations are scoped to a set of allowed providers. The default is derived from the connected client (read from the MCP handshake): a Claude client defaults to `anthropic` because its own inference is Claude; multi-provider clients (Cursor, VS Code, Windsurf, Cline, Zed, Antigravity) and unknown clients default to all providers. The scope and its source are always echoed in `reasoning`, and it is overridable: a per-call `providers` arg, then `MODELCOSTSAVER_PROVIDERS`, then config, then the client default, then all.

**Axis 2, target.**

- `target: 'self'` (default): the agent's or your own next inference **in this client**. The Axis-1 scope applies. In Claude Code this means cross-tier Anthropic moves (Opus to Haiku), which you can act on right now.
- `target: 'code'`: a model you will call from **your own application**, where you supply that provider's key. The client scope does not apply, so all in-catalog providers are eligible.

ModelCostSaver is always honest about the gap: if the globally-cheapest model is outside your actionable set, it is surfaced as `cheaperIfAvailable` with the reason, never silently chosen. For example, a Claude Code `target: self` summarize call selects `claude-haiku-4-5` and notes that a cheaper non-Anthropic model exists if you pass `target: code`.

---

## How it predicts

1. **Tokens.** Exact counts if you supply them; otherwise a heuristic estimate (`~4 chars/token`, tunable via `MODELCOSTSAVER_CHARS_PER_TOKEN`). The heuristic is approximate but common-mode across candidates, which is what relative ranking needs. Output tokens come from your explicit value, then the task class cap, then the model cap, then a conservative default.
2. **Cost.** `(inTok / 1e6) * inputPerMillion + (outTok / 1e6) * outputPerMillion`, in full-precision USD and as integer `usdMicros`. A prediction is never rounded to cents.
3. **Selection.** Resolve the target tier (from an explicit `taskClass`, else a transparent keyword/length classifier), filter candidates by tier (degrade up, never below the floor), capabilities, and provider scope, forecast each, drop those over budget into `rejected`, and pick the cheapest survivor. Every step is recorded in `reasoning`, and a `fallbackChain` is returned for retry-on-failure.

---

## Configuration

All config is optional. Precedence: tool-call arg, then env var, then `modelcostsaver.config.json` (cwd, then your user config dir), then the built-in default.

| Key | Env | Default | Purpose |
|---|---|---|---|
| tier overrides | `MODELCOSTSAVER_TRIVIAL_MODEL`, `_FAST_MODEL`, `_STANDARD_MODEL`, `_REASONING_MODEL` | catalog cheapest per tier | Pin a preferred model per tier. |
| providers | `MODELCOSTSAVER_PROVIDERS` | client-derived | Allowlist for recommendations (Axis 1). |
| default provider | `MODELCOSTSAVER_PROVIDER` | none | Bias `select_optimal_model`. |
| include local | `MODELCOSTSAVER_INCLUDE_LOCAL` | `off` | Surface self-hosted / $0 models. |
| chars/token | `MODELCOSTSAVER_CHARS_PER_TOKEN` | `4` | Tune the token estimator. |
| refresh | `MODELCOSTSAVER_REFRESH` | `off` | Enable the opt-in remote catalog refresh. |
| catalog url | `MODELCOSTSAVER_CATALOG_URL` | bundled | Override the refresh source. |
| ledger | `MODELCOSTSAVER_LEDGER` | `off` | Enable the local `record_usage` write. |
| telemetry | `MODELCOSTSAVER_TELEMETRY` | `off` | Kept off; listed for transparency. |

---

## Pricing data

Prices change often, so ModelCostSaver ships a versioned, dated seed and is honest about its freshness.

- The bundled `catalog.json` carries a `catalogVersion`, an `asOf` date, and a `source` on every entry.
- Default behavior is offline: it reads only the bundled catalog.
- `MODELCOSTSAVER_REFRESH=on` fetches a single static JSON, validates it with zod, caches it with a TTL, and falls back to the bundle on any failure.
- A `pricingOverrides` map in `modelcostsaver.config.json` lets you inject negotiated or enterprise rates without forking.

**Verify before you trust a number for billing.** The seed is re-checked against each provider's public pricing page at release; the `asOf` date tells you when. For absolute precision in your own accounting, confirm against your provider invoice.

---

## Development

```bash
npm install        # first time only
npm run build      # tsup bundle to dist/index.js
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run smoke      # stdio JSON-RPC smoke test (asserts stdout stays clean)
```

---

## License

[Apache-2.0](./LICENSE). See [NOTICE](./NOTICE).
