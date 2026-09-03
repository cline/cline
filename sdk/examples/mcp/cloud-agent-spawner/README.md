# Cline Cloud Agent MCP Server

A standalone stdio Model Context Protocol server that lets any MCP host connect
a Cline account and spawn autonomous Cline Cloud agents.

The server has no Codex-specific integration. Any MCP client capable of
launching a local stdio server can use it, including Claude Code, Codex, desktop
agent applications, and custom agent runtimes. Client-specific approval and
configuration behavior remains the responsibility of the MCP host.

## Tools

- `start_cline_oauth` starts Cline's device-code OAuth flow.
- `get_cline_oauth_status` reports whether sign-in is pending, authenticated, or failed.
- `spawn_cloud_agent` starts one asynchronous cloud-agent operation and immediately returns an operation ID.
- `get_cloud_agent_spawn_status` reports provisioning progress and the final cloud and agent session IDs.

The implementation follows the desktop app's cloud lifecycle: refresh-aware
authentication, REST workspace provisioning, authenticated Hub WebSocket,
`session.create`, `session.attach`, and `session.send_input`.

## Recommended agent workflow

1. Call `spawn_cloud_agent` exactly once for each cloud agent the user requests.
2. Tell the user that provisioning started and may take several minutes.
3. Poll `get_cloud_agent_spawn_status` with the returned `operationId`, waiting
   at least `pollAfterMs` between checks. Never retry `spawn_cloud_agent` merely
   because the operation remains pending; doing so can create a duplicate workspace.
4. Pending responses identify the current stage, including authentication,
   workspace creation, provisioning, runtime connection, and prompt submission.
5. When status becomes `running`, show `dashboardUrl` and both session IDs. The
   cloud agent continues independently; `running` does not mean its task is finished.
6. When status becomes `failed`, show the error. If a dashboard URL is present,
   the workspace exists but its inner agent could not be started.

If spawning reports that authentication is required, call `start_cline_oauth`,
immediately show its URL and code, and poll `get_cline_oauth_status` about every
three seconds. Keep the same MCP process alive and do not start a second OAuth
flow while the first one is pending.

## Build and run

From the monorepo root:

```bash
bun install
bun run build:sdk
bun -F @cline/example-mcp-cloud-agent-spawner build
bun -F @cline/example-mcp-cloud-agent-spawner start
```

The production entry point uses Node.js 22 or later and stdio. Protocol messages
are written to stdout; diagnostics are written only to stderr.

## MCP host configuration

```json
{
  "mcpServers": {
    "cline-cloud-agents": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/cline/sdk/examples/mcp/cloud-agent-spawner/build/cli.js"
      ]
    }
  }
}
```

For development, use `bun run` with the absolute path to `server.ts`.

The OAuth tools save credentials to Cline's normal provider settings and the
server refreshes them automatically. `CLINE_API_KEY` is also supported for
non-interactive environments.
