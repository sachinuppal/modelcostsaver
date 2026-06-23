# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Code and pricing data are versioned independently: a code change bumps the
package version; a price change bumps the catalog (`catalogVersion` / `asOf`).

## [0.1.1] - 2026-06-23

Corrected stale list prices (haiku, opus 4.7/4.8, gemini-2.5-flash,
gemini-2.5-flash-lite, o3) against current provider pricing; added mcpName +
server.json for the official MCP registry; added Add-to-Cursor link.

### Changed

- **Pricing catalog refresh** (catalog `2026-06-23.1` to `2026-06-23.2`, same
  `asOf`): corrected six stale list prices against current provider pricing
  pages. Per 1M tokens (input / output): claude-haiku-4-5 0.8/4 to 1.0/5.0;
  claude-opus-4-7 and claude-opus-4-8 15/75 to 5/25; gemini-2.5-flash-lite
  0.075/0.30 to 0.10/0.40; gemini-2.5-flash 0.15/0.60 to 0.30/2.50; o3 10/40 to
  2/8. All other models unchanged. `catalog.json` regenerated from the catalog.

### Added

- **`mcpName` in package.json** and a **`server.json`** manifest, both naming the
  server `io.github.sachinuppal/modelcostsaver`, so the official MCP registry can
  verify npm package ownership.
- **Add-to-Cursor deeplink** in the README install section plus a note that the
  server is listed on the MCP registries.

### Security

- The remaining npm audit advisories are dev-toolchain only (esbuild dev server
  via vite/vitest, never run by this package) and are deferred: clearing them
  needs a breaking vitest 4 upgrade, and the shipped artifact has only two
  runtime dependencies (`@modelcontextprotocol/sdk`, `zod`).

[0.1.1]: #011---2026-06-23

## [0.1.0] - 2026-06-23

The first release. An offline, zero-config MCP server that predicts the cost of
an LLM call before it is made and recommends the cheapest model that still meets
the task.

### Added

- **MCP stdio server** built on `@modelcontextprotocol/sdk`, with stderr-only
  logging so stdout carries only JSON-RPC. Graceful shutdown on SIGINT/SIGTERM.
- **Seven tools**, each with a zod input schema and a structured result:
  `estimate_cost`, `predict_cost`, `select_optimal_model`, `compare_models`,
  `list_models` / `get_pricing`, `optimize_request`, and the opt-in
  `record_usage`.
- **Predictive engine**: a heuristic token estimator, full-precision USD plus
  integer `usdMicros` cost math (a prediction is never rounded to cents), and a
  deterministic, explainable selection algorithm that returns a `reasoning`
  array and a `fallbackChain` on every decision.
- **Two-axis client-aware scoping**: recommendations are filtered to an
  availability scope (derived from the connected client, overridable) and a
  recommendation target (`self` vs `code`). A cheaper out-of-scope model is
  surfaced honestly as `cheaperIfAvailable`, never silently chosen.
- **Bundled, dated pricing catalog** (`catalog.json`) with `catalogVersion`, an
  `asOf` date, and a per-entry `source`. Exposed as the `modelcostsaver://catalog`
  MCP resource.
- **Opt-in catalog refresh** (`MODELCOSTSAVER_REFRESH=on`): fetches a static JSON,
  validates it with zod before it can replace the in-memory catalog, caches it
  with a TTL, and always falls back to the bundle on any failure.
- **MCP prompts** (`modelcostsaver`, `modelcostsaver-setup`) that bias an agent toward
  forecasting cost and picking the cheapest sufficient model.
- **IDE install helper**: `modelcostsaver install --client <name>` writes the stdio
  server entry idempotently for Cursor, Claude Code, VS Code, Windsurf, Cline,
  Zed, and Antigravity.
- **Config resolution** with the precedence tool-arg, env, `modelcostsaver.config.json`,
  then default; tier overrides, provider scope, local-model gating, tokenizer
  divisor, refresh, and ledger keys.
- **Verification**: a stdio JSON-RPC smoke test that asserts the structured
  result and a clean stdout, and a publishable-catalog verifier that blocks a
  malformed or undated catalog.

### Trust posture

- No API keys required for the core.
- No network calls by default.
- No telemetry.
- Two runtime dependencies (`@modelcontextprotocol/sdk`, `zod`).
- Apache-2.0.

[0.1.0]: #010---2026-06-23
