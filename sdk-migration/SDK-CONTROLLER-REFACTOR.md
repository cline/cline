# SDK Controller Refactor Plan

This note captures the shared architecture direction for shrinking
`src/sdk/SdkController.ts` without losing the classic controller surface.

## Goal

`Controller` should become a thin classic-compatible facade:

- keep the exported `Controller` class and public method names stable
- wire dependencies and delegate real behavior to focused services
- preserve behavior during extraction-first PRs

## Extraction Order

1. `SdkMessageCoordinator`
   - Owns listener registration/emission.
   - Owns adding messages to the current task message state.
   - Owns debounced and immediate `ui_messages.json` saves.
   - Owns `finalizeMessagesForSave`.
   - Owns hook-message append/save/push mechanics.
   - Does not decide which workflow messages to create.

2. `SdkSessionFactory` and `SdkSessionLifecycle`
   - Factory owns `VscodeSessionHost.create`, tool policies, SDK callback
     wiring, subscription, and session start.
   - Lifecycle owns `activeSession`, send, abort, stop/dispose, running state,
     and shared rebuild mechanics.

3. `SdkInteractionCoordinator`
   - Owns pending `ask_question` and tool-approval promises.
   - Owns resolving and clearing those pending interactions from ask response,
     cancel, clear, and rebuild flows.

4. Shared session rebuild primitive plus separate coordinators
   - `SdkModeCoordinator` handles mode-specific policy.
   - `SdkMcpCoordinator` handles MCP reload/defer policy.
   - Both share as much rebuild mechanics as possible.

5. Controller-level session config builder
   - Centralizes hooks, extensions, and mode-specific tools such as
     `switch_to_act_mode`.
   - Workflows should not need to remember extra config mutation steps after
     calling raw `buildSessionConfig`.

6. `SdkTaskHistory`
   - Owns history lookup/update/delete, task usage updates, and
     `getTaskWithId`.
   - Full state-provider extraction can wait.

## PR 1 Scope

First PR is behavior-preserving and extracts only `SdkMessageCoordinator`.

Success criteria:

- `SdkController.ts` no longer owns the listener set, save debounce timer,
  save methods, emit method, or `finalizeMessagesForSave`.
- `Controller.onSessionEvent(...)` still exists and delegates.
- Existing session event behavior is preserved.
- Clear/show/mode rebuild still finalize messages the same way.
- Hook messages still append, save, and push to the webview immediately.
- No session lifecycle, MCP, mode, auth, or task-history redesign in this PR.

## PR 2 Scope

Second PR is behavior-preserving and extracts SDK session startup/running
state mechanics.

Implemented boundaries:

- `SdkSessionFactory`
  - Owns `VscodeSessionHost.create`.
  - Wires SDK callbacks for tool approval, `ask_question`, and event
    subscription.
  - Starts sessions and returns the host/start result.
- `SdkSessionLifecycle`
  - Owns the current `ActiveSession`.
  - Starts sessions through `SdkSessionFactory`.
  - Tracks running/idle state.
  - Owns fire-and-forget `send` completion/error handling mechanics.
  - Delegates controller-specific policy through callbacks.
- `sdk-tool-policies`
  - Contains the pure auto-approval to SDK tool-policy mapper.
  - Kept separate so the mapping can be tested without importing SDK host code.

Still deferred:

- Moving whole task workflows out of `Controller`.
- Extracting pending ask/tool approval state into `SdkInteractionCoordinator`.
- Consolidating mode/MCP rebuild policy.

## PR 3 Scope

Third PR is behavior-preserving and extracts pending SDK/user interaction
state.

Implemented boundary:

- `SdkInteractionCoordinator`
  - Owns the SDK `requestToolApproval` callback flow.
  - Owns the SDK `ask_question` callback flow.
  - Stores and resolves pending tool-approval promises.
  - Stores and resolves pending ask-question promises.
  - Emits the classic webview ask messages through `SdkMessageCoordinator`.
  - Renders user feedback for ask-question responses.
  - Clears/rejects pending interactions on mode change, task cancel, and task
    clear.

Still deferred:

- Moving normal follow-up/resume behavior out of `Controller.askResponse`.
- Moving whole task lifecycle workflows out of `Controller`.
- Consolidating mode/MCP rebuild policy.

## PR 4 Scope

Fourth PR is behavior-preserving and extracts the shared active-session
replacement primitive used by mode rebuilds and MCP tool reloads.

Implemented boundary:

- `SdkSessionLifecycle.replaceActiveSession`
  - Reads the currently active session from lifecycle state.
  - Unsubscribes from the old session event stream.
  - Stops and disposes the old session host with a caller-provided reason.
  - Starts the replacement session with optional preserved `initialMessages`.
  - Marks the replacement session idle, because rebuild/reload does not submit
    a prompt.
  - Returns the old session ID and new start result for workflow-specific UI
    updates.

Still deferred:

- Moving mode-specific rebuild policy into `SdkModeCoordinator`.
- Moving MCP reload/defer policy into `SdkMcpCoordinator`.
- Centralizing session config decoration for hooks, extensions, and mode tools.

## PR 5 Scope

Fifth PR is behavior-preserving and centralizes controller-specific SDK
session config decoration.

Implemented boundary:

- `SdkSessionConfigBuilder`
  - Calls the raw SDK-backed `buildSessionConfig`.
  - Adds hook adapters with the shared hook-message emitter.
  - Adds hook extension adapters.
  - Injects the plan-mode `switch_to_act_mode` tool.
  - Reports `switch_to_act_mode` through a callback so mode-change policy
    still lives in `Controller` for now.

Controller changes:

- Workflows now call `this.sessionConfigBuilder.build(...)` instead of
  calling raw `buildSessionConfig` and remembering to mutate hooks,
  extensions, and mode tools afterwards.

Still deferred:

- Moving mode-specific rebuild policy into `SdkModeCoordinator`.
- Moving MCP reload/defer policy into `SdkMcpCoordinator`.
- Moving normal follow-up/resume behavior out of `Controller.askResponse`.

## PR 6 Scope

Sixth PR is behavior-preserving and extracts task-history state mechanics.

Implemented boundary:

- `SdkTaskHistory`
  - Looks up history items from in-memory state first, then falls back to the
    legacy disk-backed task history.
  - Owns `getTaskWithId`, including task file path construction and stale
    state cleanup when the task payload is missing.
  - Owns task-history insert/update/delete operations against `StateManager`.
  - Owns persisted usage updates from SDK result events.

Controller changes:

- Public task-history facade methods remain on `Controller`, but now delegate
  to `SdkTaskHistory`.
- Task initialization, resume, show, and usage-update flows no longer mutate
  task history directly from `Controller`.

Still deferred:

- Moving mode-specific rebuild policy into `SdkModeCoordinator`.
- Moving MCP reload/defer policy into `SdkMcpCoordinator`.
- Moving normal follow-up/resume behavior out of `Controller.askResponse`.

## PR 7 Scope

Seventh PR is behavior-preserving and extracts mode-change policy.

Implemented boundary:

- `SdkModeCoordinator`
  - Owns the pending `switch_to_act_mode` state and applies it after the
    current turn completes.
  - Owns `toggleActModeForYoloMode` and `togglePlanActMode` behavior.
  - Owns active-session rebuilds when switching between plan and act mode.
  - Preserves conversation history through `initialMessages`.
  - Performs cancel-style cleanup for mid-turn mode switches.
  - Keeps the existing auth pre-check for Cline-account-backed modes.

Controller changes:

- Public mode-toggle methods remain on `Controller`, but delegate to
  `SdkModeCoordinator`.
- Session event and send-completion paths now ask the coordinator to apply any
  pending mode change.
- `Controller` still supplies host concerns through callbacks: workspace root
  lookup, state posting, auth-error emission, translator reset, and initial
  message loading.

Still deferred:

- Moving MCP reload/defer policy into `SdkMcpCoordinator`.
- Moving normal follow-up/resume behavior out of `Controller.askResponse`.
