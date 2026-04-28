# SDK Checkpoint System — Implementation Plan

Ref-based checkpoint system for the SDK-migrated Cline extension. Uses synthetic Git commits under custom refs in the user's workspace repo, replacing the old shadow-git approach.

## Design Decisions

1. Use the user's workspace `.git` repo — no shadow git repos, no `~/.cline/data/checkpoints/` directory. Non-git workspaces do NOT get checkpoint support (gracefully skip/disable).
2. Ref naming: `refs/cline/checkpoints/<taskId>/turn/<sequenceNumber>`
3. Checkpoints form their own commit chain — each checkpoint's parent is the previous checkpoint commit for that task. The first checkpoint's parent is HEAD at task-start time.
4. Metadata stays on ClineMessage — `lastCheckpointHash` on ClineMessage objects is the source of truth for mapping messages to checkpoint commits. The webview already reads this field.
5. No workspace mutation lock — disable restore UI buttons while agent is running. Keep the existing cancel-before-restore pattern.
6. Checkpoints are created when a **user submits a follow-up message** (not on every tool execution). Only user messages have the "restore to checkpoint" option.

## Implementation Checklist

### New Files

- [x] `src/integrations/checkpoints/RefCheckpointTracker.ts` — Git plumbing-based tracker
  - Uses `child_process.execFile` with `GIT_INDEX_FILE` env overrides
  - `create()` — validates git repo, gracefully skips non-git workspaces
  - `commit()` — temp index → `git add -A` → `git write-tree` → `git commit-tree` → `git update-ref`
  - `restore()` — deletes untracked files not in checkpoint, then `git restore --source=<hash> --worktree -- .`
  - `getDiffSet()` / `getDiffCount()` — `git diff --name-status` / `--name-only`
  - `cleanupRefs()` / `cleanupRefsForTask()` — `git for-each-ref` + `git update-ref -d`

- [x] `src/integrations/checkpoints/SdkCheckpointManager.ts` — Lean manager implementing `ICheckpointManager`
  - Lazy-inits `RefCheckpointTracker` on first use (promise-based dedup)
  - `commit()` — creates checkpoint, writes `lastCheckpointHash` onto latest `checkpoint_created` ClineMessage
  - `saveCheckpoint()` — delegates to `commit()`, handles completion messages
  - `restoreCheckpoint()` — uses tracker's `restore()` for workspace restores, supports offset-based message lookup
  - `doesLatestTaskCompletionHaveNewChanges()` — checks diff count between previous and current completion

### Modified Files

- [x] `src/sdk/task-proxy.ts` — Wire `checkpointManager` property + message truncation
  - Changed from `any` stub returning `undefined` to `ICheckpointManager | undefined` with getter/setter
  - Added `currentCheckpointManager` mutable state
  - Added `setMessages()` to `MessageStateHandler` for checkpoint restore truncation

- [x] `src/sdk/SdkController.ts` — Initialize checkpoint manager on task creation
  - Added `initCheckpointManager(task)` private method
  - Wired into `taskControl.setTask` callback (fires when task proxy is created)
  - Reads `enableCheckpointsSetting` from StateManager

- [x] `src/sdk/sdk-followup-coordinator.ts` — Checkpoint save on user message
  - Added `saveCheckpointOnUserMessage()` private method
  - Called in `askResponse()` **before** `emitUserFeedback()` so `checkpoint_created` appears before `user_feedback` in the message array (the UserMessage "edit & restore" UI sends `offset: 1` which subtracts from the user_feedback index)
  - Emits `checkpoint_created` ClineMessage, then fire-and-forget `saveCheckpoint()`

- [x] `webview-ui/src/components/common/CheckmarkControl.tsx` — Disable restore while running
  - Added `isAgentRunning?: boolean` prop
  - "Restore" button disabled with `not-allowed` cursor and tooltip when agent is running

- [x] `webview-ui/src/components/chat/UserMessage.tsx` — Disable restore while running
  - Added `isAgentRunning?: boolean` prop and `disabled?: boolean` on `RestoreButtonProps`
  - "Restore All" and "Restore Chat" buttons disabled when agent is running

- [x] `webview-ui/src/components/chat/ChatRow.tsx` — Pass running state to checkpoint UI
  - Passes `isAgentRunning={isRequestInProgress}` to `CheckmarkControl` and `UserMessage`

- [x] `src/core/controller/worktree/deleteWorktree.ts` — Cleanup refs on worktree deletion
  - Added ref-based checkpoint cleanup (`refs/cline/checkpoints/*`) alongside legacy shadow-git cleanup

### Not Modified (by design)

- [ ] `src/integrations/checkpoints/types.ts` — `ICheckpointManager` interface unchanged
- [ ] `src/core/controller/checkpoints/checkpointRestore.ts` — works unchanged via `controller.task?.checkpointManager?.restoreCheckpoint(...)`

### Bug Fixes

- [x] `src/integrations/checkpoints/SdkCheckpointManager.ts` — Session invalidation on restore
  - Added `onSessionInvalidated` callback option
  - On "task" or "taskAndWorkspace" restore: saves truncated messages to disk, then tears down the active SDK session via the callback
  - Without this, the LLM's conversation history still contained deleted messages after restore (assistant "remembered" things from after the checkpoint)

- [x] `src/sdk/SdkController.ts` — Wire `onSessionInvalidated` in `initCheckpointManager`
  - Clears the active session reference, unsubscribes, stops, and disposes the session manager
  - The next `askResponse()` sees `!activeSession` and goes through `tryResumeSessionFromTask` which loads the truncated history from disk

- [x] `src/sdk/sdk-followup-coordinator.ts` — Fix session resume condition
  - Changed `(!activeSession || !activeSession.isRunning) && task` → `!activeSession && task`
  - After a turn completes, `isRunning` is `false` but the session is still alive. The old check incorrectly tore down and recreated the session on every follow-up, bypassing checkpoints and wasting resources.
  - Now only resumes when the session is truly gone (disposed after MCP reload, mode switch, etc.)

### Not Yet Implemented

- [ ] Checkpoint save on initial task creation (blocked: checkpoint manager init is async, not ready in time)
- [ ] `presentMultifileDiff` support in `SdkCheckpointManager` (optional method on `ICheckpointManager`)
- [ ] Persist checkpoint messages to disk after commit hash writeback (currently in-memory only until next message save)
- [ ] Telemetry for checkpoint operations (commit duration, restore duration, etc.)
- [ ] Unit tests for `RefCheckpointTracker` and `SdkCheckpointManager`
