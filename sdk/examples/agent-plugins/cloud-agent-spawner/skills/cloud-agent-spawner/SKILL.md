---
name: cloud-agent-spawner
description: Connect a Cline account and create autonomous Cline Cloud agents in GitHub repositories. Use when the user asks to spawn, start, delegate to, or hand work to a Cline cloud agent.
---

# Cline Cloud Agent Spawner

Use the bundled MCP tools as one stateful workflow. Keep the MCP server process
alive while OAuth or cloud provisioning is pending.

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
5. A `running` result means the prompt was accepted and the cloud agent now runs
   independently. Respond with `dashboardUrl`, `cloudSessionId`, and
   `agentSessionId`. Do not claim that the delegated task itself is complete.
6. For `failed`, report the exact error. If `cloudSessionId` or `dashboardUrl` is
   present, explain that the workspace was created but its inner agent failed;
   do not automatically create another workspace.

## Sign in when required

1. Call `start_cline_oauth` once.
2. Immediately show `verificationUrl`, `userCode`, and `expiresAt`. Clearly ask
   the user to open the URL and finish Cline sign-in.
3. Poll `get_cline_oauth_status` with the same `flowId` about every three
   seconds. Do not start another OAuth flow while this one is pending.
4. On `authenticated`, resume the original create-agent workflow. On `failed`,
   show the error and offer to start a new flow.

Never expose access tokens, refresh tokens, device codes, environment variables,
or provider-settings contents in conversation.

## Suggested user updates

- After starting: “Cloud workspace provisioning has started. This commonly
  takes several minutes; I’ll monitor this operation without creating another.”
- During a stage change: “The workspace is ready; the Cline agent session is
  being started now.”
- On success: “The cloud agent accepted the task and is running independently.”
