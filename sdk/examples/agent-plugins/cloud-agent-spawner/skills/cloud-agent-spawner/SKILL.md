---
name: cloud-agent-spawner
description: Connect a Cline account and create autonomous Cline Cloud agents in GitHub repositories. Use when the user asks to spawn, start, delegate to, or hand work to a Cline cloud agent.
---

# Cline Cloud Agent Spawner

Use the bundled MCP tools as one stateful workflow. The MCP server must have
`CLINE_API_KEY` configured in its process environment before use.

## Create an agent

1. Collect the repository URL, task prompt, model ID, and optional branch or
   organization. Confirm any missing value that cannot be inferred safely.
2. Call `spawn_cloud_agent` exactly once. Creating a cloud workspace can consume
   resources, so never repeat this call just because it is slow or a status check
   times out.
3. Immediately tell the user that provisioning started, can take several
   minutes, and will be monitored using the returned `operationId`.
4. Call `get_cloud_agent_spawn_status` with that operation ID. While the result
   is `pending`, wait at least its `pollAfterMs` before polling again. Briefly
   mention meaningful stage changes; do not narrate identical polls.
5. A `running` result means the prompt was durably accepted and the cloud agent
   now runs independently. Respond with `dashboardUrl`, `runId`,
   `cloudSessionId`, and `agentSessionId`. Do not claim that the delegated task
   itself is complete.
6. For `failed`, report the exact error. If `cloudSessionId` or `dashboardUrl` is
   present, explain that the workspace was created but its inner agent failed;
   do not automatically create another workspace.

## API key errors

If the operation fails because `CLINE_API_KEY` is missing or invalid, tell the
user to configure it in the MCP server's environment and restart that server.
Never request the key in conversation, accept it as a tool argument, inspect its
value, or include it in output. Do not retry until the server configuration has
been corrected.

## Suggested user updates

- After starting: “Cloud workspace provisioning has started. This commonly
  takes several minutes; I’ll monitor this operation without creating another.”
- During a stage change: “The workspace is ready; the Cline agent session is
  being started now.”
- On success: “The cloud agent accepted the task and is running independently.”
