# Agent Runtime

The `Agent` class (also exported as `AgentRuntime`) is the lightweight, stateless agent loop from `@cline/agents`. It handles the core iteration cycle: send messages to an LLM, execute tool calls, collect results, and repeat until the task is done.

## When to Use Agent

| Use Agent when... | Use ClineCore instead when... |
|---|---|
| You want a simple agent with custom tools | You need built-in tools (bash, editor, etc.) |
| You want minimal dependencies | You need session persistence |
| You need browser compatibility | You need config discovery from `.cline/` |
| You're building a stateless worker | You need multi-process session sharing |
| You want full control over the runtime | You want batteries-included setup |

## Quick Start

```typescript
import { Agent } from "@cline/sdk"

const agent = new Agent({
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  apiKey: process.env.ANTHROPIC_API_KEY,
  systemPrompt: "You are a helpful assistant.",
  tools: [],
})

const result = await agent.run("What is the capital of France?")
console.log(result.outputText)
```

## Core Concepts

The Agent operates in a loop:
1. Accept user input (string, message, or array of messages)
2. Build turn context (system prompt, messages, tools)
3. Call the LLM provider
4. If the model returns tool calls, execute them and loop back to step 3
5. If the model returns text without tool calls, the run completes
6. Emit events throughout for streaming

The agent is stateless in the sense that it does not persist anything to disk. Conversation history is held in memory and can be accessed via `snapshot()`.

## Key APIs

- `new Agent(config)` or `createAgent(config)` - Create an agent
- `agent.run(input)` - Start a run with user input
- `agent.continue(input?)` - Continue an existing conversation
- `agent.abort(reason?)` - Cancel an active run
- `agent.subscribe(listener)` - Listen to streaming events
- `agent.snapshot()` - Get current runtime state
- `agent.restore(messages)` - Replace message history

See `api.md` for full API details.

## Multi-Turn Conversations

```typescript
const agent = new Agent({
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  tools: [],
})

const first = await agent.run("What is 2 + 2?")
console.log(first.outputText)

const second = await agent.continue("Now multiply that by 3")
console.log(second.outputText)
```

Use `agent.hasRun` to check if a run has already been executed, which determines whether to call `run()` or `continue()`.

## Event Streaming

Use `agent.subscribe()` to stream events in real time. Register the listener before calling `run()` to avoid missing early events.

There is no top-level `onEvent` field on the Agent config. For an async alternative, use `hooks.onEvent` (see `api.md` and `gotchas.md`).

```typescript
const agent = new Agent({
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  tools: [],
})

agent.subscribe((event) => {
  if (event.type === "assistant-text-delta") {
    process.stdout.write(event.text)
  }
})

const result = await agent.run("What is the capital of France?")
```

See `events/REFERENCE.md` for the full event type catalog.

## Next Steps

- `api.md` - Full Agent API reference
- `patterns.md` - Common patterns and best practices
- `gotchas.md` - Pitfalls and debugging
- `../tools/REFERENCE.md` - Creating custom tools
- `../events/REFERENCE.md` - Event system details
- `../providers/REFERENCE.md` - Provider configuration
