# Quickstart

The simplest possible Cline SDK example. Creates one agent, sends a single prompt, and streams the response to stdout.

## Getting started

Use Node.js 22 or newer.

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

## What it does

1. Creates an `Agent` with a provider and model
2. Subscribes to `assistant-text-delta` events to stream output
3. Calls `agent.run()` with a prompt
4. Prints token usage when done

## Notes

For an interactive terminal chat, see [cli-agent](../cli-agent). For custom tools and structured workflows, see [code-review-bot](../code-review-bot).
