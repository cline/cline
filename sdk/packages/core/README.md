# [experimental] @clinebot/core

`@clinebot/core` is the stateful orchestration layer of the Cline SDK. It
connects the agent runtime, provider settings, storage, default tools, and
session lifecycle into a host-ready runtime.

## What You Get

- session lifecycle and orchestration primitives
- provider settings and account services
- default runtime tools and MCP integration
- storage-backed session and team state helpers
- host-facing Node helpers through `@clinebot/core`

## Installation

```bash
npm install @clinebot/core
```

## Entry Points

- `@clinebot/core`: core contracts, shared utilities, and Node/server helpers for building hosts and runtimes

## Typical Usage

Most host apps should start with `@clinebot/core`.

```ts
import { ClineCore } from "@clinebot/core";

const cline = await ClineCore.create({});

const result = await cline.start({
	config: {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		apiKey: process.env.ANTHROPIC_API_KEY ?? "",
		cwd: process.cwd(),
		mode: "act",
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
		systemPrompt: "You are a concise assistant.",
	},
	prompt: "Summarize this project.",
	interactive: false,
});

console.log(result.result?.text);
await cline.dispose();
```

## Session Bootstrap

`ClineCore.create(...)` also accepts `prepare(input)`.

Use it when a host needs to prepare workspace-scoped runtime state before each
session starts, then apply watcher/extensions/telemetry inputs through
`localRuntime.configOverrides` without widening the shared host contract.

## Main APIs

### Runtime and Sessions

Use `@clinebot/core` for host-facing runtime assembly:

- `ClineCore.create(...)`
- `createRuntimeHost(...)`
- `LocalRuntimeHost`
- `DefaultRuntimeBuilder`

### Default Tools

`@clinebot/core` owns the built-in host tools and executors:

- `createBuiltinTools(...)`
- `createDefaultTools(...)`
- `createDefaultExecutors(...)`

### Storage and Settings

The package also exports storage and settings helpers such as:

- `ProviderSettingsManager`
- `SqliteTeamStore`
- SQLite-backed local session stores and artifacts through `@clinebot/core`

## Related Packages

- `@clinebot/agents`: stateless agent loop and tool primitives
- `@clinebot/llms`: provider/model configuration and handlers

## More Examples

- Repo examples: [apps/examples/cline-sdk](https://github.com/cline/cline/tree/main/apps/examples/cline-sdk)
- Workspace overview: [README.md](https://github.com/cline/cline/blob/main/README.md)
- API and architecture references: [DOC.md](https://github.com/cline/cline/blob/main/DOC.md), [ARCHITECTURE.md](https://github.com/cline/cline/blob/main/ARCHITECTURE.md)
