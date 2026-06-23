/**
 * Server-level instructions delivered to the client on initialize.
 *
 * MCP has no way for a server to auto-invoke a tool, so this text only biases
 * the agent toward cost discipline at the natural moments: forecast before a
 * non-trivial call, prefer the cheapest tier that meets the task, and sanity
 * check habitual model picks.
 */

export const SERVER_INSTRUCTIONS = [
  'ModelCostSaver predicts the cost of an LLM call before you make it and recommends',
  'the cheapest model that still meets the task. It is offline, needs no API',
  'keys, and makes no network calls for its core tools.',
  '',
  'Use it like this:',
  '- Before any non-trivial LLM call, call select_optimal_model with the task and',
  '  an estimated token shape. It returns the cheapest capable model, the',
  '  reasoning, and a fallbackChain.',
  '- To forecast cost across candidates, call predict_cost with the prompt.',
  '- To sanity check a habitual choice (for example always reaching for Opus),',
  '  call optimize_request with the model you planned to use; it shows the',
  '  savings of a cheaper capable model.',
  '- compare_models gives a side-by-side cost table; list_models / get_pricing',
  '  returns the catalog.',
  '',
  'Two recommendation axes:',
  '- target=self (default): the cheapest model for YOUR own next inference in',
  '  this client. In an Anthropic-only client the recommendation stays on',
  '  Anthropic; a globally cheaper option is surfaced as cheaperIfAvailable.',
  '- target=code: a model you will call from your own application; all providers',
  '  are eligible because you supply that key in your app.',
  '',
  'Costs are in full-precision USD plus an integer usdMicros (a fractional-cent',
  'call never rounds to zero). Token counts are estimates unless you supply exact',
  'counts. Every cost result carries catalogVersion and asOf so you can see how',
  'fresh the pricing is. If a call fails with a rate-limit, quota, or 5xx error,',
  'retry on the next model in the fallbackChain.',
].join('\n');
