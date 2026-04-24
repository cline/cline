# [experimental] @clinebot/llms

`@clinebot/llms` is the model and provider layer for the Cline SDK. It gives
you typed provider settings, model catalogs, shared gateway contracts, and
AI SDK-backed handler creation for supported LLM backends.

## What You Get

- `@clinebot/llms/runtime` for declarative config and runtime registry creation
- `@clinebot/llms/providers` for handler creation and provider settings/types
- `@clinebot/llms/models` for model catalogs and query helpers
- `@clinebot/llms` root exports for the gateway registry and shared llm contracts

## Installation

```bash
npm install @clinebot/llms zod
```

## Quick Start

```ts
import { createHandler } from "@clinebot/llms";

const handler = createHandler({
	providerId: "anthropic",
	apiKey: process.env.ANTHROPIC_API_KEY ?? "",
	modelId: "claude-sonnet-4-6",
});

for await (const chunk of handler.createMessage("You are a concise assistant.", [
	{ role: "user", content: [{ type: "text", text: "Say hello." }] },
])) {
	console.log(chunk);
}
```

## Main APIs

### Runtime

Use `createLlmsRuntime(...)` when you want a small registry around:

- configured providers and their default models
- builtin provider discovery via `getBuiltInProviders()`
- custom provider registration via `registerBuiltinProvider(...)`
- handler creation for builtin or custom providers

Preferred import:

```ts
import { createLlmsRuntime, defineLlmsConfig } from "@clinebot/llms/runtime";
```

### Providers

Use `@clinebot/llms/providers` for:

- `createHandler(...)` and `createHandlerAsync(...)`
- `ProviderSettings` and `ProviderSettingsSchema`
- `ProviderConfig`
- `Message` and `ApiStreamChunk`

Built-in providers are routed through the internal gateway registry and backed by
AI SDK provider implementations. Shared gateway contracts are exported from both
`@clinebot/llms` and `@clinebot/shared`.

### Models

Use `@clinebot/llms/models` when you need generated provider/model metadata for
selection UIs, defaults, or validation.

## Entry Points

- `@clinebot/llms`: runtime-focused convenience entrypoint
- `@clinebot/llms/node`: explicit Node/runtime entrypoint
- `@clinebot/llms/browser`: browser-safe bundle
- `@clinebot/llms/runtime`: focused runtime entrypoint
- `@clinebot/llms/models`: model catalog/query entrypoint
- `@clinebot/llms/providers`: provider handler/settings entrypoint

## Related Packages

- `@clinebot/agents`: agent loop and tool execution
- `@clinebot/core`: stateful runtime assembly and provider settings storage

## More Examples

- Workspace overview: [README.md](https://github.com/cline/cline/blob/main/README.md)
- API and architecture references: [DOC.md](https://github.com/cline/cline/blob/main/DOC.md), [ARCHITECTURE.md](https://github.com/cline/cline/blob/main/ARCHITECTURE.md)

## Live Provider Smoke Test

Use this for API-key-backed provider validation against real endpoints.

1. Ensure provider keys are present in your environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `CLINE_API_KEY`, etc.).
2. Use the sample config at `packages/llms/scripts/live-providers.example.json` as the providers list.
3. Run:

```bash
LLMS_LIVE_TESTS=1 \
LLMS_LIVE_PROVIDERS_PATH=/absolute/path/to/packages/llms/scripts/live-providers.example.json \
bun -F @clinebot/llms run test:live
```

Reasoning-focused live run (same command, different flags):

```bash
LLMS_LIVE_REASONING_TESTS=1 \
LLMS_LIVE_REASONING_PROVIDERS_PATH=/absolute/path/to/packages/llms/scripts/live-providers.reasoning.example.json \
bun -F @clinebot/llms run test:live
```

Tool-use-focused live run (same command, different flags):

```bash
LLMS_LIVE_TOOL_TESTS=1 \
LLMS_LIVE_TOOL_PROVIDERS_PATH=/absolute/path/to/packages/llms/scripts/live-providers.tools.example.json \
bun -F @clinebot/llms run test:live
```

Optional:

- `LLMS_LIVE_PROVIDER_TIMEOUT_MS=120000` to increase per-provider timeout.
- `LLMS_LIVE_PROVIDER_RETRIES=2` to retry transient upstream/provider failures per provider (total attempts = retries + 1).
- Point `LLMS_LIVE_PROVIDERS_PATH` to a custom file if you want a narrower provider set.
- Point `LLMS_LIVE_REASONING_PROVIDERS_PATH` to a custom file for reasoning-enabled suites.
- Point `LLMS_LIVE_TOOL_PROVIDERS_PATH` to a custom file for tool-use suites.

Per-provider live assertions are configured in the JSON via `expectations`:

- `requireUsage`: fail if no `usage` chunk is emitted (defaults to `true`; set to `false` to opt out).
- `requireCacheReadTokens`: fail unless `cacheReadTokens > 0` (auto-runs at least 2 attempts with a long cache probe prompt if no prompt override is provided).
- `minCacheReadTokens`: stricter cache floor check.
- `requireReasoningChunk`: fail unless at least one reasoning chunk is emitted.
- `requireNoReasoningChunk`: fail if any reasoning chunk is emitted.
- `minInputTokens` / `minOutputTokens`: enforce lower bounds.
- `requireToolCall`: fail unless at least one `tool_calls` chunk is emitted.

In reasoning suites, set `requireReasoningSignal: true` to require either a reasoning chunk or `thoughtsTokenCount > 0` (provider-dependent; can be flaky on some endpoints).
For GLM/Z.AI thinking checks, use `packages/llms/scripts/live-providers.glm-reasoning.example.json`; it covers native `zai` and routed `openrouter` models with thinking-on and thinking-off expectations.

### Adding A Model To Live Tests

Add a new entry under the `providers` object in either config file:

- Cache/smoke suite: `packages/llms/scripts/live-providers.example.json`
- Reasoning suite: `packages/llms/scripts/live-providers.reasoning.example.json`
- GLM/Z.AI reasoning suite: `packages/llms/scripts/live-providers.glm-reasoning.example.json`
- Tool-use suite: `packages/llms/scripts/live-providers.tools.example.json`

Minimal smoke/cache entry:

```json
"my-openai-model": {
  "settings": {
    "provider": "openai",
    "model": "gpt-5.4"
  },
  "expectations": {
    "requireUsage": true
  }
}
```

Cache-asserted entry (auto-enforces multi-run cache probe):

```json
"my-cache-model": {
  "settings": {
    "provider": "openai",
    "model": "gpt-5.4"
  },
  "expectations": {
    "requireUsage": true,
    "requireCacheReadTokens": true
  }
}
```

Reasoning entry:

```json
"my-reasoning-model": {
  "settings": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "reasoning": {
      "effort": "high"
    }
  },
  "expectations": {
    "requireUsage": true,
    "requireReasoningChunk": true
  }
}
```

Tool-use entry:

```json
"my-tools-model": {
  "settings": {
    "provider": "openai",
    "model": "gpt-5.4"
  },
  "expectations": {
    "requireUsage": true,
    "requireToolCall": true
  }
}
```
