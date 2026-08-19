# ClineCore Runtime

`ClineCore` is the full-featured runtime from `@cline/core`. It wraps the `Agent` loop with session persistence, built-in tools (bash, editor, file reading, search, web fetch), config discovery, plugin loading, and optional hub-backed multi-process support.

## When to Use ClineCore

| Use ClineCore when... | Use Agent instead when... |
|---|---|
| You need built-in tools (bash, editor, etc.) | You only need custom tools |
| You want session persistence to disk | Stateless is fine |
| You need config discovery from `.cline/` dirs | You handle config yourself |
| You want scheduled/automated agents | You don't need scheduling |
| You need multi-client session sharing | Single-process is fine |
| You're building a full application | You want minimal dependencies |

## Quick Start

```typescript
import { ClineCore } from "@cline/sdk"

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
await cline.dispose()
```

## Core Concepts

### Sessions

Every `cline.start()` call creates a session with a unique ID. Sessions persist their messages and metadata to SQLite. You can list, read, resume, and delete sessions.

### Built-in Tools

ClineCore provides these tools automatically when `enableTools: true`:

| Tool | Description |
|------|-------------|
| `bash` | Execute shell commands |
| `editor` | Edit files |
| `read_files` | Read file contents |
| `apply_patch` | Apply unified diffs |
| `search` | Search file contents and structure |
| `fetch_web` | HTTP requests and web content |

### Config Discovery

ClineCore watches `.cline/` directories for:
- Rules (system prompt additions)
- Skills (domain knowledge)
- Workflows (multi-step procedures)
- Hooks (lifecycle logic)
- Plugins (tool + hook bundles)
- MCP servers (external tool providers)

### Backend Modes

| Mode | Description |
|------|-------------|
| `"auto"` (default) | Tries to connect to a local hub; falls back to in-process if unavailable |
| `"local"` | In-process execution, local SQLite storage, no hub |
| `"hub"` | Requires a compatible local WebSocket hub; fails if unavailable |
| `"remote"` | Connects to an explicit remote hub endpoint |

The default mode is `"auto"`. For simple scripts and CLI tools, `"local"` avoids hub discovery overhead. Hub mode enables multi-client session sharing (e.g., a dashboard watching a running session from another process).

## Key APIs

- `ClineCore.create(options)` - Create and initialize
- `cline.start(input)` - Start a new session
- `cline.send({ sessionId, prompt })` - Send follow-up message
- `cline.subscribe(listener)` - Listen to session events
- `cline.list()` - List sessions
- `cline.get(sessionId)` - Get session metadata
- `cline.readMessages(sessionId)` - Read persisted messages
- `cline.getAccumulatedUsage(sessionId)` - Token/cost totals
- `cline.abort(sessionId)` - Abort a session
- `cline.delete(sessionId)` - Delete a session
- `cline.dispose()` - Clean up resources

See `api.md` for full API details.

## Event Streaming

`cline.subscribe()` emits `CoreSessionEvent` types. These are different from the `AgentRuntimeEvent` types emitted by the standalone `Agent` class -- see `../events/REFERENCE.md` for the full comparison.

```typescript
cline.subscribe((event) => {
  switch (event.type) {
    case "chunk":
      if (event.payload.type === "text") {
        process.stdout.write(event.payload.text)
      }
      break
    case "ended":
      console.log(`Session ended: ${event.payload.finishReason}`)
      break
  }
})
```

ClineCore results use `AgentResult` with `.text` (not `.outputText` like the standalone Agent's `AgentRunResult`).

## Session Persistence

Sessions are stored at:
```
~/.cline/data/sessions/
  sessions.db       # SQLite database
  [session-id].json # Message history
```

## Next Steps

- `api.md` - Full ClineCore API reference
- `patterns.md` - Common patterns and best practices
- `gotchas.md` - Pitfalls and debugging
- `../tools/REFERENCE.md` - Custom tool creation
- `../plugins/REFERENCE.md` - Plugin system
- `../scheduling/REFERENCE.md` - Scheduled agents
