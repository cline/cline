# Agent API Reference

## Constructor

```typescript
import { Agent } from "@cline/sdk"

const agent = new Agent(config: AgentRuntimeConfig)
```

Also available via factory function:

```typescript
import { createAgent } from "@cline/sdk"

const agent = createAgent(config)
```

## AgentRuntimeConfig

Two config forms exist as a discriminated union:

### With Provider ID (recommended)

```typescript
interface AgentRuntimeConfigWithProvider {
  providerId: string          // e.g. "anthropic", "openai", "gemini"
  modelId: string             // e.g. "claude-sonnet-4-6", "gpt-5.5"
  apiKey?: string             // provider API key
  baseUrl?: string            // custom endpoint
  headers?: Record<string, string>

  systemPrompt?: string
  tools?: AgentTool[]
  initialMessages?: AgentMessage[]
  toolPolicies?: Record<string, ToolPolicy>
  hooks?: Partial<AgentRuntimeHooks>
  plugins?: AgentPlugin[]
}
```

### With Pre-built Model

```typescript
interface AgentRuntimeConfigWithModel {
  model: AgentModel            // pre-built model from gateway

  systemPrompt?: string
  tools?: AgentTool[]
  initialMessages?: AgentMessage[]
  toolPolicies?: Record<string, ToolPolicy>
  hooks?: Partial<AgentRuntimeHooks>
  plugins?: AgentPlugin[]
}
```

Note: there is no top-level `onEvent` field on `AgentRuntimeConfig`. For event streaming, use `agent.subscribe()` or `hooks.onEvent` (see AgentRuntimeHooks below).

## Methods

### run(input)

Start the agent with user input. Returns when the agent loop completes.

```typescript
const result: AgentRunResult = await agent.run("Build a REST API")
```

Input can be a string, an `AgentMessage`, or an array of `AgentMessage[]`.

### continue(input?)

Continue an existing conversation with optional new input.

```typescript
const result = await agent.continue("Now add authentication")
```

### abort(reason?)

Cancel the currently active run.

```typescript
agent.abort("User cancelled")
```

### subscribe(listener)

Register a listener for streaming events.

```typescript
const unsubscribe = agent.subscribe((event: AgentRuntimeEvent) => {
  // handle event
})

// Later: stop listening
unsubscribe()
```

### snapshot()

Get the current runtime state including message history.

```typescript
const state: AgentRuntimeStateSnapshot = agent.snapshot()
```

### restore(messages)

Replace the agent's message history.

```typescript
agent.restore(previousMessages)
```

### hasRun

Boolean property indicating whether `run()` has been called at least once.

```typescript
if (agent.hasRun) {
  await agent.continue(input)
} else {
  await agent.run(input)
}
```

## AgentRunResult

Returned by `run()` and `continue()`.

```typescript
interface AgentRunResult {
  agentId: string
  agentRole?: string
  runId: string
  status: "completed" | "aborted" | "failed"
  iterations: number
  outputText: string
  messages: readonly AgentMessage[]
  usage: AgentUsage
  error?: Error
}
```

### Status Values

- `"completed"` - Agent finished normally
- `"aborted"` - Cancelled via `abort()`
- `"failed"` - Unrecoverable error

## AgentMessage

```typescript
interface AgentMessage {
  id: string
  role: "user" | "assistant" | "tool"
  content: AgentMessagePart[]
  createdAt: number
  metadata?: Record<string, unknown>
  modelInfo?: { id: string; provider: string; family?: string }
  metrics?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    cost?: number
  }
}
```

## AgentUsage

```typescript
interface AgentUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCost?: number
}
```

## AgentRuntimeHooks

```typescript
interface AgentRuntimeHooks {
  beforeRun?(context): AgentStopControl | undefined
  afterRun?(context): void
  beforeModel?(context): AgentBeforeModelResult | undefined
  afterModel?(context): AgentStopControl | undefined
  beforeTool?(context): AgentBeforeToolResult | undefined
  afterTool?(context): AgentAfterToolResult | undefined
  onEvent?(event: AgentRuntimeEvent): void | Promise<void>
}
```

Hooks can intercept and modify behavior at each stage. Return a stop control from `beforeRun`, `afterModel`, or `beforeTool` to halt the agent loop.

`hooks.onEvent` receives the same `AgentRuntimeEvent` types as `agent.subscribe()`, but hook callbacks are awaited (can be async), while `subscribe()` listeners are called synchronously. Use `subscribe()` for UI streaming and `hooks.onEvent` for async side effects like logging to an external service.

## AgentRuntimeStateSnapshot

```typescript
interface AgentRuntimeStateSnapshot {
  messages: readonly AgentMessage[]
  usage: AgentUsage
  iterations: number
  status: string
}
```

## Factory: createAgentRuntime

Lower-level factory that returns the same `Agent` class:

```typescript
import { createAgentRuntime } from "@cline/sdk"

const runtime = createAgentRuntime(config)
```

## See Also

- `REFERENCE.md` - Overview and quick start
- `patterns.md` - Common patterns
- `../tools/REFERENCE.md` - Tool creation
- `../events/REFERENCE.md` - Event types
- `../providers/REFERENCE.md` - Provider setup
