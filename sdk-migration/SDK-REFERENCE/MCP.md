# Cline SDK — MCP Server Management Reference

How the SDK handles MCP server lifecycle, configuration, and the gaps
that the adapter layer must fill. For the migration plan, see
[../README.md](../README.md).

## Summary

The SDK **does** provide a full MCP manager with lifecycle operations.
The actual gap is narrower than it first appears:

- No built-in file-watcher for `cline_mcp_settings.json`
- No RPC layer exposure of MCP management
- Default client factory only creates stdio clients (no SSE/streamableHTTP)

## SDK Architecture for MCP

### Layer 1: Settings File

`cline_mcp_settings.json` — JSON with `{ mcpServers: { ... } }`.

SDK utilities (all from `@clinebot/core`):
- `resolveDefaultMcpSettingsPath()` — find the file
- `hasMcpSettingsFile()` — check existence
- `loadMcpSettingsFile()` — parse and validate with Zod
- `resolveMcpServerRegistrations()` — parse → `McpServerRegistration[]`
- `registerMcpServersFromSettingsFile(manager)` — register all into a manager

### Layer 2: McpManager (`InMemoryMcpManager`)

```typescript
interface McpManager extends McpToolProvider {
  registerServer(registration: McpServerRegistration): Promise<void>
  unregisterServer(serverName: string): Promise<void>
  connectServer(serverName: string): Promise<void>
  disconnectServer(serverName: string): Promise<void>
  setServerDisabled(serverName: string, disabled: boolean): Promise<void>
  listServers(): readonly McpServerSnapshot[]
  refreshTools(serverName: string): Promise<readonly McpToolDescriptor[]>
  callTool(request: McpToolCallRequest): Promise<McpToolCallResult>
  dispose(): Promise<void>
}
```

Key behaviors:
- Lazy connection (connect on first `listTools()` or `callTool()`)
- Transport change detection (reconnect if config changes)
- Per-server operation locks (no concurrent connect/disconnect races)
- Tool caching with TTL (5s default; use `refreshTools()` to force)

### Layer 3: McpServerClient (Transport)

Default factory (`createDefaultMcpServerClientFactory()`) creates
`StdioMcpClient` instances only.

| Transport | Status |
|-----------|--------|
| `stdio` | ✅ Fully implemented |
| `sse` | ⚠️ Type defined, no built-in client |
| `streamableHttp` | ⚠️ Type defined, no built-in client |

**We must provide a custom `McpServerClientFactory`** that handles
all three transports.

### Layer 4: Tool Bridge

`createMcpTools()` converts MCP server tools into SDK `Tool` objects.
Default name transform: `{serverName}__{toolName}` (e.g. `docs__search`).

MCP tools are indistinguishable from built-in tools once created.

## How the Runtime Builder Uses MCP

`DefaultRuntimeBuilder.build()`:
1. Resolves MCP settings file path
2. Creates fresh `InMemoryMcpManager`
3. Calls `registerMcpServersFromSettingsFile()`
4. Creates `Tool[]` via `createMcpTools()` for each non-disabled server
5. Returns tools + `shutdown()` callback

**Critical limitation**: This is done once at session build time.
No file watcher. No mid-session reload. The manager is encapsulated
and not exposed to callers.

## What the Adapter Layer Must Do

### Custom MCP Manager (Not SDK Default)

We need our own MCP manager that:
1. Reads from `cline_mcp_settings.json` on startup
2. Watches the file for changes (using `chokidar` or `fs.watch`)
3. Re-registers/reconnects servers when config changes
4. Supports stdio, SSE, and streamableHTTP transports
5. Exposes the manager for gRPC handlers (restart, toggle, delete)

### Custom Client Factory

```typescript
const clientFactory: McpServerClientFactory = async (registration) => {
  if (registration.transport.type === "stdio") {
    return createDefaultMcpServerClientFactory()(registration)
  }
  if (registration.transport.type === "streamableHttp") {
    return new StreamableHttpMcpClient(registration)
  }
  if (registration.transport.type === "sse") {
    return new SseMcpClient(registration)
  }
  throw new Error(`Unsupported transport: ${registration.transport.type}`)
}
```

### gRPC Handlers for MCP UI

The webview's MCP management UI calls these gRPC methods:
- `subscribeToMcpServers` — list servers with connection status
- `restartMcpServer` — disconnect + reconnect
- `deleteMcpServer` — unregister + delete from settings file
- `toggleMcpServer` — enable/disable
- `toggleToolAutoApprove` — per-tool auto-approve policy
- `updateMcpTimeout` — per-server timeout
- `authenticateMcpServer` — server-specific auth

Each handler translates the gRPC request to an MCP manager call
and returns the result in gRPC shape.

### MCP Marketplace

The marketplace fetches a catalog from the Cline API. For the initial
migration, we can:
- Read from disk cache (`~/.cline/data/cache/mcp_marketplace_catalog.json`)
- Implement `refreshMcpMarketplace` with authenticated API call
- Marketplace improvements are P1 and can follow later

## Settings CRUD Pattern

For reading/writing MCP server configurations, the SDK provides
`loadMcpSettingsFile()` but not a write function. Follow the pattern
used by the Tauri apps:
1. Read the file with `loadMcpSettingsFile()`
2. Modify the in-memory JSON
3. Write it back atomically (write-then-rename)
4. The file watcher picks up the change and reloads

## Tool Policies

The SDK provides MCP-specific disable policies:
```typescript
import { createDisabledMcpToolPolicies } from "@clinebot/core"
const policies = createDisabledMcpToolPolicies({
  serverName: "risky-server",
  toolNames: ["delete", "modify"],
})
// → { "risky-server__delete": { enabled: false }, ... }
```

For auto-approve, use `toolPolicies` in the session config:
```typescript
toolPolicies: {
  "docs__search": { enabled: true, autoApprove: true },
  "docs__write": { enabled: true, autoApprove: false },
}