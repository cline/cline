# PR: Auto-approve “Create New Task” + UI toggle in Auto Approval

## Summary
This PR adds a per-action auto-approval toggle for creating new tasks and wires the `new_task` tool to auto-create a task when enabled. It mirrors existing per-action auto-approve toggles (read/edit/browser/commands/MCP) and respects global limits and notifications.

Key points:
- New toggle in Auto Approval: “Create new tasks”
- When enabled and auto-approval is on, `new_task` no longer shows a blocking ask; it programmatically creates a new task
- Honors `maxRequests` cap and optional notifications
- Default behavior remains unchanged when toggle is off

## Motivation
Advanced workflows often require Cline to branch into a new task context without manual confirmation. The lack of a specific toggle for `new_task` created friction for users who already trust auto-approve for other capabilities. This PR delivers user choice and parity across auto-approve actions.

## Linked Discussion
- https://github.com/cline/cline/discussions/6931

## Changes
- Types and conversions
  - src/shared/AutoApprovalSettings.ts
    - Add `actions.createNewTask?: boolean` (default false)
  - src/shared/proto-conversions/models/auto-approval-settings-conversion.ts
    - Convert `createNewTask` ⇄ `create_new_task`
  - proto/cline/state.proto
    - AutoApprovalActions: `bool create_new_task = 9;`
    - AutoApprovalSettingsRequest.Actions: `bool create_new_task = 9;`

- Auto-approve logic
  - src/core/task/tools/autoApprove.ts
    - Return `actions.createNewTask` for `ClineDefaultTool.NEW_TASK`

- Handler and plumbing
  - src/core/task/tools/handlers/NewTaskHandler.ts
    - If auto-approved, suppress ask; call `createNewTask(context)`; increment consecutive auto-approvals; show notification if enabled
  - src/core/task/tools/types/TaskConfig.ts
    - Add `callbacks.createNewTask(text, images?, files?)`
  - src/core/task/ToolExecutor.ts
    - Expose `createNewTask` via TaskConfig callbacks
  - src/core/task/index.ts
    - Implement `createNewTaskCallback` calling `controller.handleTaskCreation(text)` with fallback to `controller.initTask(text, images, files)`
  - src/core/task/tools/utils/ToolConstants.ts
    - Add `"createNewTask"` to `TASK_CALLBACKS_KEYS`

- Webview UI
  - webview-ui/src/components/chat/auto-approve-menu/constants.ts
    - Add checkbox entry: id `createNewTask`, label “Create new tasks”

## Screenshots
- [Add screenshots of Auto Approval modal with the new “Create new tasks” checkbox]

## Acceptance Criteria
- The “Create new tasks” toggle appears in Auto Approval and persists state
- When enabled and auto-approval is on:
  - `new_task` executes without presenting a blocking ask
  - A new task is created programmatically; notifications shown if enabled
  - Auto-approve request counter increments and respects `maxRequests`
- When toggle is off, the existing ask flow remains unchanged
- No regressions to other auto-approve toggles/flows

## Testing (Manual)
1. Enable Auto Approval and toggle “Create new tasks” on
2. Trigger a situation where `new_task` is used (e.g., instruct Cline to start a new task with a new goal)
   - Expected: No ask is presented; a new task is created; notification appears if enabled
3. Toggle off “Create new tasks”
   - Expected: The ask flow returns; the user must confirm starting a new task
4. Set a low `maxRequests` and hit the cap
   - Expected: The “max requests reached” ask shows before continuing

## Follow-up
- Regenerate protobufs (blocked by npm registry policy in the dev environment)
  - Run `npm run protos` once allowed; re-check type diagnostics
- Consider adding an E2E test covering the auto-approve `new_task` path
- Document the new toggle in user-facing docs

## Changeset
Included:
- .changeset/auto-approve-new-task.md (minor): Introduces the feature and proto schema updates.

## Notes
- Branch: `feature/auto-approve-new-task`
- If maintainers prefer a different name for the action (`createNewTask`), I can update naming across code and proto accordingly.
