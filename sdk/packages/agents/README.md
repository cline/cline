# [experimental] @cline/agents

`@cline/agents` is the runtime-agnostic agent loop package in the Cline SDK.
It gives you the core primitives for building tool-using LLM agents without
bringing in session storage, hub transport, or host-specific default tools.

## What You Get

- `Agent` / `AgentRuntime` — the same class under two names — for running and
  continuing tool-using agent conversations
- `createAgent` / `createAgentRuntime` — factory-function equivalents
- `AgentRuntimeHooks` for lifecycle interception (`beforeRun`, `afterRun`,
  `beforeModel`, `afterModel`, `beforeTool`, `afterTool`, `onEvent`)
- Event streaming via `agent.subscribe(listener)` and the `hooks.onEvent`
  callback
- Plugin setup callbacks for contributing tools and hooks at boot

## What This Package Does Not Include

`@cline/agents` does not ship a full application runtime by itself.

- Default host tools like filesystem access, shell execution, or web fetching live in `@cline/core`
- Session persistence and stateful orchestration live in `@cline/core`
- Shared hub runtime/session transport lives in `@cline/core` (see `@cline/core/hub`)
- Sub-agent and team coordination primitives live in `@cline/core`

That split keeps this package usable in Node, browser, and custom host
environments where you want to supply your own tools and runtime policy.

## Installation

```bash
npm install @cline/agents @cline/shared @cline/llms
```

## Quick Start

```ts
import { Agent } from "@cline/agents";
import type { AgentTool } from "@cline/shared";

const getWeather: AgentTool<{ city: string }, { forecast: string }> = {
	name: "get_weather",
	description: "Return the current weather for a city.",
	inputSchema: {
		type: "object",
		properties: { city: { type: "string" } },
		required: ["city"],
	},
	async execute({ city }) {
		return { forecast: `sunny in ${city}` };
	},
};

const agent = new Agent({
	providerId: "anthropic",
	modelId: "claude-sonnet-4-6",
	apiKey: process.env.ANTHROPIC_API_KEY,
	systemPrompt: "You are a concise assistant.",
	tools: [getWeather],
});

const result = await agent.run("What's the weather in San Francisco?");
console.log(result.outputText);
```

## Two Ways to Configure

`Agent` / `AgentRuntime` accepts two config shapes:

**Provider form** — friendly entrypoint. The runtime builds an `AgentModel` for
you via `@cline/llms`:

```ts
new Agent({
	providerId: "openai",
	modelId: "gpt-5",
	apiKey: process.env.OPENAI_API_KEY,
	// baseUrl, headers also supported
	tools: [/* ... */],
});
```

**Model form** — advanced. Supply a pre-built `AgentModel` directly. Useful
when the host already owns gateway construction (this is what `@cline/core`
uses internally):

```ts
import { createGateway } from "@cline/llms";

const gateway = createGateway({ providerConfigs: [/* ... */] });
const model = gateway.createAgentModel({ providerId, modelId });

new Agent({
	model,
	tools: [/* ... */],
});
```

## Core Concepts

### Tools

Tools conform to the `AgentTool<TInput, TOutput>` interface from
`@cline/shared`. Each tool has a JSON Schema `inputSchema` and an
`execute(input, context)` function that returns the tool output directly:

```ts
import type { AgentTool } from "@cline/shared";

const summarize: AgentTool<{ text: string }, { summary: string }> = {
	name: "summarize_text",
	description: "Summarize text into a short preview.",
	inputSchema: {
		type: "object",
		properties: { text: { type: "string" } },
		required: ["text"],
	},
	async execute({ text }, context) {
		// context.signal — aborts when the run is cancelled
		// context.emitUpdate(...) — stream progress as `tool-updated` events
		return { summary: text.slice(0, 120) };
	},
};
```

The runtime wraps successful tool outputs in an internal tool-result message.
Throw from `execute(...)` to report a tool failure, or use an `afterTool` hook
to transform the internal `AgentToolResult` envelope.

### Events

Subscribe to the `AgentRuntimeEvent` stream in one of two ways:

```ts
// 1. Attach a listener after construction. Returns an unsubscribe function.
const unsubscribe = agent.subscribe((event) => {
	if (event.type === "assistant-text-delta") {
		process.stdout.write(event.text);
	}
});

// 2. Register an `onEvent` hook at construction time.
new Agent({
	providerId,
	modelId,
	apiKey,
	hooks: {
		onEvent(event) {
			// fires for every runtime event
		},
	},
});
```

`AgentRuntimeEvent` covers run/turn boundaries, assistant text and reasoning
deltas, tool lifecycle, usage updates, and run completion/failure. See
`AgentRuntimeEvent` in `@cline/shared` for the full union.

### Conversation Control

- `agent.run(input)` — start a run. `input` may be a string, an `AgentMessage`,
  or an array of messages. Also accepts `undefined` to continue without adding
  a new user turn.
- `agent.continue(input?)` — convenience alias for `run(input?)`.
- `agent.abort(reason?)` — cancel the active run. `.run()` resolves with
  `status: "aborted"`.
- `agent.snapshot()` — immutable view of the current
  `AgentRuntimeStateSnapshot` (messages, usage, iteration, status, etc.).
- `agent.restore(messages)` — replace the conversation with a persisted
  message array. Resets run/turn state but preserves subscribers, tools,
  hooks, plugins, and the model.
- `initialMessages` in the constructor seeds the conversation on boot.

### Hooks

Pass a `hooks` bag (`AgentRuntimeHooks`) to observe or influence the loop.
All hooks may be async; any that return `{ stop: true, reason }` will halt the
run with an `aborted` status.

```ts
new Agent({
	providerId,
	modelId,
	apiKey,
	tools: [/* ... */],
	hooks: {
		beforeModel({ request }) {
			// mutate messages/tools/options before the model call
			return { options: { temperature: 0.2 } };
		},
		beforeTool({ tool, input }) {
			// block a tool call based on policy
			if (tool.name === "get_weather" && !(input as { city?: string }).city) {
				return { skip: true, reason: "city required" };
			}
			return undefined;
		},
		afterRun({ result }) {
			console.log("done", result.usage);
		},
	},
});
```

For richer, host-side hook orchestration (15-stage `HookEngine`,
subprocess-backed hooks, MCP extensions), use `@cline/core`.

### Plugins

Plugins can contribute tools and hooks at setup time:

```ts
import type { AgentRuntimePlugin } from "@cline/shared";

const loggingPlugin: AgentRuntimePlugin = {
	name: "logging",
	setup({ agentId }) {
		return {
			hooks: {
				afterTool({ tool, result }) {
					console.log(agentId, tool.name, result.isError);
					return undefined; // hook may return an AgentAfterToolResult
				},
			},
		};
	},
};

new Agent({
	providerId,
	modelId,
	apiKey,
	plugins: [loggingPlugin],
});
```

### Teams and Spawn

For multi-agent workflows, use `@cline/core`:

```ts
import {
	createSpawnAgentTool,
	AgentTeamsRuntime,
	createAgentTeamsTools,
	bootstrapAgentTeams,
} from "@cline/core";
```

These helpers provide coordination primitives for delegated runs,
mailboxes, task management, and outcome convergence.

## Entry Point

- `@cline/agents` — the single package entrypoint. The `package.json`
  `exports` map automatically serves a browser-safe bundle when bundlers
  resolve the `browser` condition.

## Related Packages

- `@cline/shared`: shared types (`AgentTool`, `AgentMessage`,
  `AgentRuntimeEvent`, `AgentRuntimeHooks`, etc.)
- `@cline/llms`: provider settings, model catalogs, and gateway/handler
  creation
- `@cline/core`: stateful runtime assembly, storage, default tools,
  subprocess hooks, hub transport, and MCP integration

## More Examples

- Repo examples:
  [examples/plugins](https://github.com/cline/sdk/tree/main/examples/plugins),
  [examples/hooks](https://github.com/cline/sdk/tree/main/examples/hooks),
  [examples/cron](https://github.com/cline/sdk/tree/main/examples/cron)
- Workspace overview: [README.md](https://github.com/cline/sdk/blob/main/README.md)
- API and architecture references:
  [DOC.md](https://github.com/cline/sdk/blob/main/DOC.md),
  [ARCHITECTURE.md](https://github.com/cline/sdk/blob/main/ARCHITECTURE.md)
