# Cloud Agent Spawner Agent Plugin

Portable Agent Plugin packaging for the standalone Cline Cloud Agent MCP server.
The server implementation lives in
[`../../mcp/cloud-agent-spawner`](../../mcp/cloud-agent-spawner).

This example is agent-client neutral. It uses the Agent Plugins and MCP
contracts rather than APIs belonging to a particular host, so it can be used by
Claude Code, Codex, and other agents that support those standards. A host may
apply its own tool-approval UI and plugin discovery rules.

After installing the monorepo dependencies, copy or link this directory into an
Agent Plugins discovery root while keeping it able to resolve its workspace
dependency on the standalone MCP example:

- Project: `.agents/plugins/cloud-agent-spawner`
- User: `~/.agents/plugins/cloud-agent-spawner`

The plugin exposes the standalone server's `spawn_cloud_agent` and
`get_cloud_agent_spawn_status` tools through `mcp.json`. Configure
`CLINE_API_KEY` in the host process before launching the plugin. Its bundled
skill tells the host agent how to poll without creating duplicate workspaces and
present the final dashboard, run ID, and session IDs without exposing the key.
