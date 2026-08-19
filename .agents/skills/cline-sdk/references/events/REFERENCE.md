# Events

The Cline SDK has three event layers. Which one you use depends on whether you're working with the standalone `Agent` class or `ClineCore`.

## Which Events Do I Get?

| If you use... | You subscribe with... | You receive... | Text streaming event |
|---|---|---|---|
| Standalone `Agent` | `agent.subscribe()` | `AgentRuntimeEvent` | `assistant-text-delta` |
| `ClineCore` | `cline.subscribe()` | `CoreSessionEvent` | `chunk` (with `payload.type === "text"`) |

These are different event types with different shapes. Do not mix them up.

## Layer 1: AgentRuntimeEvent (Standalone Agent)

Emitted by the `Agent` class via `agent.subscribe()`. This is what you get when using `new Agent(...)` directly. Every event includes a `snapshot` field with the current `AgentRuntimeStateSnapshot`.

### Run Lifecycle

```typescript
{ type: "run-started", snapshot }
{ type: "run-finished", snapshot, result: AgentRunResult }
{ type: "run-failed", snapshot, error: Error }
```

### Turns

```typescript
{ type: "turn-started", snapshot, iteration: number }
{ type: "turn-finished", snapshot, iteration: number, toolCallCount: number }
```

### Text Streaming

```typescript
// Streaming text delta (arrives as chunks during generation)
{ type: "assistant-text-delta", snapshot, iteration: number, text: string, accumulatedText: string }

// Streaming reasoning delta (when model uses extended thinking)
{ type: "assistant-reasoning-delta", snapshot, iteration: number, text: string }

// Complete assistant message after model finishes
{ type: "assistant-message", snapshot, iteration: number, message: AgentMessage, finishReason: string }
```

### Messages

```typescript
// Fired when any message (user or assistant) is added to conversation history
{ type: "message-added", snapshot, message: AgentMessage }
```

### Tool Events

```typescript
{ type: "tool-started", snapshot, toolCall: { toolName: string, toolCallId: string, input: unknown } }
{ type: "tool-updated", snapshot, toolCall: { toolName: string, toolCallId: string }, update: string }
{ type: "tool-finished", snapshot, toolCall: { toolName: string, toolCallId: string }, message: AgentMessage }
```

### Usage

```typescript
{
  type: "usage-updated",
  snapshot,
  usage: {
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens?: number,
    cacheWriteTokens?: number,
    totalCost?: number,
  },
}
```

### Notices

```typescript
{ type: "status-notice", snapshot, message: string, metadata?: Record<string, unknown> }
```

### Subscribing

Use `agent.subscribe()`. Register the listener before calling `run()` to avoid missing early events.

```typescript
const agent = new Agent({
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  apiKey: process.env.ANTHROPIC_API_KEY,
  systemPrompt: "You are a helpful assistant.",
  tools: [],
})

agent.subscribe((event) => {
  switch (event.type) {
    case "assistant-text-delta":
      process.stdout.write(event.text)
      break
    case "tool-started":
      console.log(`\nUsing tool: ${event.toolCall.toolName}`)
      break
    case "usage-updated":
      console.log(`Cost: $${event.usage.totalCost?.toFixed(4)}`)
      break
    case "run-finished":
      console.log(`\nDone: ${event.result.status}`)
      break
  }
})

const result = await agent.run("Hello!")
```

You can also receive events through hooks (these are awaited, so they can be async):

```typescript
const agent = new Agent({
  ...config,
  hooks: {
    onEvent: async (event) => {
      // Same AgentRuntimeEvent types as subscribe()
    },
  },
})
```

## Layer 2: AgentEvent (ClineCore Internal)

When using `ClineCore`, a `RuntimeEventAdapter` translates Layer 1 events into a legacy format called `AgentEvent`. You do not interact with this layer directly -- it is projected into `CoreSessionEvent` for subscribers. The key mappings:

| AgentRuntimeEvent (Layer 1) | AgentEvent (Layer 2) |
|---|---|
| `turn-started` | `iteration_start` |
| `turn-finished` | `iteration_end` |
| `assistant-text-delta` | `content_start` (text) |
| `assistant-message` | `content_end` (text) |
| `tool-started` | `content_start` (tool) |
| `tool-updated` | `content_update` (tool) |
| `tool-finished` | `content_end` (tool) |
| `usage-updated` | `usage` (with computed deltas) |
| `run-finished` | `done` |
| `run-failed` | `error` |
| `run-started`, `message-added` | (suppressed, not emitted) |

This layer exists for backwards compatibility. If you see event types like `content_update` or `iteration_start` in other documentation, they refer to this layer, not to what `agent.subscribe()` emits.

## Layer 3: CoreSessionEvent (ClineCore Subscriber)

Emitted by `ClineCore` via `cline.subscribe()`. These are higher-level session events.

```typescript
type CoreSessionEvent =
  | { type: "chunk"; payload: SessionChunkEvent }
  | { type: "agent_event"; payload: { sessionId: string, event: AgentEvent } }
  | { type: "ended"; payload: SessionEndedEvent }
  | { type: "team_progress"; payload: SessionTeamProgressEvent }
  | { type: "status"; payload: { sessionId: string, status: string } }
  | { type: "hook"; payload: SessionToolEvent }
```

### SessionChunkEvent

```typescript
interface SessionChunkEvent {
  type: "text" | "reasoning"
  text: string
  sessionId: string
}
```

### SessionEndedEvent

```typescript
interface SessionEndedEvent {
  sessionId: string
  finishReason: "completed" | "max_iterations" | "aborted" | "mistake_limit" | "error"
  result?: AgentResult
}
```

### Subscribing

```typescript
cline.subscribe((event) => {
  switch (event.type) {
    case "chunk":
      if (event.payload.type === "text") {
        process.stdout.write(event.payload.text)
      }
      break
    case "ended":
      console.log(`Finished: ${event.payload.finishReason}`)
      break
  }
})
```

Filter by session:

```typescript
cline.subscribe(handler, { sessionId: "specific-session-id" })
```

## Hub Events (Layer 3b)

When ClineCore runs in hub mode (via `backendMode: "hub"` or `"auto"` when a hub is available), events are projected over WebSocket using `HubEventName` types like `assistant.delta`, `iteration.started`, `tool.started`, etc. You do not interact with these directly -- `cline.subscribe()` still gives you `CoreSessionEvent` regardless of backend mode.

## Result Type Differences

The standalone Agent and ClineCore return different result types:

| API | Result type | Text property |
|---|---|---|
| `agent.run()` | `AgentRunResult` | `result.outputText` |
| `cline.start()` / `cline.send()` | `AgentResult` | `result.text` |

## Common Patterns

### Streaming Text (Standalone Agent)

```typescript
agent.subscribe((event) => {
  if (event.type === "assistant-text-delta") {
    process.stdout.write(event.text)
  }
})
```

### Streaming Text (ClineCore)

```typescript
cline.subscribe((event) => {
  if (event.type === "chunk" && event.payload.type === "text") {
    process.stdout.write(event.payload.text)
  }
})
```

### Usage Tracking (Standalone Agent)

```typescript
agent.subscribe((event) => {
  if (event.type === "usage-updated" && event.usage.totalCost) {
    console.log(`Running cost: $${event.usage.totalCost.toFixed(4)}`)
  }
})
```

### Tool Call Logging (Standalone Agent)

```typescript
agent.subscribe((event) => {
  if (event.type === "tool-started") {
    console.log(`Tool started: ${event.toolCall.toolName}`)
  }
  if (event.type === "tool-finished") {
    console.log(`Tool finished: ${event.toolCall.toolName}`)
  }
})
```

## See Also

- `../agent/REFERENCE.md` - Agent runtime overview
- `../clinecore/REFERENCE.md` - ClineCore session management
- `../plugins/REFERENCE.md` - Plugin hooks for lifecycle events
- `../production/REFERENCE.md` - Observability in production
