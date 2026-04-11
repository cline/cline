# Cline SDK — MCP Server Management Reference

This document describes how the Cline SDK handles MCP (Model Context Protocol) server lifecycle, configuration, and what is — and isn't — exposed for client integration. It is intended for client developers building UI around MCP server management.

---

## Summary: The Claim That "The SDK Lacks Hooks" Is Wrong

The SDK **does** provide a full MCP manager with lifecycle operations. The `McpManager` interface in `@clinebot/core` supports:

- `registerServer()` / `unregisterServer()` — add or remove servers
- `connectServer()` / `disconnectServer()` — start or stop connections
- `setServerDisabled()` — toggle enable/disable
- `listServers()` — get snapshots of all servers with status
- `refreshTools()` — force-refresh tool lists from a server
- `dispose()` — shut down all servers

The **actual gap** is narrower: there is no built-in file-watcher that auto-reloads `cline_mcp_settings.json` when it changes, and the RPC layer (`@clinebot/rpc`) does not currently expose MCP management endpoints. This means clients that manage MCP settings through the settings file must bridge the gap between file edits and runtime state themselves.

---

## SDK Architecture for MCP

### Layer 1: Settings File (`cline_mcp_settings.json`)

The SDK reads MCP server configuration from a JSON settings file:

```json
{
  "mcpServers": {
    "docs": {
      "transport": { "type": "stdio", "command": "node", "args": ["./mcp.js"] }
    },
    "remote": {
      "transport": { "type": "streamableHttp", "url": "https://mcp.example.com" },
      "disabled": true
    }
  }
}
```

**Location resolution** (`resolveDefaultMcpSettingsPath()`):
- `CLINE_MCP_SETTINGS_PATH` env var (if set)
- Otherwise defaults to the platform-specific Cline data directory

**SDK utilities** for this file (all exported from `@clinebot/core`):
- `resolveDefaultMcpSettingsPath()` — get the path
- `hasMcpSettingsFile()` — check if it exists
- `loadMcpSettingsFile()` — parse and validate with Zod
- `resolveMcpServerRegistrations()` — parse file → `McpServerRegistration[]`
- `registerMcpServersFromSettingsFile(manager)` — parse file and register all servers into a manager

### Layer 2: McpManager (`InMemoryMcpManager`)

`packages/core/src/extensions/mcp/manager.ts` — the runtime MCP lifecycle manager.

```typescript
interface McpManager extends McpToolProvider {
  registerServer(registration: McpServerRegistration): Promise<void>;
  unregisterServer(serverName: string): Promise<void>;
  connectServer(serverName: string): Promise<void>;
  disconnectServer(serverName: string): Promise<void>;
  setServerDisabled(serverName: string, disabled: boolean): Promise<void>;
  listServers(): readonly McpServerSnapshot[];
  refreshTools(serverName: string): Promise<readonly McpToolDescriptor[]>;
  callTool(request: McpToolCallRequest): Promise<McpToolCallResult>;
  dispose(): Promise<void>;
}
```

Key behaviors:
- **Lazy connection**: Servers are registered in disconnected state; connection happens on first `listTools()` or `callTool()`.
- **Transport change detection**: If `registerServer()` is called with a changed transport config, the existing connection is torn down and the client is recreated.
- **Exclusive locking**: Per-server operation locks prevent concurrent connect/disconnect races.
- **Tool caching**: `listTools()` caches results for `toolsCacheTtlMs` (default 5 seconds). Use `refreshTools()` to force a refresh.
- **Disable = disconnect**: Calling `setServerDisabled(name, true)` immediately disconnects the server.

### Layer 3: McpServerClient (Transport Layer)

`packages/core/src/extensions/mcp/client.ts` — the actual MCP protocol client.

The default factory (`createDefaultMcpServerClientFactory()`) creates `StdioMcpClient` instances:
- Spawns child processes for `stdio` transport
- Implements MCP JSON-RPC protocol (both newline-delimited and framed modes)
- Auto-negotiates protocol mode by trying newline first, then framed
- Protocol version: `2024-11-05`
- Connect timeout: 1.5s, request timeout: 5s

```typescript
interface McpServerClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<readonly McpToolDescriptor[]>;
  callTool(request: { name: string; arguments?: Record<string, unknown> }): Promise<McpToolCallResult>;
}

type McpServerClientFactory = (registration: McpServerRegistration) => Promise<McpServerClient> | McpServerClient;
```

**Transport types supported**:
| Type | Status |
|---|---|
| `stdio` | ✅ Fully implemented in `StdioMcpClient` |
| `sse` | ⚠️ Type defined, but no built-in client (factory only creates `StdioMcpClient`) |
| `streamableHttp` | ⚠️ Type defined, but no built-in client |

Clients needing SSE or StreamableHTTP support must provide a custom `McpServerClientFactory`.

### Layer 4: Tool Bridge

`packages/core/src/extensions/mcp/tools.ts` via `createMcpTools()` — converts MCP server tools into the SDK's `Tool` type for use in the agent loop.

```typescript
interface CreateMcpToolsOptions {
  serverName: string;
  provider: McpToolProvider;    // Usually the McpManager
  nameTransform?: McpToolNameTransform;
  timeoutMs?: number;
  retryable?: boolean;
  maxRetries?: number;
}
```

Default name transform: `{serverName}__{toolName}` (e.g. `docs__search`).

---

## How the Runtime Builder Uses MCP

`packages/core/src/runtime/runtime-builder.ts` → `loadConfiguredMcpTools()`:

1. Resolves the MCP settings file path
2. Creates a fresh `InMemoryMcpManager`
3. Calls `registerMcpServersFromSettingsFile()` to load all servers
4. Creates `Tool[]` via `createMcpTools()` for each non-disabled server
5. Returns the tools + a `shutdown()` callback that calls `manager.dispose()`

**Critical limitation**: This is done once at session build time. There is **no file watcher** that reloads MCP settings when they change during a session. If the settings file is edited mid-session, the running session won't see the changes.

---

## How Existing Apps Handle MCP Settings

### Tauri Apps (`apps/code`, `apps/desktop`)

Both Tauri apps implement MCP settings management **entirely in Rust** at the Tauri command level, bypassing the SDK's McpManager:

```rust
// apps/code/src-tauri/src/main.rs (identical pattern in apps/desktop)
fn list_mcp_servers() -> Result<McpServersResponse, String>
fn set_mcp_server_disabled(name, disabled) -> Result<McpServersResponse, String>
fn upsert_mcp_server(input) -> Result<McpServersResponse, String>
fn delete_mcp_server(name) -> Result<McpServersResponse, String>
```

These commands:
- Read/write `cline_mcp_settings.json` directly
- Return the full server list after each mutation
- Do **not** interact with any running `McpManager` instance

The frontend (`apps/code/components/views/settings/mcp-view.tsx`) calls these Tauri commands:
- `list_mcp_servers` — refresh the displayed server list
- `set_mcp_server_disabled` — toggle enable/disable
- `upsert_mcp_server` — add or edit a server
- `delete_mcp_server` — remove a server

### Node.js Host (`apps/code/host/commands.ts`)

The Code app's Node.js host also implements MCP CRUD directly:
```typescript
// Direct file reads/writes, not using McpManager
function readMcpServersResponse(): JsonRecord    // reads cline_mcp_settings.json
function writeMcpServersMap(servers: JsonRecord)  // writes cline_mcp_settings.json
function ensureMcpSettingsFile(): string          // ensures file exists
```

Commands: `list_mcp_servers`, `set_mcp_server_disabled`, `upsert_mcp_server`, `delete_mcp_server`, `ensure_mcp_settings_file`

### CLI (`apps/cli`)

The CLI has `clite config mcp` / `clite list mcp` for listing configured MCP servers. It uses the SDK's `resolveMcpServerRegistrations()` to read the settings file.

---

## What the SDK DOES Expose (Exported from `@clinebot/core`)

### Full Type & Implementation Exports

```typescript
// Manager
export { InMemoryMcpManager } from "./extensions/mcp";
export type { McpManager, McpManagerOptions } from "./extensions/mcp";

// Client factory
export { createDefaultMcpServerClientFactory } from "./extensions/mcp";
export type { McpServerClient, McpServerClientFactory } from "./extensions/mcp";

// Config loading
export { hasMcpSettingsFile, loadMcpSettingsFile, registerMcpServersFromSettingsFile,
         resolveDefaultMcpSettingsPath, resolveMcpServerRegistrations } from "./extensions/mcp";
export type { LoadMcpSettingsOptions, McpSettingsFile, RegisterMcpServersFromSettingsOptions } from "./extensions/mcp";

// Types
export type { McpServerRegistration, McpServerSnapshot, McpConnectionStatus,
             McpServerTransportConfig, McpStdioTransportConfig, McpSseTransportConfig,
             McpStreamableHttpTransportConfig } from "./extensions/mcp";

// Tool bridge
export { createMcpTools } from "./extensions/mcp";
export type { CreateMcpToolsOptions, McpToolCallRequest, McpToolCallResult,
             McpToolDescriptor, McpToolNameTransform, McpToolProvider } from "./extensions/mcp";

// Policies
export { createDisabledMcpToolPolicies, createDisabledMcpToolPolicy } from "./extensions/mcp";
```

---

## What's Missing / The Actual Gaps

### 1. No RPC Endpoints for MCP Management

`packages/rpc/src` has **zero** MCP-related code. There are no gRPC/RPC methods for:
- Listing MCP servers
- Registering/unregistering servers
- Connecting/disconnecting servers
- Toggling server disabled state
- Refreshing tools

This means RPC-backed clients cannot manage MCP through the RPC layer.

### 2. No Settings File Watcher

The SDK has a `UnifiedConfigFileWatcher` for agents, skills, rules, and workflows — but **not for MCP settings**. When another client edits `cline_mcp_settings.json`, running sessions don't see the change.

### 3. No Live Manager Exposure to Clients

The runtime builder creates an `InMemoryMcpManager` internally during `loadConfiguredMcpTools()`, but it's encapsulated — only the resulting `Tool[]` and a `shutdown()` callback are returned. The manager itself is not exposed to the caller, so clients can't call `connectServer()`, `disconnectServer()`, etc. on a running session's MCP manager.

### 4. SSE/StreamableHTTP Client Not Implemented

The transport types are defined, but the default client factory only produces `StdioMcpClient`. Clients needing SSE or StreamableHTTP must provide their own `McpServerClientFactory`.

---

## What a Client Needs to Do Today

To implement full MCP server management UI:

### Settings CRUD (Works Now)
Read and write `cline_mcp_settings.json` directly. The SDK provides:
- `resolveDefaultMcpSettingsPath()` — find the file
- `loadMcpSettingsFile()` — parse it
- Write it yourself (it's just JSON with `{ mcpServers: { ... } }`)

This is exactly what the Tauri apps and Node.js host do today.

### Runtime Lifecycle (Partial)
For a new session, MCP tools are automatically loaded from the settings file by the runtime builder.

For mid-session changes (restart, delete, toggle), clients currently have two options:
1. **Edit the settings file and restart the session** — the next session build will pick up the changes
2. **Create and manage your own `InMemoryMcpManager`** — the SDK exports everything needed:
   ```typescript
   const manager = new InMemoryMcpManager({
     clientFactory: createDefaultMcpServerClientFactory(),
   });
   await manager.registerServer({ name: "docs", transport: { type: "stdio", command: "node", args: ["./mcp.js"] } });
   await manager.connectServer("docs");
   const tools = await manager.listTools("docs");
   await manager.disconnectServer("docs");
   await manager.unregisterServer("docs");
   ```

### Cross-Client Sync (Not Built)
If multiple clients share the same settings file, there is no notification mechanism. Clients would need their own file watcher (e.g. `fs.watch()` / `chokidar`) on `cline_mcp_settings.json`.

---

## How MCP Tools Become Visible to the Agent (and the Client)

### MCP Tools Are Injected as Regular SDK Tools

The `createMcpTools()` function converts each MCP tool descriptor into a standard `Tool` object (from `@clinebot/shared`). These tools are **indistinguishable** from built-in tools once created — they have a `name`, `description`, `inputSchema`, and an `execute` function.

```typescript
// packages/core/src/extensions/mcp/tools.ts
export async function createMcpTools(options: CreateMcpToolsOptions): Promise<Tool[]> {
  const descriptors = await options.provider.listTools(options.serverName);
  return descriptors.map((descriptor) => createTool({
    name: nameTransform({ serverName, toolName: descriptor.name }),  // e.g. "docs__search"
    description: descriptor.description || `Execute MCP tool "${descriptor.name}" from server "${serverName}".`,
    inputSchema: descriptor.inputSchema,
    execute: async (input, context) => options.provider.callTool({
      serverName, toolName: descriptor.name, arguments: input, context,
    }),
  }));
}
```

### The Runtime Builder Merges MCP Tools with Built-in Tools

In `DefaultRuntimeBuilder.build()` (line ~460-476):
```typescript
if (normalized.enableTools) {
  tools.push(...createBuiltinToolsList(...));   // SDK built-in tools
  const mcpRuntime = await loadConfiguredMcpTools();  // MCP tools
  tools.push(...mcpRuntime.tools);
  mcpShutdown = mcpRuntime.shutdown;
}
```

The resulting `tools: Tool[]` array — containing **both** built-in and MCP tools — is returned in the `BuiltRuntime`:
```typescript
interface BuiltRuntime {
  tools: Tool[];        // ← includes MCP tools
  hooks?: AgentHooks;
  shutdown: (reason: string) => Promise<void> | void;
  // ...
}
```

### The Agent Receives All Tools (Including MCP) Uniformly

The `Agent` (from `@clinebot/agents`) receives the merged `tools` array. It doesn't know or care which tools came from MCP vs built-in. The LLM sees all tools in its tool definitions and can call any of them.

### Client Control Over MCP Tools

Clients **can** control MCP tools through the same mechanisms they use for any tool:

1. **Tool Policies** — Enable/disable or require approval per tool name:
   ```typescript
   toolPolicies: {
     "docs__search": { enabled: true, autoApprove: true },
     "docs__write": { enabled: true, autoApprove: false },  // requires approval
     "risky__delete": { enabled: false },                    // completely disabled
   }
   ```

2. **MCP-specific disable policies** — The SDK provides helpers to disable all tools from a specific MCP server:
   ```typescript
   import { createDisabledMcpToolPolicies } from "@clinebot/core";
   const policies = createDisabledMcpToolPolicies({
     serverName: "risky-server",
     toolNames: ["delete", "modify", "drop"],
   });
   // → { "risky-server__delete": { enabled: false }, ... }
   ```

3. **CLI flags** — `--tool-enable <name>` and `--tool-disable <name>` work for MCP tools too (they operate on the transformed name like `docs__search`).

4. **Tool approval callback** — When `autoApprove: false`, the agent calls `requestToolApproval()` before executing the tool, giving the client a chance to approve/reject each call.

5. **`enableTools: false`** — Disables ALL tools including MCP.

### What Clients Can See

The `BuiltRuntime.tools` array is visible to the caller of `runtimeBuilder.build()`. The session manager and host apps can inspect it to know exactly which tools (including MCP tools) are available.

MCP tools follow the naming convention `{serverName}__{toolName}` by default, so clients can identify which tools came from which MCP server by parsing the name prefix.

---

## Remote MCP Servers (StreamableHTTP / SSE)

### The SDK's Design Intent

The SDK clearly **intends** to support remote MCP servers. The evidence:

1. **Transport types are fully defined and validated**:
   ```typescript
   interface McpStreamableHttpTransportConfig {
     type: "streamableHttp";
     url: string;
     headers?: Record<string, string>;
   }
   interface McpSseTransportConfig {
     type: "sse";
     url: string;
     headers?: Record<string, string>;
   }
   ```

2. **Config loader validates all three transports** — The Zod schemas accept `stdio`, `sse`, and `streamableHttp` equally. Legacy formats (`url` without explicit type) default to `sse`; `transportType: "http"` maps to `streamableHttp`.

3. **Manager is transport-agnostic** — The `McpManager` uses `McpServerClientFactory` to create clients. It doesn't care about transport type; that's the factory's job.

4. **Tests use `streamableHttp` registrations** — The manager test suite registers servers with `transport: { type: "streamableHttp", url: "https://mcp.example.test" }` and they work fine (with a mock client factory).

5. **Settings file and UI accept all transports** — Both Tauri apps and the Code app UI offer `stdio`, `sse`, and `streamableHttp` as choices.

### What's Actually Implemented vs Not

| Concern | Status |
|---|---|
| Transport type definitions | ✅ Complete |
| Settings file parsing for all transports | ✅ Complete |
| Settings file CRUD (UI/Tauri/CLI) for all transports | ✅ Complete |
| `McpManager` lifecycle for all transports | ✅ Complete (transport-agnostic) |
| `StdioMcpClient` (spawns child process) | ✅ Complete |
| HTTP/SSE client (connects to remote URL) | ❌ Not in default factory |

### The Gap for Remote Servers

The **only** thing missing is that `createDefaultMcpServerClientFactory()` returns a `StdioMcpClient` unconditionally — it doesn't check `registration.transport.type` and will fail for `sse` or `streamableHttp` transports.

A client can fix this by providing a custom factory:
```typescript
const manager = new InMemoryMcpManager({
  clientFactory: async (registration) => {
    if (registration.transport.type === "stdio") {
      return createDefaultMcpServerClientFactory()(registration);
    }
    if (registration.transport.type === "streamableHttp") {
      return new MyStreamableHttpMcpClient(registration);
    }
    if (registration.transport.type === "sse") {
      return new MySseMcpClient(registration);
    }
    throw new Error(`Unsupported transport: ${registration.transport.type}`);
  },
});
```

The client just needs to implement the `McpServerClient` interface (4 methods: `connect`, `disconnect`, `listTools`, `callTool`).

---

## Recommendation for Improvement

To close the gap, the SDK could:

1. **Add MCP settings to the config watcher system** — create an `McpConfigDefinition` for `UnifiedConfigFileWatcher` to auto-detect changes to `cline_mcp_settings.json`
2. **Expose the McpManager from the runtime builder** — return it alongside the tool list so clients can call lifecycle methods
3. **Add MCP management to the RPC layer** — implement gRPC methods that proxy to `McpManager`
4. **Implement SSE/StreamableHTTP clients** — extend the default client factory
