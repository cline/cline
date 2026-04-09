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
import * as LlmsProviders from "@clinebot/llms";

const handler = LlmsProviders.createHandler({
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
