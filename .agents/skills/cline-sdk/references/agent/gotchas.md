# Agent Gotchas

## Agent Loop Never Stops

If the agent keeps iterating without completing:

- Make sure at least one tool has `lifecycle: { completesRun: true }` if you want the agent to explicitly finish.
- Without any tools, the agent will complete after the model returns text without tool calls.
- If using tools, ensure the system prompt guides the model toward calling the completion tool when done.
- Check that `completesRun` tools return successfully (not throwing errors).

## Tool Errors Count as Mistakes

When a tool's `execute` function throws an exception, the SDK counts it as a "mistake." After too many mistakes, the agent stops with a `mistake_limit` finish reason.

Instead, return errors as structured data:

```typescript
// Bad: throwing
execute: async (input) => {
  throw new Error("File not found")
}

// Good: returning error data
execute: async (input) => {
  return { error: "File not found", path: input.path }
}
```

## run() vs continue()

- Call `run()` for the first interaction. It sets up the conversation.
- Call `continue()` for subsequent messages. It appends to the existing conversation.
- Calling `run()` a second time resets the conversation history.
- Use `agent.hasRun` to check which method to call.

## Browser Compatibility

`@cline/agents` (and by extension, the `Agent` class) is browser-safe with no Node.js dependencies. However, `@cline/core` and `ClineCore` require Node.js 22+. If you import from `@cline/sdk`, you get everything including the Node-only code. For browser usage, import directly from `@cline/agents`:

```typescript
import { Agent } from "@cline/agents"
```

## No Top-Level onEvent on Agent Config

`AgentRuntimeConfig` does not have a top-level `onEvent` field. Passing `onEvent` to `new Agent({ onEvent: ... })` has no effect. There are two ways to receive events:

```typescript
// Option 1: subscribe() - synchronous, best for UI streaming
const agent = new Agent({ ...config })
agent.subscribe((event) => {
  if (event.type === "assistant-text-delta") {
    process.stdout.write(event.text)
  }
})

// Option 2: hooks.onEvent - awaited, best for async side effects
const agent = new Agent({
  ...config,
  hooks: {
    onEvent: async (event) => {
      if (event.type === "assistant-text-delta") {
        await logToService(event.text)
      }
    },
  },
})
```

Both receive the same `AgentRuntimeEvent` types. Prefer `subscribe()` for streaming UI.

## Event Listener Timing

Register event listeners via `subscribe()` before calling `run()`:

```typescript
// Good: subscribe before run
agent.subscribe(handler)
const result = await agent.run(input)

// Bad: subscribing after run starts loses early events
const promise = agent.run(input)
agent.subscribe(handler)  // may miss events
```

## Tool Input Schema Matters

The model uses the tool's `inputSchema` to decide what arguments to pass. A vague or missing schema leads to incorrect tool calls.

- Use `z.enum()` for fixed value sets, not free-form strings
- Describe every property with `.describe()` in Zod or `description` in JSON Schema
- Include constraints (rate limits, max values) in the tool description

## Memory and Long Conversations

The Agent holds all messages in memory. For long-running conversations, memory usage grows with each turn. Consider:

- Using `ClineCore` with compaction for long sessions
- Periodically creating a new agent with a summary of the conversation
- Monitoring `result.usage.totalInputTokens` to track context growth

## Abort Signal Handling in Tools

Long-running tools should respect the abort signal:

```typescript
execute: async (input, context) => {
  for (const item of items) {
    if (context.abortSignal?.aborted) {
      return { partial: results, aborted: true }
    }
    results.push(await process(item))
  }
  return { results }
}
```

## Provider API Key

If you get authentication errors, check:

- `apiKey` is set in the config or via environment variables
- The key matches the `providerId` (e.g., Anthropic key for `providerId: "anthropic"`)
- For OpenAI-compatible providers, both `apiKey` and `baseUrl` are set

See `../providers/REFERENCE.md` for provider-specific setup.

## See Also

- `api.md` - Full API reference
- `patterns.md` - Common patterns
- `../tools/REFERENCE.md` - Tool creation
- `../clinecore/REFERENCE.md` - Use ClineCore for persistence
