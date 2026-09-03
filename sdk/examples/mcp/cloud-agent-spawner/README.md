# Cline Cloud Agent MCP Server

A standalone stdio Model Context Protocol server that lets any MCP host use a
Cline API key to spawn autonomous Cline Cloud agents.

The server has no Codex-specific integration. Any MCP client capable of
launching a local stdio server can use it, including Claude Code, Codex, desktop
agent applications, and custom agent runtimes. Client-specific approval and
configuration behavior remains the responsibility of the MCP host.

## Tools

- `spawn_cloud_agent` starts one asynchronous cloud-agent operation and immediately returns an operation ID.
- `get_cloud_agent_spawn_status` reports provisioning progress and the final cloud and agent session IDs.

The implementation follows the desktop app's cloud lifecycle: API-key
authentication, REST workspace provisioning, authenticated Hub
WebSocket, `session.create`, `session.attach`, and durable `run.enqueue`.

## Recommended agent workflow

1. Call `spawn_cloud_agent` exactly once for each cloud agent the user requests.
2. Tell the user that provisioning started and may take several minutes.
3. Poll `get_cloud_agent_spawn_status` with the returned `operationId`, waiting
   at least `pollAfterMs` between checks. Never retry `spawn_cloud_agent` merely
   because the operation remains pending; doing so can create a duplicate workspace.
4. Pending responses identify the current stage, including authentication,
   workspace creation, provisioning, runtime connection, and prompt submission.
5. When status becomes `running`, show `dashboardUrl`, `runId`, and both session
   IDs. The cloud run has been durably accepted and continues independently;
   `running` does not mean its task is finished.
6. When status becomes `failed`, show the error. If a dashboard URL is present,
   the workspace exists but its inner agent could not be started.

Before starting the server, set `CLINE_API_KEY` in its environment. Do not pass
the API key as a tool argument or include it in an agent prompt. If a status
response reports that the key is missing or invalid, update the MCP server's
environment, restart it, and start a new operation only after configuration is
fixed.

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
      ],
      "env": {
        "CLINE_API_KEY": "${CLINE_API_KEY}"
      }
    }
  }
}
```

For development, use `bun run` with the absolute path to `server.ts`.

`CLINE_API_KEY` is the only supported authentication method. Keep it in the MCP
host's secret or environment configuration; never place it in prompts or tool
arguments.
