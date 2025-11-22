---
"claude-dev": minor
---

feat(auto-approve): add auto-approve for creating new tasks plus UI toggle; update proto schema

Summary:
- Added actions.createNewTask toggle to AutoApprovalSettings (default off)
- New per-action UI checkbox “Create new tasks” in Auto Approval modal
- Auto-approve path for `new_task` tool (skips ask; programmatically creates task; respects notifications and maxRequests)
- Extended AutoApprove.shouldAutoApproveTool to handle NEW_TASK
- Handler plumbing via callbacks.createNewTask and Task/ToolExecutor wiring
- Proto schema updated (create_new_task) and conversions implemented; run `npm run protos` when npm registry policy allows to regenerate TS artifacts

Testing:
- Enable Auto Approval and “Create new tasks”; verify `new_task` auto-creates a new task without blocking ask
- Disable toggle; verify interactive ask remains
- Verify maxRequests cap and notifications behavior

Follow-up:
- `npm run protos` to regenerate and clear type diagnostics once npm registry policy allows.
