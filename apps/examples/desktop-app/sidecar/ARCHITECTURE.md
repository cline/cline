# Sidecar Architecture — @cline/code

## Overview

The sidecar is a Bun process that adapts the desktop UI and native operations to
the shared Cline Hub.

It imports `@cline/core`, discovers or starts the canonical shared Hub, registers
as a Hub client, and serves the Next.js frontend over HTTP + WebSocket. The
sidecar does not own a private agent runtime Hub.

## Directory Structure

```
sidecar/
├── index.ts              # Entry point: starts HTTP+WS server
├── server.ts             # Bun HTTP server + WebSocket handlers
├── context.ts            # SidecarContext type and factory
├── commands.ts           # Command router
├── chat-session.ts       # Shared-Hub chat session adapter
├── session-data/         # Shared discovery, messages, artifacts, search helpers
├── paths.ts              # Path resolution
├── types.ts              # Shared types
└── ARCHITECTURE.md       # This file
```

## Transport Protocol (unchanged)

```
Request:  { "type": "command", "id": string, "command": string, "args"?: object }
Response: { "type": "response", "id": string, "ok": boolean, "result"?: unknown, "error"?: string }
Event:    { "type": "event", "event": { "name": string, "payload": unknown } }
```

## Key Design Decisions

### 1. Chat Sessions — Shared Hub Client

`ClineCore` uses Hub mode without an explicit endpoint. Core therefore reuses
the same compatible Hub discovered by the CLI or starts the canonical detached
Hub when the desktop is the first client:

```typescript
const sessionManager = await ClineCore.create({
  clientName: "cline-code",
  backendMode: "hub",
  hub: {
    strategy: "require-hub",
    workspaceRoot,
    cwd: workspaceRoot,
    clientType: "code-sidecar",
    displayName: "Code App sidecar",
  },
  capabilities: {
    requestToolApproval: async (request) => {
      // Push approval request to frontend via WebSocket event
      broadcastEvent("tool_approval_state", { sessionId: request.sessionId, items: [request] });
      // Wait for frontend response
      return await waitForApprovalResponse(request.sessionId, request.toolCallId);
    },
  },
});

// Start session
const { sessionId } = await sessionManager.start({
  config: coreSessionConfig,
  prompt: "...",
});

// Send follow-up
await sessionManager.send({ sessionId, prompt: "..." });

// Subscribe to streaming events
sessionManager.subscribe((event) => {
  // Forward to WebSocket clients as chat_text, chat_reasoning, etc.
  broadcastEvent("chat_event", event);
});
```

The compiled sidecar also recognizes Core's Hub-daemon launch mode. This lets
the desktop start the same detached Hub when no CLI process has started it yet.
Startup discovery and locking ensure concurrent clients converge on one Hub.

### 2. Tool Approval — Client-Owned Promise Resolution

The shared Hub routes approval requests back to the client that created the
session. Desktop approvals use in-memory promise maps while the webview is
online:

```typescript
const pendingApprovals = new Map<string, {
  resolve: (result: ToolApprovalResult) => void;
  request: ToolApprovalRequest;
}>();

// When core requests approval → store promise, push to frontend
// When frontend responds → resolve promise
```

### 3. Provider Management — Direct ProviderSettingsManager

```typescript
import { ProviderSettingsManager, listLocalProviders, ... } from "@cline/core";
const manager = new ProviderSettingsManager();
```

### 4. Session Storage — Direct SqliteSessionStore

```typescript
import { SqliteSessionStore, resolveSessionBackend } from "@cline/core";
const store = new SqliteSessionStore();
```

### 5. Routine Schedules — Direct Hub Commands

Routine operations use the same connected Hub client as chat session
observation. They never start a second in-process Hub:

```typescript
await ctx.hubClient.command("schedule.list", { limit: 200 });
```

### 6. Native Commands

- `pick_workspace_directory` — Uses macOS `osascript` / Linux `zenity` for directory picker
- `open_mcp_settings_file` — Uses `open` / `xdg-open` to open files

### 7. Frontend Connection

The frontend `desktop-client.ts` connects directly to the sidecar WebSocket:
- Discovers endpoint from `window.__SIDECAR_WS_ENDPOINT__` or defaults to `ws://127.0.0.1:3126/transport`
- No Tauri dependency needed
- Same `invoke()` / `subscribe()` API

## Command Map

Supported commands:

| Command | Implementation |
|---------|---------------|
| `chat_session_command` | shared Hub through `ClineCore` |
| `list_provider_catalog` | `ProviderSettingsManager` + `listLocalProviders` |
| `list_provider_models` | `getLocalProviderModels` |
| `save_provider_settings` | `saveLocalProviderSettings` |
| `add_provider` | `addLocalProvider` |
| `run_provider_oauth_login` | `loginLocalProvider` |
| `list_chat_sessions` | `SqliteSessionStore` + file discovery |
| `list_discovered_sessions` | Merged discovery |
| `read_session_messages` | Session data readers |
| `read_session_hooks` | Session data readers |
| `delete_chat_session` | `SqliteSessionStore.delete` + file cleanup |
| `update_chat_session_title` | `resolveSessionBackend().updateSession` |
| `list_mcp_servers` | Direct file I/O |
| `upsert_mcp_server` | Direct file I/O |
| `delete_mcp_server` | Direct file I/O |
| `get_git_branch` | `execFileSync("git", ...)` |
| `list_git_branches` | `execFileSync("git", ...)` |
| `checkout_git_branch` | `execFileSync("git", ...)` |
| `search_workspace_files` | `getFileIndex` |
| `get_process_context` | In-memory context |
| `poll_tool_approvals` | In-memory pending map |
| `respond_tool_approval` | In-memory promise resolution |
| `list_routine_schedules` | shared Hub schedule commands |
| `list_user_instruction_configs` | Direct core API |
| `pick_workspace_directory` | OS native dialog |
| `open_mcp_settings_file` | OS `open` command |

## Dev Workflow

```bash
bun run dev:sidecar   # Start sidecar on port 3126
bun run dev:web       # Start Next.js on port 3125
bun run dev           # Both concurrently
```
