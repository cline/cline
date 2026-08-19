# Agent Patterns

## Interactive CLI Agent

A multi-turn conversational agent in the terminal with streaming output:

```typescript
import { Agent } from "@cline/sdk"
import * as readline from "node:readline"

const agent = new Agent({
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  apiKey: process.env.ANTHROPIC_API_KEY,
  systemPrompt: "You are a helpful assistant. Keep responses concise.",
  tools: [],
})

agent.subscribe((event) => {
  if (event.type === "assistant-text-delta") {
    process.stdout.write(event.text)
  }
})

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function prompt(): void {
  rl.question("\nYou: ", async (input) => {
    const trimmed = input.trim()
    if (!trimmed || trimmed === "exit") {
      rl.close()
      return
    }

    process.stdout.write("\nAssistant: ")

    if (agent.hasRun) {
      await agent.continue(trimmed)
    } else {
      await agent.run(trimmed)
    }

    process.stdout.write("\n")
    prompt()
  })
}

prompt()
```

## Conversational Agent (Slack Bot, Chat App)

Maintain per-thread agents with conversation memory:

```typescript
import { Agent } from "@cline/sdk"

const agents = new Map<string, Agent>()

async function handleMessage(threadId: string, message: string) {
  let agent = agents.get(threadId)
  if (!agent) {
    agent = new Agent({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
      systemPrompt: "You are a concise assistant.",
      tools: [],
    })
    agents.set(threadId, agent)
  }

  const result = agent.hasRun
    ? await agent.continue(message)
    : await agent.run(message)

  return result.outputText
}
```

## Streaming UI

Build a real-time UI by handling events via `subscribe()`:

```typescript
const agent = new Agent({
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  tools: [myTool],
})

agent.subscribe((event) => {
  switch (event.type) {
    case "assistant-text-delta":
      ui.appendText(event.text)
      break
    case "assistant-message":
      ui.endText()
      break
    case "turn-started":
      ui.startTurn(event.iteration)
      break
    case "turn-finished":
      if (event.toolCallCount > 0) ui.showToolCount(event.toolCallCount)
      break
    case "usage-updated":
      ui.updateUsage(event.usage.inputTokens, event.usage.outputTokens)
      break
  }
})

const result = await agent.run("Hello!")
```

## Structured Output via Completion Tool

Use a tool with `completesRun: true` to extract structured data:

```typescript
import { Agent, createTool } from "@cline/sdk"
import { z } from "zod"

const submitReview = createTool({
  name: "submit_review",
  description: "Submit the final code review with structured feedback.",
  inputSchema: z.object({
    summary: z.string(),
    issues: z.array(z.object({
      file: z.string(),
      line: z.number(),
      severity: z.enum(["error", "warning", "info"]),
      message: z.string(),
    })),
    approved: z.boolean(),
  }),
  lifecycle: { completesRun: true },
  execute: async (input) => input,
})

const agent = new Agent({
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  systemPrompt: "Review the code diff and submit structured feedback.",
  tools: [submitReview],
})

const result = await agent.run(diffContent)
const review = result.toolCalls.find(tc => tc.name === "submit_review")
console.log(review?.output)
```

## Agent with Abort/Timeout

```typescript
const agent = new Agent({
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  systemPrompt: "Analyze this data.",
  tools: [],
})

const timeout = setTimeout(() => agent.abort("Timeout"), 30_000)

try {
  const result = await agent.run(data)
  if (result.status === "aborted") {
    console.log("Agent was aborted")
  } else {
    console.log(result.outputText)
  }
} finally {
  clearTimeout(timeout)
}
```

## Agent with Plugins

```typescript
import { Agent } from "@cline/sdk"
import type { AgentPlugin } from "@cline/sdk"

const loggingPlugin: AgentPlugin = {
  name: "logging",
  manifest: { capabilities: ["hooks"] },
  setup() {},
  hooks: {
    beforeTool({ toolCall }) {
      console.log(`Calling tool: ${toolCall.toolName}`)
    },
    afterRun({ result }) {
      console.log(`Completed in ${result.iterations} iterations`)
    },
  },
}

const agent = new Agent({
  providerId: "anthropic",
  modelId: "claude-sonnet-4-6",
  systemPrompt: "You are a helpful assistant.",
  tools: [myTool],
  plugins: [loggingPlugin],
})
```

## Restoring State Across Sessions

Save and restore agent state manually:

```typescript
// Save state
const snapshot = agent.snapshot()
const serialized = JSON.stringify(snapshot.messages)

// Later: restore
const agent2 = new Agent({ ...config })
const messages = JSON.parse(serialized)
agent2.restore(messages)
const result = await agent2.continue("Continue where we left off")
```

For automatic persistence, use `ClineCore` instead.

## Pre-Built Model via Gateway

For advanced provider configuration:

```typescript
import { Agent } from "@cline/sdk"
import { createGateway } from "@cline/llms"

const gateway = createGateway({
  providerConfigs: [
    { providerId: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY },
    { providerId: "openai", apiKey: process.env.OPENAI_API_KEY },
  ],
})

const model = gateway.createAgentModel({
  providerId: "anthropic",
  modelId: "claude-opus-4-7",
})

const agent = new Agent({
  model,
  systemPrompt: "You are a helpful assistant.",
  tools: [],
})
```

## See Also

- `api.md` - Full API reference
- `gotchas.md` - Common pitfalls
- `../tools/REFERENCE.md` - Creating tools
- `../plugins/REFERENCE.md` - Plugin system
