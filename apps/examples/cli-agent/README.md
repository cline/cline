# CLI Agent

An interactive terminal chat agent with streaming output and a shell tool. Type messages, get responses, and let the agent run shell commands on your behalf.

## Getting started

Install dependencies:

```bash
bun install
bun run build:sdk
```

Set an API key:

```bash
export CLINE_API_KEY="cline_..."
```

Run:

```bash
bun dev
```

Type any message at the `you:` prompt to see a streaming response from the agent.

## What it does

- Creates a conversational `Agent` with a `shell` tool using `createTool`
- Streams `assistant-text-delta` events to stdout as the agent responds
- Logs tool calls and their results inline
- Uses `agent.run()` for the first message and `agent.continue()` for follow-ups to maintain conversation context

## Concepts demonstrated

- `createTool` with zod schema validation
- Event subscription for streaming and tool call visibility
- Multi-turn conversation with `run()` / `continue()`
- `systemPrompt` configuration

## Notes

For the simplest possible example, see [quickstart](../quickstart). For structured workflows with multiple tools, see [code-review-bot](../code-review-bot).
