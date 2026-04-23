# [experimental] @clinebot/agents

`@clinebot/agents` is the runtime-agnostic agent loop package in the Cline SDK.
It gives you the core primitives for building tool-using LLM agents without
bringing in session storage, hub transport, or host-specific default tools.

## What You Get

- `Agent` / `createAgent` for running and continuing agent conversations
- `AgentHooks` for lifecycle interception
- event streaming via `onEvent` and `agent.subscribeEvents(...)`
- sub-agent and team primitives for advanced runtimes

## What This Package Does Not Include

`@clinebot/agents` does not ship a full application runtime by itself.

- Default host tools like filesystem access, shell execution, or web fetching live in `@clinebot/core`
- Session persistence and stateful orchestration live in `@clinebot/core`
- Shared hub runtime/session transport lives in `@clinebot/core` (see `@clinebot/core/hub`)

That split keeps this package usable in Node, browser, and custom host
environments where you want to supply your own tools and runtime policy.

## Installation

```bash
npm install @clinebot/agents @clinebot/shared @clinebot/llms zod
```

## Quick Start

```ts
import { z } from "zod";

const getWeather = createTool({
	name: "get_weather",
	description: "Return the current weather for a city.",
	inputSchema: z.object({
		city: z.string(),
	}),
	async execute({ city }) {
		return {
			city,
			forecast: "sunny",
			temperatureC: 22,
		};
	},
});

const agent = new Agent({
	providerId: "anthropic",
	modelId: "claude-sonnet-4-6",
	apiKey: process.env.ANTHROPIC_API_KEY,
	systemPrompt: "You are a concise assistant.",
	tools: [getWeather],
});

const result = await agent.run("What's the weather in San Francisco?");
console.log(result.text);
```

## Core Concepts

### Tools

Use `createTool(...)` from `@clinebot/shared` to define tools with either JSON
Schema or Zod input schemas. The agent exposes the tool to the model and calls
your `execute(...)` handler with validated input plus a `ToolContext`.

```ts
import { createTool } from "@clinebot/shared";
import { z } from "zod";

const summarize = createTool({
	name: "summarize_text",
	description: "Summarize text into a few bullet points.",
	inputSchema: z.object({
		text: z.string(),
	}),
	async execute({ text }) {
		return { summary: text.slice(0, 120) };
	},
});
```

### Events

You can observe execution in two ways:

- pass `onEvent` in `AgentConfig`
- subscribe later with `agent.subscribeEvents(listener)`

`AgentEvent` covers model text/reasoning chunks, tool lifecycle events, usage,
iteration boundaries, completion, and errors.

### Conversation Control

- `agent.run(message)` starts a new run
- `agent.continue(message)` continues the current conversation
- `initialMessages` and `agent.restore(messages)` support resume flows

### Hooks

`AgentHooks` let hosts observe or influence lifecycle stages such as run start,
turn start, tool call start/end, and run completion. This is the right place for
policy checks, telemetry, or injecting additional context.

If you need subprocess-backed hooks, use `@clinebot/core`:

```ts
import { createSubprocessHooks } from "@clinebot/core";
```

### Teams and Spawn

For multi-agent workflows, use `@clinebot/core`:

```ts
import {
	createSpawnAgentTool,
	AgentTeamsRuntime,
	createAgentTeamsTools,
	bootstrapAgentTeams,
} from "@clinebot/core";
```

These helpers provide coordination primitives for delegated runs,
mailboxes, task management, and outcome convergence.

## Entry Points

- `@clinebot/agents`: main package entrypoint
- `@clinebot/agents/browser`: browser-safe bundle

## Related Packages

- `@clinebot/llms`: provider settings, model catalogs, and handler creation
- `@clinebot/core`: stateful runtime assembly, storage, default tools, subprocess hooks, and MCP integration
- `@clinebot/shared`: shared tool contracts and `createTool(...)`
- `@clinebot/rpc`: remote runtime/session transport

## More Examples

- Repo examples: [apps/examples/cline-sdk](https://github.com/cline/sdk/tree/main/apps/examples/cline-sdk)
- Workspace overview: [README.md](https://github.com/cline/sdk/blob/main/README.md)
- API and architecture references: [DOC.md](https://github.com/cline/sdk/blob/main/DOC.md), [ARCHITECTURE.md](https://github.com/cline/sdk/blob/main/ARCHITECTURE.md)
