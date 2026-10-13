# Cline Cloud sessions in the VS Code extension: follow-ups

This PR ships cloud sessions in the extension behind the `ext-cloud-sessions`
feature flag (override locally with `CLINE_CLOUD_SESSIONS=1`). This file records
remaining integration work, current limitations, and local development setup.

## How it is wired today

- `src/services/cloud/CloudSessionsService.ts`: VS Code adapter over the SDK's
  `CloudSessionApi` for repositories, branches and session lifecycle. It retains
  extension error wording, the history-envelope reader and GitHub install redirect.
- `src/sdk/cloud-session-host.ts`: `CloudSessionHost` implements the same
  `SdkSessionHost` interface the local `VscodeSessionHost` does, on top of the
  SDK's `RemoteRuntimeHost`. It dials the sandbox Hub through
  `wss://api.cline.bot/api/v1/session/{id}` with the account token as a
  `Authorization: Bearer` header and maps the outer `ses-…` id to the inner Hub
  session id. Everything downstream (event coordinator, message translator,
  chat view) is unchanged.
- `src/sdk/sdk-cloud-session-coordinator.ts`: starts/reopens cloud tasks, keeps
  sandbox connections alive so running/finished status is known, projects cloud
  records into task history, raises the "Cloud task finished" notification.
- SDK: `NodeHubClient.resolveConnectionHeaders` (ported from #13519) plus a
  passthrough on `HubRuntimeHost`/`RemoteRuntimeHost`.

## Shared cloud integration

1. Share `normalizeGitHubRemoteUrl` (duplicated in
   `src/shared/cloud/cloud-sessions.ts` and the SDK's `cloud-handoff/
   git-preflight.ts` on the desktop branch) once #13574 lands.
2. Have `CloudSessionHost` reconcile
   pending approvals on reconnect. Today cloud sessions auto-approve every tool
   in the extension, so this only matters if we ever
   let cloud sessions ask for approval.

## Backend asks

- `GET /api/v1/session` describes sandbox availability, not authoritative agent
  activity. The extension remembers settled outcomes and resolves unknown visible
  rows over live connections. Unresolved rows show Unconfirmed. A record update
  more than 60 seconds after an observation invalidates that outcome; the grace
  window tolerates this client's connect touch but can also hide a quick external
  resume. Exposing an agent revision, activity and last-message time would remove
  that heuristic and improve cross-device status and timestamps.
- A typed error code for billing/limit failures on `POST /api/v1/session`, so
  the start error can offer "Add credits" like local tasks do.

## Extension follow-ups

- Cloud handoff (`/handoff`): continue a local task in the cloud using the
  `cloud-handoff` primitives from #13574 (git preflight, transcript seeding via
  `initialMessages`, model selection). `RemoteRuntimeHost.startSession` already
  accepts `initialMessages`, so the extension side is mostly UI plus the
  preflight error messaging.
- Opening files from a cloud transcript: the edit/read rows still offer "open
  in editor", which resolves against the local workspace. Either hide the
  affordance for cloud tasks or open a read-only virtual document fetched from
  the sandbox.
- Restore notification monitoring for offscreen running tasks after a reload.
  Visible unknown tasks reconnect automatically, but offscreen tasks have no
  persistent notification subscription.
- Favorites and rename for cloud rows in History (favorites are local-history
  metadata today; rename exists in the API but has no UI in the extension).
- Model picker for cloud tasks: the sandbox runs the user's Act-mode Cline
  model, or the first recommended Cline model when a non-Cline provider is
  selected. A small model picker in the RUN TASK panel would make the exact
  model explicit before launch.
- Plan mode for cloud tasks: extension cloud sessions are Act-only today
  (the toggle is pinned to Act with a tooltip).
  The SDK runtime fixes the tool set and Plan command guard when a session is
  built, so supporting a mid-task switch means rebuilding the sandbox
  conversation with `initialMessages`, the way local tasks do.
- Multi-root workspaces: the repository is prefilled from the primary root's
  `origin`; a root picker would help users with several GitHub repos open.
- Telemetry: `cloud_task_started`, `cloud_task_completed`, `cloud_task_failed`,
  and `cloud_github_connect_clicked` events.
- Expand the checked-in cloud boundary with packaged VS Code coverage for
  History reopen and completion notifications. `bun run test:cloud` exercises
  the production REST client and authenticated WebSocket path through a real
  local Hub; `bun run dev:cloud-sessions` runs the same credential-free fixture
  for interactive extension development.

The local development command prints a loopback-only `CLINE_LOCAL_CLOUD_URL`
override so API, dashboard, GitHub-management and MCP endpoints share the fixture
listener. The dashboard/integration pages identify themselves as fixtures; they
do not emulate the hosted website. Managed `endpoints.json` configurations still
take precedence. Use an unmanaged development environment for this workflow.
