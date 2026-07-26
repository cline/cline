# Phase 10 Handoff: Local Teams, Worktrees, and Kanban

## Goal

Deliver local multi-agent teams, isolated Git worktrees, and a Kanban view
without depending on Cline-hosted services or external Kanban packages.

This phase implements Step 15.

Repository: `C:\Coding\cline_aws`

Prerequisite: Phase 9 is complete and committed. Read `plan/scope.md`,
`plan/phase9.md`, and the applicable `AGENTS.md` files before editing.

## Boundaries

Keep:

- the Phase 8 Bedrock connection and selected target;
- the Phase 5 approval policy;
- the Phase 9 run lifecycle and tool-result behavior;
- retained team schemas, stores, session coordination, and worktree utilities;
- local workspace/user persistence.

Do not add:

- hosted team synchronization;
- account-based identity or permissions;
- remote project-management services;
- Cline Hub or the external `kanban` package;
- separate provider/model configuration for child agents;
- child-agent approval bypasses;
- automatic worktree creation, merge, deletion, or branch mutation.

## Architecture

Use the retained layers:

```text
shared team/task contracts
  -> core team coordinator and persistence store
  -> worktree service
  -> VS Code RPC/controller
  -> local Teams/Kanban webview
```

Likely retained areas:

```text
sdk/packages/shared/src/team/
sdk/packages/shared/src/rpc/team-progress.ts
sdk/packages/core/src/session/team/
sdk/packages/core/src/session/stores/team-persistence-store.ts
sdk/packages/core/src/extensions/tools/team/
apps/vscode/src/utils/git-worktree.ts
apps/vscode/src/core/controller/worktree/
apps/vscode/webview-ui/src/components/worktrees/
```

Prefer one team/task state model shared by the coordinator and Kanban view.
Do not maintain a separate UI-only board database.

## Team and Task Contract

Use a small local task record:

```ts
type TeamTask = {
  id: string
  title: string
  status: "backlog" | "ready" | "in-progress" | "blocked" | "review" | "done"
  parentTaskId?: string
  assignedAgentId?: string
  sessionId?: string
  worktreePath?: string
  branch?: string
  summary?: string
  blocker?: string
  createdAt: string
  updatedAt: string
}
```

Reuse compatible retained fields rather than duplicating them. Add only fields
needed by the local UI and recovery.

Every agent should expose:

- local agent ID and display label;
- parent agent/task;
- current task and run state;
- selected worktree;
- last activity time;
- completed, failed, cancelled, or interrupted outcome.

Do not store AWS credentials, complete prompts, or full tool results in team
records.

## Multi-Agent Execution

Child agents must:

- inherit the parent's Bedrock connection and selected target;
- resolve credentials independently through the same ephemeral AWS chain;
- inherit Plan/Act restrictions and the central approval policy;
- use their assigned workspace/worktree boundary;
- publish progress through the retained local team coordinator;
- support cancellation and terminal outcomes;
- never approve their own state-changing tools.

Creating a child agent is a state-changing action and requires approval.
Approval of the spawn does not approve future edits, commands, browser actions,
MCP calls, Git operations, or worktree mutations.

Limit concurrency through one small configurable local limit. Queue excess
work visibly instead of silently dropping it.

## Worktree Lifecycle

Support:

- list existing repository worktrees;
- create a worktree and branch;
- assign a task/agent to a worktree;
- open or switch the VS Code workspace to a worktree;
- inspect changes and branch state;
- merge only after explicit approval;
- delete only after explicit approval and safety checks.

Before a mutation, show:

- repository root;
- worktree path;
- branch and base branch;
- exact Git operation;
- dirty/untracked state;
- affected task/agent.

Safety rules:

- resolve and validate absolute paths;
- keep managed worktrees under one documented repository-local or user-local
  parent;
- never delete the repository root, current workspace, or an unrecognized
  directory;
- block deletion of dirty worktrees unless the user makes a separate explicit
  decision;
- do not force merge or delete by default;
- do not automatically remove a worktree when an agent fails;
- handle Windows path and file-lock errors explicitly.

Use the existing Git/worktree utilities rather than shell-string construction
inside the UI.

## Local Kanban View

Build Kanban as a VS Code webview backed by `TeamTask` state.

Columns:

```text
Backlog | Ready | In Progress | Blocked | Review | Done
```

Each card should show:

- title;
- assigned agent;
- run status;
- worktree/branch when present;
- blocker or short result;
- last update time.

Minimum actions:

- create and edit a task;
- assign/unassign an agent;
- move status;
- open the associated chat;
- open the worktree;
- cancel active work;
- inspect the task summary and local diagnostics.

Drag/drop or menu-based status changes update the same persisted record.
Do not infer completion solely from moving a card; agent completion events may
move a card to Review, while the user decides when it is Done.

Use the former `TeamTasks.tsx` source reference recorded in Phase 2 only as a
design reference. Do not restore `apps/cline-hub`.

## Persistence and Synchronization

- Use one retained local team persistence store.
- Scope team/task data to the repository/workspace identity.
- Write atomically.
- Version the schema.
- Preserve unknown safe fields during a migration when practical.
- Broadcast incremental changes to the webview.
- Resolve simultaneous updates using record revision or `updatedAt` checks.
- Mark sessions interrupted after extension shutdown rather than leaving them
  permanently “in progress.”

Do not commit team state to the user's repository unless the user explicitly
chooses a workspace file. Default to VS Code local storage.

## Implementation Order

1. Confirm Phase 9 is committed and the working tree is clean.
2. Inventory and collapse duplicate team/task contracts and stores.
3. Finalize the local `TeamTask` schema and migration.
4. Stabilize parent/child session coordination and cancellation.
5. Enforce inherited Bedrock and approval policies for child agents.
6. Centralize validated worktree operations.
7. Connect task/agent assignments to worktrees.
8. Add incremental team/task RPC events.
9. Build the local Kanban view and navigation actions.
10. Add interruption recovery and concurrency limits.
11. Run focused tests and the manual multi-agent/worktree matrix.
12. Commit Phase 10 independently.

## Minimal Automated Coverage

Keep tests focused:

1. one team lifecycle/persistence test covering spawn, progress, interruption,
   completion, and restart;
2. one worktree safety test covering approved creation and rejection of unsafe
   deletion;
3. one Kanban projection test covering task events, assignment, and status
   changes.

Reuse Phase 5 approval tests and Phase 9 run-lifecycle tests.

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

Use a disposable Git repository:

1. create three local tasks;
2. assign two tasks to separate child agents;
3. approve two worktree creations;
4. verify each agent uses the parent's Bedrock target and its assigned
   worktree;
5. confirm each edit and command still asks for approval;
6. observe queued/running/blocked/review states in Kanban;
7. cancel one child and verify its card becomes interrupted or cancelled;
8. complete one child task and inspect its diff;
9. approve one safe merge;
10. reject deletion of a dirty worktree;
11. restart VS Code and verify board, assignments, and terminal states restore;
12. confirm no hosted service is contacted.

## Done When

- teams and task progress operate entirely locally;
- child agents inherit Bedrock and approval policies without credentials being
  persisted;
- worktree mutations are validated and explicitly approved;
- agents can work in separate worktrees without cross-writing;
- the Kanban view uses the same persisted task state as the coordinator;
- interruption, cancellation, review, and completion are visible;
- state restores after restart;
- no hosted hub or external Kanban package is bundled;
- required commands, focused tests, and manual acceptance pass.

## Commit

Suggested message:

```text
feat: add local teams worktrees and kanban
```

The completion handoff should report:

- commit SHA;
- final team/task schema and persistence location;
- child-agent inheritance and concurrency behavior;
- worktree safety boundary;
- Kanban implementation location;
- restart/interruption result;
- multi-agent acceptance result;
- required command and VSIX path.
