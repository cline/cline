# Cline Cloud sessions in the VS Code extension: follow-ups

This PR ships cloud sessions in the extension behind the `ext-cloud-sessions`
feature flag (override locally with `CLINE_CLOUD_SESSIONS=1`). It deliberately
does not wait on the desktop-app PR stacks, so some code is duplicated or
shortcut. This file lists the cleanup and the features we chose to leave out,
roughly in the order they should be done.

## How it is wired today

- `src/services/cloud/CloudSessionsService.ts`: REST client for the control
  plane (GitHub App status/repos/branches, `POST/GET/DELETE/PATCH
  /api/v1/session`, `/status`, `/history`).
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

## Consolidate with the desktop app (JC's PR stacks)

1. Land #13519 first, then drop the copy of `resolveConnectionHeaders` from this
   branch's `sdk/packages/core/src/hub/client/index.ts` (it is the same diff).
2. Move the REST client into `@cline/core` as `services/cloud-sessions/`
   (`CloudSessionApi`, `CloudSessionRecord`, `CloudRepository`,
   `CloudSessionError`) and have both `apps/examples/desktop-app/sidecar/
   cloud-sessions.ts` and `CloudSessionsService.ts` import it. The desktop
   version also has create-timeout recovery (adopt an already-provisioned
   record after a timed-out POST) which the extension version does not.
3. Consider replacing the desktop sidecar's hand-rolled `CloudSessionManager`
   (raw `NodeHubClient`, event buffering, approval relay) with the
   `RemoteRuntimeHost`-based approach used here. It removes roughly 3k lines of
   sidecar code and both apps would share one connection/attach strategy.
4. Share `normalizeGitHubRemoteUrl` (duplicated in
   `src/shared/cloud/cloud-sessions.ts` and the SDK's `cloud-handoff/
   git-preflight.ts` on the desktop branch) once #13574 lands.
5. Land #13557 (`approval.list_pending`) and have `CloudSessionHost` reconcile
   pending approvals on reconnect. Today cloud sessions auto-approve every tool
   (same as the desktop and the dashboard), so this only matters if we ever
   let cloud sessions ask for approval.

## Backend asks

- `GET /api/v1/session` only says whether the sandbox is up (`active`), not
  whether the agent is running. The extension knows the real state only for
  sessions it is connected to; other rows fall back to a neutral "Cloud" pill.
  Exposing agent activity (running / idle / awaiting input) and the last
  assistant message time on the list record would make the History indicators
  and the "Running in the cloud" strip accurate across devices and restarts.
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
- Opening files from a cloud transcript: the edit/read rows still offer "open
  in editor", which resolves against the local workspace. Either hide the
  affordance for cloud tasks or open a read-only virtual document fetched from
  the sandbox.
- Keep a cloud session's connection across window reloads: after a reload the
  registry is empty, so a task that was running shows as "Cloud" until it is
  reopened. Persisting the ids of sessions started from this window and
  reattaching on activation would restore the status without user action.
- Favorites and rename for cloud rows in History (favorites are local-history
  metadata today; rename exists in the API but has no UI in the extension).
- Model picker for cloud tasks: the sandbox runs the user's current Cline
  model, or the first recommended model when a non-Cline provider is
  selected. A small model picker in the RUN TASK panel would make that explicit.
- Multi-root workspaces: the repository is prefilled from the primary root's
  `origin`; a root picker would help users with several GitHub repos open.
- Telemetry: `cloud_task_started`, `cloud_task_completed`, `cloud_task_failed`,
  and `cloud_github_connect_clicked` events.
- Tests: unit tests for `CloudSessionHost` (id mapping, status tracking),
  `SdkCloudSessionCoordinator` (start, open, expired, notification) and the
  `TaskTargetPanel` (onboarding variants, prefill from workspace defaults).
  The manual harness used for the PR demo (mock control plane proxying to a
  real Hub with a scripted OpenAI-compatible model) would make a good e2e
  fixture if we want one.

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
