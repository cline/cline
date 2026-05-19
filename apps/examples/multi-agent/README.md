# Multi-Agent Fan-Out

A web app that spawns three specialist agents in parallel, streams their responses to the browser in real time via SSE, then feeds their findings into a synthesizer agent that produces a unified answer.

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

Open http://localhost:3456 in your browser, enter a topic, and watch the agents work.

## What it does

1. You enter a topic in the browser
2. The server spawns three `Agent` instances in parallel via `Promise.all`:
   - Technical Expert (engineering perspective)
   - Practical Analyst (real-world applications)
   - Critical Reviewer (limitations and trade-offs)
3. Each agent streams `assistant-text-delta` events to the browser via SSE, rendered in its own card
4. Once all three finish, a fourth synthesizer agent combines their findings into a unified answer, also streamed live

## Concepts demonstrated

- Running multiple `Agent` instances concurrently with `Promise.all`
- Per-agent `subscribe()` for independent event streams
- Server-Sent Events (SSE) to stream agent output to a browser
- Agent composition: feeding one agent's output as input to another
- Inline HTML frontend served from the same Node.js server (single file, no build step)

## Notes

For a simpler starting point, see [quickstart](../quickstart). For custom tools and structured workflows, see [code-review-bot](../code-review-bot).
