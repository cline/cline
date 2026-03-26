# [experimental] @clinebot/llms

`@clinebot/llms` is the model and provider layer for the Cline SDK. It gives
you typed provider settings, model catalogs, and handler creation for supported
LLM backends.

## What You Get

- `providers` for creating runtime handlers and working with provider settings
- `models` for browsing generated model catalogs
- `defineLlmsConfig(...)` for declarative SDK config
- `createLlmsSdk(...)` for higher-level provider/model workflows

## Installation

```bash
npm install @clinebot/llms zod
```

## Quick Start

```ts
import { LlmsProviders } from "@clinebot/llms";

const handler = LlmsProviders.createHandler({
	provider: "anthropic",
	apiKey: process.env.ANTHROPIC_API_KEY ?? "",
	model: "claude-sonnet-4-6",
});

const stream = handler.createMessage({
	systemPrompt: "You are a concise assistant.",
	messages: [{ role: "user", content: [{ type: "text", text: "Say hello." }] }],
});

for await (const chunk of stream) {
	console.log(chunk);
}
```

## Main APIs

### Providers

Use the `providers` namespace for:

- `createHandler(...)` and `createHandlerAsync(...)`
- `ProviderSettings` and `ProviderSettingsSchema`
- `ProviderConfig`
- `Message` and `ApiStreamChunk`

### Models

Use the `models` namespace when you need generated provider/model metadata for
selection UIs, defaults, or validation.

## Entry Points

- `@clinebot/llms`: default package entrypoint
- `@clinebot/llms/node`: explicit Node/runtime entrypoint
- `@clinebot/llms/browser`: browser-safe bundle

## Related Packages

- `@clinebot/agents`: agent loop and tool execution
- `@clinebot/core`: stateful runtime assembly and provider settings storage

## More Examples

- Workspace overview: [README.md](https://github.com/cline/cline/blob/main/README.md)
- API and architecture references: [DOC.md](https://github.com/cline/cline/blob/main/DOC.md), [ARCHITECTURE.md](https://github.com/cline/cline/blob/main/ARCHITECTURE.md)
