# Quickstart with ClineCore

A minimal Cline SDK example that uses `ClineCore` instead of the lightweight `Agent` runtime. It starts one local Core session, sends a single prompt, streams the assistant text to stdout, prints token usage, and then disposes the Core runtime.

## Getting started

Use Node.js 22 or newer.

Install dependencies and build the SDK packages:

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

Or pass a prompt from the command line:

```bash
bun dev "Compare Agent and ClineCore in a markdown table."
```

## What it does

1. Creates a local `ClineCore` runtime with `ClineCore.create()`
2. Subscribes to `CoreSessionEvent` events with `cline.subscribe()`
3. Reads a prompt from command-line arguments, falling back to the default prompt
4. Starts a non-interactive session with `cline.start()`
5. Renders assistant text from nested `agent_event` events
6. Prints usage plus the persisted session ID
7. Calls `cline.dispose()` to clean up runtime resources

## Agent vs ClineCore

The original [quickstart](../quickstart) uses `Agent`, while this example uses `ClineCore`.

| Area | `Agent` | `ClineCore` |
| --- | --- | --- |
| Best for | Simple in-process agent loops, custom tools, browser-compatible use cases | Full Cline runtime sessions, workspace-aware tools, persistence, automation, and multi-client/hub scenarios |
| Construction | `new Agent({ providerId, modelId, apiKey })` | `await ClineCore.create({ clientName, backendMode })` |
| Running | `await agent.run(prompt)` | `await cline.start({ prompt, config })` |
| Events | `agent.subscribe()` emits `AgentRuntimeEvent` directly, e.g. `assistant-text-delta` | `cline.subscribe()` emits `CoreSessionEvent`; assistant events are usually nested under `event.type === "agent_event"` |
| Result text | `result.outputText` | Session result is under `result.result`; stream text comes from events |
| Tools | You provide tools explicitly with `tools` | Can use ClineCore built-in tools (`read_files`, `search_codebase`, shell/editor tools when enabled) and custom `extraTools` |
| Persistence | Lightweight runtime state only | Creates persisted sessions with IDs, manifests, message artifacts, and history support |
| Cleanup | Usually no explicit disposal needed for the simple runtime | Always call `await cline.dispose()` when done |

Use `Agent` when you want the smallest API surface and own all tools/context yourself. Use `ClineCore` when you want the SDK to manage Cline-like sessions, workspace context, built-in tools, persistence, hub/remote runtime options, or automation.

## Notes

This quickstart disables built-in tools (`enableTools: false`) to keep behavior close to the original one-prompt example. To explore ClineCore's workspace tools, enable tools and set tool policies appropriate for your app.
