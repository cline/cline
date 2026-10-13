# Cline Cloud sessions in the VS Code extension: follow-ups

This PR ships cloud sessions in the extension behind the `ext-cloud-sessions`
feature flag (override locally with `CLINE_CLOUD_SESSIONS=1`). It deliberately
does not wait on the desktop-app PR stacks, so some code is duplicated or
shortcut. This file lists the cleanup and the features we chose to leave out,
roughly in the order they should be done.

## How it is wired today

- `src/services/cloud/CloudSessionsService.ts`: the extension's wrapper around
  the SDK's shared `CloudSessionApi` (`@cline/core/cloud`), the same REST client
  the desktop app uses: GitHub App status/repos/branches, session
  create/list/status/resume/delete/rename, archived `/history`. It adds the VS
  Code account scope and endpoints, the GitHub App install redirect, and errors
  whose messages can be shown to the user. Sandboxes are created `resumable`; a
  create whose response is lost is adopted from the session list instead of
  provisioned twice.
- `src/sdk/cloud-session-host.ts`: `CloudSessionHost` implements the same
  `SdkSessionHost` interface the local `VscodeSessionHost` does, on top of the
  SDK's `RemoteRuntimeHost`. It dials the sandbox Hub through
  `wss://api.cline.bot/api/v1/session/{id}` with the account token as a
  `Authorization: Bearer` header and maps the outer `ses-…` id to the inner Hub
  session id. Everything downstream (event coordinator, message translator,
  chat view) is unchanged. New sessions start with the SDK's shared cloud
  prompt (`buildCloudSessionSystemPrompt`: GitHub access, `cline/<task>` work
  branch). After a sandbox is resumed it rebuilds the conversation's runtime
  from the saved messages before the first turn.
- `src/sdk/sdk-cloud-session-coordinator.ts`: starts/reopens cloud tasks
  (resuming suspended sandboxes first), keeps sandbox connections alive so
  running/finished status is known, projects cloud records into task history,
  raises the "Cloud task finished" notification.
- SDK: `NodeHubClient.resolveConnectionHeaders` (ported from #13519) plus a
  passthrough on `HubRuntimeHost`/`RemoteRuntimeHost`, and proxy support for
  header-authenticated Hub sockets.

## Consolidate with the desktop app (JC's PR stacks)

1. Done: the REST client is the SDK's `CloudSessionApi`, and the sandbox prompt
   comes from the SDK.
2. The desktop app now runs on the SDK's `CloudSessionController`. The extension
   deliberately keeps `RemoteRuntimeHost`: its chat view renders cloud tasks
   through the same `SdkSessionHost` events as local tasks, while the controller
   emits raw Hub events plus transcript snapshots and recovers a dropped
   connection by replacing the whole transcript. Moving the extension onto it
   would need `HubRuntimeHost`'s private Hub-event mapping exported from the SDK
   and a transcript-replace path in the message translator.
3. Share `normalizeGitHubRemoteUrl` (duplicated in
   `src/shared/cloud/cloud-sessions.ts` and the SDK's `cloud-handoff/
   git-preflight.ts` on the desktop branch) once #13574 lands.
4. Have `CloudSessionHost` reconcile
   pending approvals on reconnect. Today cloud sessions auto-approve every tool
   (same as the desktop and the dashboard), so this only matters if we ever
   let cloud sessions ask for approval.

## Backend asks

- `GET /api/v1/session` describes sandbox availability, not authoritative agent
  activity. The extension remembers settled outcomes and resolves unknown visible
  rows over live connections. Unresolved rows show Unconfirmed. A record update
  more than 60 seconds after an observation invalidates that outcome; the grace
  window tolerates this client's connect touch but can also hide a quick external
  resume. Exposing an agent revision, activity and last-message time would remove
  that heuristic and improve cross-device status and timestamps.
- Make restoring a resumed sandbox's conversation atomic: `session.create`
  replaces a live session with the same id, so two clients that send their
  first follow-up at the same moment after a resume can overwrite each other.
  Rejecting a live id with `session_already_exists` (which clients already treat
  as success) or a restore-if-missing command would close this for every client.
- A typed error code for billing/limit failures on `POST /api/v1/session`, so
  the start error can offer "Add credits" like local tasks do.
- Include `title` in the create response and accept it in the create body, so
  the extension does not need the follow-up `PATCH`.

## Extension follow-ups

- Cloud handoff (`/handoff`): continue a local task in the cloud using the
  `cloud-handoff` primitives from #13574 (git preflight, transcript seeding via
  `initialMessages`, model selection). `RemoteRuntimeHost.startSession` already
  accepts `initialMessages`, so the extension side is mostly UI plus the
  preflight error messaging.
- Opening files from a cloud transcript: edit/read rows no longer open local
  files for cloud tasks. A read-only virtual document fetched from the sandbox
  would let users inspect them.
- Restore notification monitoring for offscreen running tasks after a reload.
  Visible unknown tasks reconnect automatically, but offscreen tasks have no
  persistent notification subscription.
- Favorites and rename for cloud rows in History (favorites are local-history
  metadata today; rename exists in the API but has no UI in the extension).
- Model picker for cloud tasks: the sandbox runs the user's Act-mode Cline
  model, or the first recommended Cline model when a non-Cline provider is
  selected. A small model picker in the RUN TASK panel would make the exact
  model explicit before launch.
- Plan mode for cloud tasks: cloud sessions are Act-only today (matching the
  desktop app and the dashboard; the toggle is pinned to Act with a tooltip).
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

## Local multi-task (explicitly out of scope, rough sizing)

Running several local tasks at once is a bigger change than the cloud work
because the local pipeline is single-active by design:

- `SdkSessionLifecycle` holds one `activeSession`; `SdkSessionEventCoordinator`
  drops events for any other session; `SdkMessageCoordinator`, the
  `MessageTranslatorState`, `TurnStateTracker` and the webview `clineMessages`
  / `turnState` slices all assume one live transcript.
- The VS Code integrations are also singletons keyed on "the task": diff
  preview (`SdkDiffEditCoordinator`), foreground terminal commands, tool
  approval resolvers (`SdkInteractionCoordinator`), checkpoints, and the
  webview footer buttons.

A practical path would be to keep a single *displayed* task but let other
local sessions keep running in the background: hold a `Map<sessionId,
ActiveSession>` in the lifecycle, route events for the displayed session to the
UI and buffer or persist the rest (the SDK already persists transcripts, so
switching would reload from disk like reopening from History), give each
background session its own translator state, and surface them through the
same "Running" pills and notification path built here for cloud sessions.
Tool approvals for background sessions would have to be either auto-approved
or queued until the task is displayed. Diff preview and foreground terminal
would stay exclusive to the displayed task. That is a focused refactor of
`sdk-session-lifecycle`, `sdk-session-event-coordinator`, `sdk-message-
coordinator` and `SdkController` plus a small amount of webview work; the
history/strip UI from this PR is reusable as-is.
