<p align="center">
  <img src="https://github.com/user-attachments/assets/a05da977-2cb7-498a-88ca-20f24c9562e1" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://docs.cline.bot/sdk/overview" target="_blank"><strong>Docs</strong></a>
</td>
<td align="center">
<a href="https://docs.cline.bot/sdk/quickstart" target="_blank"><strong>Quickstart</strong></a>
</td>
<td align="center">
<a href="https://docs.cline.bot/sdk/examples" target="_blank"><strong>Examples</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Feature Requests</strong></a>
</td>
</tbody>
</table>
</div>

The Cline SDK is a TypeScript framework for building AI agents that can edit files, run shell commands, browse the web, call APIs, and use any custom tool you give them. It's the same engine that powers [Cline](https://github.com/cline/cline), packaged as a library you can embed in your own applications.

```typescript
import { Agent } from "@clinebot/sdk"

const agent = new Agent({
  providerId: "cline",
  modelId: "openai/gpt-5.5",
  systemPrompt: "You are a helpful coding assistant.",
  tools: [],
})

const result = await agent.run("Create a REST API with Express and TypeScript")
console.log(result.text)
```

That's it. The agent streams its response, calls tools if you give it any, and returns when the task is done.

## Install

```bash
npm install @clinebot/sdk
```

## What You Can Build

Coding agents, Slack bots, scheduled automations, code review pipelines, multi-agent teams, IDE integrations -- anything that benefits from an LLM that can take actions, not just generate text.

```typescript
// Slack bot: each thread gets its own agent with conversation memory
const agents = new Map<string, Agent>()

async function handleMessage(threadId: string, message: string) {
  let agent = agents.get(threadId)
  if (!agent) {
    agent = new Agent({
      providerId: "gemini",
      modelId: "gemini-3.1-pro-preview",
      systemPrompt: "You are a concise Slack assistant.",
      tools: [],
    })
    agents.set(threadId, agent)
  }

  const result = agent.hasRun
    ? await agent.continue(message)
    : await agent.run(message)

  return result.text
}
```

Explore full working examples in [`apps/examples/`](apps/examples):

| Example | Description |
|---------|-------------|
| [Plugin](apps/examples/cline-plugin) | Custom tools with workspace-aware context, lifecycle hooks, and branch-level safety policies |
| [Subagent Orchestration](apps/examples/subagent-plugin) | Spawn and manage background agents with presets, skills, and cross-agent handoffs |
| [Slack Bot](apps/examples/slack-bot) | Production Slack bot with per-thread agent memory, OAuth, and slash commands |

## Custom Tools

Tools are how agents interact with the world. Define a tool with a name, a description the model reads, a JSON Schema for inputs, and a function that does the work:

```typescript
import { createTool } from "@clinebot/sdk"

const deploy = createTool({
  name: "deploy",
  description: "Deploy the app to staging or production.",
  inputSchema: {
    type: "object",
    properties: {
      environment: { type: "string", enum: ["staging", "production"] },
    },
    required: ["environment"],
  },
  execute: async (input) => {
    const result = await runDeployment(input.environment)
    return { url: result.url, status: "success" }
  },
})

const agent = new Agent({
  providerId: "moonshot",
  modelId: "kimi-k2.5",
  systemPrompt: "You are a deployment assistant.",
  tools: [deploy],
})
```

The agent decides when to call the tool based on the description. It sees the result and incorporates it into its response.

## Streaming Events

Every event during execution is observable in real time:

```typescript
const agent = new Agent({
  providerId: "anthropic",
  modelId: "claude-opus-4-7",
  systemPrompt: "You are a helpful assistant.",
  tools: [myTool],
  onEvent: (event) => {
    switch (event.type) {
      case "content_update":
        if (event.contentType === "text") process.stdout.write(event.text)
        break
      case "content_start":
        if (event.contentType === "tool") console.log(`\n[${event.toolName}]`)
        break
      case "usage":
        console.log(`\ntokens: ${event.inputTokens} in, ${event.outputTokens} out`)
        break
    }
  },
})
```

## Plugins

Package reusable capabilities as extensions. An extension can register tools, observe lifecycle events, and modify agent behavior:

```typescript
const metrics: AgentPlugin = {
  name: "metrics",
  manifest: { capabilities: ["tools", "hooks"] },

  setup(api) {
    api.registerTool(myCustomTool)
  },

  hooks: {
    beforeRun() {
      console.time("agent")
    },

    beforeTool({ toolCall }) {
      console.log(`tool: ${toolCall.toolName}`)
    },

    afterRun({ result }) {
      console.timeEnd("agent")
      console.log(`${result.iterations} iterations, ${result.usage.outputTokens} tokens`)
    },
  },
}
```

## ClineCore: Full Runtime

When you need session persistence, built-in tools, config discovery, and multi-process support, use `ClineCore`:

```typescript
import { ClineCore } from "@clinebot/sdk"

const cline = await ClineCore.create({ clientName: "my-app" })

const session = await cline.start({
  prompt: "Set up CI with GitHub Actions",
  config: {
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    apiKey: process.env.ANTHROPIC_API_KEY,
    cwd: "/path/to/project",
    enableTools: true,
  },
})

console.log(session.result?.text)
```

`ClineCore` gives the agent built-in tools (`bash`, `editor`, `read_files`, `apply_patch`, `search`, `fetch_web`), persists sessions to SQLite, discovers config from `.cline/` directories, and optionally connects to an RPC sidecar for scheduled agents and cross-process session management.

## Packages

The SDK is a layered stack. Use as much or as little as you need:

| Package | What it does |
|---------|-------------|
| `@clinebot/sdk` | Everything you need -- install this one |
| `@clinebot/core` | Sessions, persistence, built-in tools, config discovery, RPC |
| `@clinebot/agents` | Stateless agent loop with tool execution and streaming |
| `@clinebot/llms` | LLM provider gateway (Anthropic, OpenAI, Google, Bedrock, Mistral, and more) |
| `@clinebot/shared` | Types, tool creation helpers, hook engine |

`@clinebot/sdk` is an alias for `@clinebot/core` that re-exports from all packages, so a single install gives you the full API. The individual packages are available if you want a minimal dependency footprint.

## CLI

The Cline CLI gives you terminal access to the full SDK:

```bash
# Interactive agent
cline

# Single prompt
cline "Refactor the auth module to use JWT"

# Schedule an agent to run daily
cline schedule create "PR summary" --cron "0 9 * * MON-FRI" --prompt "Summarize open PRs"

# Connect to Telegram
cline connect telegram -m my_bot -k $BOT_TOKEN
```

## Providers

Works with every major LLM provider out of the box:

| Provider | Models |
|----------|--------|
| Anthropic | Claude Opus 4.7, Sonnet 4.6, Haiku 4.5 |
| OpenAI | GPT-5.5, GPT-5.3 Codex |
| Google | Gemini 3.1 Pro Preview, Gemini 3 Flash Preview |
| AWS Bedrock | Claude, Llama |
| Mistral | Mistral Large, Codestral |
| Any OpenAI-compatible | vLLM, Together, Fireworks, Groq, etc. |

## Documentation

Full documentation at [docs.cline.bot/sdk](https://docs.cline.bot/sdk/overview):

- [Quickstart](https://docs.cline.bot/sdk/quickstart) -- zero to running agent in 5 minutes
- [Core Concepts](https://docs.cline.bot/sdk/agents) -- agents, sessions, tools, events, extensions, hooks
- [Guides](https://docs.cline.bot/sdk/guides/building-an-agent) -- end-to-end tutorials for common patterns
- [Architecture](https://docs.cline.bot/sdk/architecture/overview) -- how the SDK is structured and why
- [API Reference](https://docs.cline.bot/sdk/reference/cline-core) -- every method, type, and config option


## Contributing

To contribute to the project, start with our [Contributing Guide](CONTRIBUTING.md) to learn the basics. You can also join our [Discord](https://discord.gg/cline) to chat with other contributors in the `#contributors` channel. If you're looking for full-time work, check out our open positions on our [careers page](https://cline.bot/join-us)!

## License

[Apache 2.0 © 2026 Cline Bot Inc.](./LICENSE)
