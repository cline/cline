# Feature Request: Auto-approve “Create New Task” with UI toggle in Auto Approval

## Title
Auto-approve “Create New Task” + UI toggle in Auto Approval

## Problem / Motivation
When Cline determines a new task context is warranted (e.g., scope or intent shifts), it uses the `new_task` tool to ask the user to start a new task. For power users and automated flows, this user-confirmation step can be unnecessary friction. There’s currently no per-action auto-approval control for creating a new task, despite similar controls existing for read/edit files, browser, commands, and MCP tools.

Goal: Allow users to opt-in to automatically approve new task creation when Cline suggests it, with appropriate safeguards and visibility.

## Proposed Solution
Add a new per-action auto-approval toggle “Create new tasks” to the Auto Approval settings (webview UI). When enabled, the `new_task` tool should execute without a blocking ask and create a new task programmatically. This includes:

1) Config and Type Changes
- Add `actions.createNewTask?: boolean` to `AutoApprovalSettings`.
- Convert to/from proto with a new `create_new_task` field:
  - `AutoApprovalActions.create_new_task` in `proto/cline/state.proto`
  - `AutoApprovalSettingsRequest.Actions.create_new_task`

2) Auto-approval Logic
- Extend `AutoApprove.shouldAutoApproveTool` to return `actions.createNewTask` for `ClineDefaultTool.NEW_TASK`.
- In `NewTaskHandler`, on auto-approval:
  - Suppress the interactive ask flow for partials and completes when toggled on.
  - Programmatically create a task via a new `createNewTask(text, images?, files?)` callback.
  - Increment consecutive-auto-approved counter and emit system notifications if enabled.

3) Tool/Executor Wiring
- Add a `createNewTask` callback to `TaskConfig.callbacks` and pass through `ToolExecutor` from `Task`:
  - `Task.createNewTaskCallback` calls `controller.handleTaskCreation(text)` as primary flow, with fallback to `controller.initTask(text, images, files)`.
- Use `createNewTask` in `NewTaskHandler` under the auto-approved path.

4) Webview UI
- Add a new checkbox to Auto Approval modal:
  - Action id: `createNewTask`
  - Label: “Create new tasks”
  - Path: `webview-ui/src/components/chat/auto-approve-menu/constants.ts`
- Wire is handled by existing `useAutoApproveActions` + state versioning.

5) Safeguards
- Respect global auto-approval enable/disable and `maxRequests` cap.
- Optional notifications for auto-approved actions via existing `enableNotifications`.

## Alternatives Considered
- Continue manual approval only: preserves control but slows workflows.
- One-off prompt instruction: non-discoverable, not user-controlled in UI.
- Global “YOLO mode” only: too coarse; we want a specific per-action toggle.

## Risk Mitigations
- The `maxRequests` cap limits runaway auto-approvals.
- Users must explicitly opt-in via the per-action toggle.
- Notifications (if enabled) surface auto-approved actions.
- The ask path remains the default (toggle default is off).

## Scope / Acceptance Criteria
- A new toggle “Create new tasks” appears in the Auto Approval modal and persists state.
- When enabled and auto-approval is globally enabled:
  - For `new_task` tool calls, the handler does not render an ask and creates a new task automatically.
  - `consecutiveAutoApprovedRequestsCount` increments and is bounded by `maxRequests`.
  - Notification is shown when `enableNotifications` is true.
- When disabled, existing interactive behavior remains unchanged.
- No regressions to other auto-approval toggles or tool flows.

## Testing Steps
1) UI Toggle Visibility
- Open Auto Approval modal.
- Verify “Create new tasks” toggle exists and can be toggled.

2) Auto-approve Flow
- Ensure Auto Approval is enabled; enable “Create new tasks”.
- Trigger a model response that uses `new_task` (e.g., instruct Cline to begin a new task given a different scope).
- Expected: No user ask is shown; a new task is created automatically; a system notification appears if enabled.

3) Manual Flow
- Disable “Create new tasks”.
- Trigger `new_task` again.
- Expected: The ask is presented; clicking “Create New Task” proceeds as before.

4) Max Requests Limit
- Set a low `maxRequests` (e.g., 1), then trigger `new_task` twice.
- Expected: After reaching the limit, the max-requests ask shows before continuing.

5) State Persistence
- Toggle “Create new tasks” on, reload the extension window, verify persisted state.

6) Telemetry (if enabled in your environment)
- Confirm tool usage captures auto-approved flag.

7) Protobuf Regeneration
- Run `npm run protos` to generate updated TS proto artifacts when npm policy allows (see follow-up).

## Impacted Files (Summary of Changes)
- Core Types and Logic
  - src/shared/AutoApprovalSettings.ts
    - Add actions.createNewTask?: boolean
  - src/core/task/tools/autoApprove.ts
    - Map ClineDefaultTool.NEW_TASK to actions.createNewTask
  - src/core/task/tools/types/TaskConfig.ts
    - Add callbacks.createNewTask signature
  - src/core/task/tools/utils/ToolConstants.ts
    - Add “createNewTask” to TASK_CALLBACKS_KEYS
  - src/core/task/tools/handlers/NewTaskHandler.ts
    - On auto-approve, skip ask and call createNewTask(context)
  - src/core/task/ToolExecutor.ts
    - Thread createNewTask callback through TaskConfig
  - src/core/task/index.ts
    - Implement createNewTaskCallback via controller.handleTaskCreation()

- Proto and Conversions
  - proto/cline/state.proto
    - message AutoApprovalActions: bool create_new_task = 9;
    - message AutoApprovalSettingsRequest.Actions: bool create_new_task = 9;
  - src/shared/proto-conversions/models/auto-approval-settings-conversion.ts
    - Convert createNewTask / create_new_task both ways

- Webview UI
  - webview-ui/src/components/chat/auto-approve-menu/constants.ts
    - Add “Create new tasks” action metadata

## Follow-up Work
- Regenerate protobufs after npm registry policy issues are resolved:
  - npm run protos
  - Verify no TS type errors remain related to proto types.
- Consider adding end-to-end tests for the auto-approve new task path.
- Update documentation to reference the new toggle.

## Screenshots / UI (optional)
- [Placeholder for screenshots of the Auto Approval modal with the new toggle]

---

## Copy-paste body for GitHub Feature Request (Discussions)
Title: Auto-approve “Create New Task” + UI toggle in Auto Approval

Problem
When Cline suggests starting a new task (new_task tool), users must manually approve. Advanced users and automation flows often want this step to be automatic, similar to other auto-approval toggles (read/edit/browser/commands/MCP).

Proposal
- Add per-action toggle: “Create new tasks” in Auto Approval
- When enabled, `new_task` executes without a blocking ask and creates a new task automatically
- Respect global maxRequests and optional notifications

Design
- AutoApprovalSettings: actions.createNewTask?: boolean
- Proto: AutoApprovalActions.create_new_task, AutoApprovalSettingsRequest.Actions.create_new_task
- AutoApprove: return actions.createNewTask for ClineDefaultTool.NEW_TASK
- NewTaskHandler: skip ask and call createNewTask(context) via callback
- ToolExecutor/Task: new createNewTask callback; Task calls controller.handleTaskCreation
- UI: Add checkbox to Auto Approval modal

Acceptance Criteria
- New toggle visible and persisted
- Auto-approve path creates a new task programmatically when enabled
- Default remains manual ask when disabled
- No regressions to existing auto-approval features

Follow-up
- Run `npm run protos` when npm policy allows, to regenerate updated TS proto artifacts
- Add tests and docs as appropriate

Thanks for considering this improvement! It streamlines multi-step agent flows while preserving user control via opt-in and caps.
