# Phase 11 Handoff: Recovery, History, Checkpoints, Git, and Local Diagnostics

## Goal

Make tasks safely resumable across VS Code restarts, complete checkpoint
compare/restore, retain Git commit-message assistance, and provide useful
redacted local diagnostics.

This phase combines:

- Step 16: complete history and checkpoint recovery;
- Step 17: complete Git assistance and local diagnostics.

Repository: `C:\Coding\cline_aws`

Prerequisite: Phase 10 is complete and committed. Read `plan/scope.md`,
`plan/phase8.md`, `plan/phase10.md`, and the applicable `AGENTS.md` files.

## Boundaries

Keep:

- Phase 8 doctor and selected Bedrock target validation;
- Phase 9 run lifecycle and cancellation;
- Phase 10 team/task/worktree state;
- existing task history and checkpoint services;
- Git status/diff inspection and commit-message generation;
- local logging only.

Do not add:

- cloud history or checkpoint synchronization;
- account identity;
- persisted AWS credentials;
- automatic replay of interrupted tools;
- automatic Git commit, push, force operation, or destructive reset;
- remote telemetry or log upload;
- complete prompts, source files, or tool payloads in default logs.

## Part A: Conversation History

History must persist:

- task/session ID and title;
- workspace/repository identity;
- message sequence needed to render and resume;
- selected Bedrock target identity, never credentials;
- Plan/Act mode;
- completion, failure, cancellation, or interruption state;
- associated team task, agent, worktree, branch, and checkpoints;
- timestamps and compact usage totals when available.

Use existing areas:

```text
apps/vscode/src/sdk/sdk-task-history.ts
apps/vscode/src/sdk/sdk-session-history-loader.ts
apps/vscode/src/core/controller/task/getTaskHistory.ts
apps/vscode/webview-ui/src/components/history/
sdk/packages/core/src/runtime/host/history.ts
```

History listing must tolerate:

- deleted workspaces;
- missing worktrees;
- old schema versions;
- missing optional usage/model metadata;
- one corrupt entry without hiding every other task.

Do not delete user history during migration. Quarantine or report unreadable
records individually.

## Part B: Resume Workflow

When a user resumes a task:

1. load and validate the history record;
2. locate the original workspace or assigned worktree;
3. inspect current Git and filesystem state;
4. restore the selected Bedrock target metadata;
5. rerun the relevant Phase 8 doctor stages;
6. rediscover the target when required;
7. ask for a new target when the saved target is unavailable;
8. mark interrupted tool calls as interrupted;
9. enter a usable chat without replaying a state-changing action.

Never resume by automatically repeating:

- a file edit;
- terminal command;
- browser action;
- MCP/plugin call;
- worktree/Git mutation;
- child-agent spawn.

Show the user what was interrupted and let a new model turn decide what to
propose next.

Expired credentials are expected. Re-resolve environment/profile credentials;
do not treat credential expiration as corrupt history.

## Part C: Checkpoint Compare and Restore

Reuse:

```text
apps/vscode/src/sdk/sdk-checkpoints.ts
apps/vscode/src/core/controller/checkpoints/checkpointRestore.ts
sdk/packages/core/src/session/checkpoint-diff.ts
sdk/packages/core/src/session/checkpoint-restore.ts
```

Each checkpoint should retain:

- checkpoint ID and timestamp;
- task/session ID;
- workspace/worktree identity;
- relevant Git base/HEAD information;
- file snapshot or patch metadata;
- short reason/label;
- schema version.

Compare must show:

- added, modified, deleted, and renamed files;
- per-file diffs;
- current workspace divergence;
- files that can no longer be restored safely.

Restore must:

1. calculate and show the proposed restore diff;
2. detect dirty or divergent current state;
3. require explicit approval;
4. write only within the validated workspace/worktree;
5. apply atomically where practical;
6. stop and report partial failure without claiming full success;
7. preserve the checkpoint after restore.

Do not invoke `git reset --hard` or delete untracked files as the checkpoint
implementation.

## Part D: Resume Teams and Worktrees

On restart:

- restore the Phase 10 board and terminal agent outcomes;
- mark previously active agents/runs as interrupted;
- reconnect task records to existing worktrees;
- report missing or relocated worktrees;
- never recreate or delete a worktree automatically;
- allow the user to resume an interrupted task in its valid worktree.

The parent and child histories must remain separately inspectable.

## Part E: Git Commit-Message Assistance

Use the existing commit-message generator:

```text
apps/vscode/src/hosts/vscode/commit-message-generator.ts
apps/vscode/src/utils/git.ts
apps/vscode/src/core/controller/file/searchCommits.ts
```

Generate a message from:

- repository status;
- staged diff when present, otherwise the selected diff;
- branch/worktree context;
- optional user guidance.

Requirements:

- use the ready Bedrock target from Phase 8;
- bound and redact the diff sent to the model;
- do not include ignored secret files;
- show the generated subject/body for editing;
- copy or place it into the VS Code Source Control input only after user
  action;
- do not run `git commit` or `git push` automatically.

If an existing explicit commit action is retained, it must remain a separate
approval after message generation. Commit-message generation itself does not
authorize a commit.

## Part F: Local Diagnostic Logs

Implement one local structured logging path, preferably under the extension's
VS Code `globalStorageUri`:

```text
logs/
  current.jsonl
  previous.jsonl
```

Reuse or consolidate:

```text
apps/vscode/src/shared/services/Logger.ts
sdk/packages/shared/src/logging/logger.ts
sdk/packages/core/src/logging/early-logger.ts
apps/vscode/src/integrations/diagnostics/
```

Log small lifecycle events:

- extension activation/shutdown;
- Phase 8 doctor stage and categorized error;
- chat run transitions;
- Bedrock request start/end, duration, usage, code, and request ID;
- cancellation;
- tool name, approval outcome, duration, and success/failure;
- history/checkpoint/resume outcome;
- team/worktree operation outcome;
- Git message-generation outcome.

Use correlation fields:

- local event ID;
- run ID;
- task/session ID;
- optional agent/team task ID;
- stage/category;
- timestamp and duration.

Do not log by default:

- AWS keys, tokens, authorization headers, or credential cache contents;
- complete STS identity;
- complete prompts or model responses;
- source-file contents or full diffs;
- command/MCP/browser payloads;
- environment-variable dumps;
- direct personal information.

Redaction must occur before serialization. A logging failure must not stop the
agent.

## Part G: Diagnostic User Actions and Rotation

Provide:

- Open Diagnostic Log;
- Copy Sanitized Diagnostics;
- optional Clear Local Logs with confirmation.

The copied diagnostic summary should include:

- extension/version/platform;
- region and masked endpoint;
- profile name or default-chain marker;
- selected target ID;
- latest doctor/run state;
- categorized errors and request IDs;
- relevant task/worktree/checkpoint IDs;
- no secrets or content payloads.

Rotation:

- cap each file by size;
- retain a small fixed number of files;
- rotate atomically;
- do not upload logs;
- report the local path clearly.

## Implementation Order

1. Confirm Phase 10 is committed and the working tree is clean.
2. Version and validate the retained history/checkpoint contracts.
3. Make history loading tolerant of missing/corrupt individual entries.
4. Implement the safe resume workflow and interrupted-tool handling.
5. Complete checkpoint compare and approved restore.
6. Reconnect team/worktree state without automatic mutations.
7. Simplify Git commit-message generation around the ready Bedrock target.
8. Consolidate local logging and implement redaction before serialization.
9. Add log rotation and open/copy/clear actions.
10. Run focused coverage and restart/recovery acceptance.
11. Package and inspect the VSIX.
12. Commit Phase 11 independently.

## Minimal Automated Coverage

Keep tests focused:

1. one restart/resume test proving interrupted state-changing tools are not
   replayed and an expired credential triggers revalidation;
2. one checkpoint test covering compare, dirty-workspace blocking, approved
   restore, and partial-failure reporting;
3. one diagnostics test covering secret/content redaction and rotation;
4. one commit-message input test covering bounded diff and exclusion of secret
   files.

Do not build a large historical-version matrix. Keep only migrations required
for supported Bedrock-only releases and the cleanup migrations retained from
Phases 4 and 5.

## Required Commands

```powershell
# Repository root
bun install
bun run build:sdk

# apps/vscode
bun run check-types
bun esbuild.mjs
bun run package
```

## Manual Acceptance

Using the packaged VSIX and a disposable Git repository:

1. start a task, create a checkpoint, and make a two-file change;
2. restart VS Code during a waiting or streaming state;
3. reopen history and confirm the run is marked interrupted;
4. resume without replaying any previous edit or command;
5. confirm the Bedrock doctor revalidates credentials and target;
6. compare the checkpoint against current files;
7. attempt restore with dirty divergence and inspect the warning;
8. approve a safe restore and verify the resulting files;
9. resume one Phase 10 child task in its existing worktree;
10. generate and edit a Git commit message from a bounded diff;
11. confirm no commit or push occurs automatically;
12. open logs and copy sanitized diagnostics;
13. search logs for temporary AWS secrets and known prompt/file strings and
    confirm they are absent;
14. trigger log rotation and confirm the extension remains usable.

## Done When

- history survives restart and tolerates isolated corrupt/missing records;
- resume revalidates Bedrock and never replays state-changing tools;
- checkpoint compare and restore are reviewable and explicitly approved;
- team/worktree associations recover without automatic Git mutations;
- commit-message generation is bounded, editable, and non-committing;
- local logs explain startup, run, tool, checkpoint, worktree, and Git
  failures;
- credentials and content payloads are redacted before logging;
- logs rotate locally and are never uploaded;
- required commands, focused tests, manual acceptance, and VSIX inspection
  pass.

## Commit

Suggested message:

```text
feat: add task recovery checkpoints and local diagnostics
```

The completion handoff should report:

- commit SHA;
- history/checkpoint schema and migration decisions;
- resume and interrupted-tool behavior;
- checkpoint compare/restore result;
- team/worktree recovery result;
- Git message-generation behavior;
- log location, rotation, and redaction results;
- required command and VSIX path.
