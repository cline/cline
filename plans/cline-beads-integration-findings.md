# Cline Beads + DAG Integration Findings (Beadsmith)

Date: 2026-01-28
Scope: Review of plans/* and concrete integration points in this repo

---

## 1) Plain-English summary of what the plans add

The plans describe three big upgrades to Cline:

1) Beads (Ralph Loop)
   - A "bead" is one small, reviewable chunk of work.
   - The agent does a bead, stops, checks success (tests pass, DONE tag, etc.), then either finishes or starts the next bead.
   - Key idea: each bead is independent and has a clear commit + diff + review step.

2) Dependency Graph (DAG) analysis
   - A background engine reads the whole codebase and builds a graph of dependencies (file->file, function->function).
   - The agent uses this graph to avoid breaking hidden dependencies.
   - The UI can show the graph and highlight impact when files change.

3) Bead review UI
   - Before each bead is committed, the user sees:
     - diff
     - impact analysis
     - tests suggested / run results
   - User can approve, reject, or skip the bead.

---

## Implementation Status (Beadsmith)

Legend: [x] done, [~] partial, [ ] not done, [?] not verified

### A) Beads / Ralph Loop (core behavior change)
- [x] A1 Add a Bead data model (see `src/shared/beads.ts`)
- [~] A2 Extend TaskState to track bead state (not in `src/core/task/TaskState.ts`; tracked via BeadManager + ExtensionState)
- [x] A3 Add a RalphLoopController / BeadManager (see `src/core/ralph/*`, `src/core/beads/*`)
- [x] A4 Bead approval flow + ask/say types + UI (see `src/shared/ExtensionMessage.ts`, `webview-ui/src/components/chat/BeadMessage.tsx`)
- [x] A5 Success criteria evaluation (see `src/core/beads/BeadManager.ts`, `src/core/beads/SuccessCriteriaEvaluator.ts`)
- [x] A6 Persist bead history (see `src/core/beads/BeadStorage.ts`, `src/core/controller/bead/getBeadHistory.ts`)

### B) DAG analysis engine (background service)
- [x] B1 Add DAG microservice (see `dag-engine/`)
- [x] B2 Manage service lifecycle (see `src/core/controller/index.ts`)
- [~] B3 Add DAG state and caching (Python cache exists; no TS DagStore/persistence)
- [ ] B4 Respect ignore rules (.beadsmithignore/.gitignore not wired into DAG analysis)
- [~] B5 File watchers for incremental analysis (watcher exists; not wired)

### C) DAG UI integration
- [~] C1 DAG state to ExtensionState (fields exist; not populated from DAG service)
- [x] C2 gRPC service for DAG queries (see `proto/beadsmith/dag.proto`, `src/core/controller/dag/*`)
- [~] C3 DAG panel UI (components exist; not wired into main UI)

### D) Prompt + context injection
- [~] DAG prompt section exists, but dagImpact selection/injection is not wired

### E) Bead review UI + diff
- [~] Review UI exists; diff view not wired into bead review

### F) Git commits per bead
- [ ] Not implemented (commitHash tracked but no commit step)

### G) Settings additions (end-to-end)
- [~] Settings keys exist; UI only exposes some (beadsEnabled/dagEnabled)

### H) gRPC + proto regeneration
- [x] Protos generated for bead/dag/state

### I) Tests
- [~] DAG parser tests exist; bead manager/DAG bridge/UI tests missing

---

## 2) What Cline already has (relevant pieces)

These parts already exist and are the natural hook points:

- Task runtime
  - `src/core/controller/index.ts` creates and manages a `Task`.
  - `src/core/task/index.ts` runs the loop that streams model output and executes tools.
  - `src/core/task/TaskState.ts` holds per-task state.

- Message + history tracking
  - `src/core/task/message-state.ts` saves UI messages and task history.
  - `src/shared/ExtensionMessage.ts` defines message types (`ClineAsk`, `ClineSay`).
  - `src/shared/HistoryItem.ts` is the task history summary.

- Checkpoints (already git-based)
  - `src/integrations/checkpoints/*` uses a shadow git repo to snapshot state and show diffs.

- Webview UI
  - `webview-ui/src` renders the chat UI and task header.
  - gRPC messages are generated from `proto/cline/*.proto` (not checked in).
  - UI state is fed from `ExtensionState` in `src/shared/ExtensionMessage.ts`.

- Settings + state storage
  - `src/shared/storage/state-keys.ts` is the single source of truth for settings/state.
  - Adding fields here regenerates `proto/cline/state.proto` via script.

These are the places the bead + DAG features must plug into.

---

## 3) Exact changes needed (by capability)

### A) Beads / Ralph Loop (core behavior change)

Goal: split one long task into small beads with clear pass/fail and approval.

#### A1) Add a Bead data model
Add a new concept so Cline can track beads as first-class objects.

New types to add (example shape):
- `Bead`
  - id
  - taskId
  - beadNumber
  - status: running | awaiting_approval | approved | rejected | skipped
  - startTs / endTs
  - filesChanged[]
  - diff
  - impactSummary
  - testsRun[] / testsPassed
  - commitHash (optional)

Where to put it:
- New file: `src/shared/beads.ts` (type definitions shared by extension + webview).
- Update `src/shared/HistoryItem.ts` to include bead count or last bead summary.
- Update `src/shared/ExtensionMessage.ts` to include bead info in `ExtensionState`.

#### A2) Extend TaskState to track bead state
`src/core/task/TaskState.ts` should include:
- currentBeadId
- beadNumber
- beadStatus
- beadIterationCount
- successCriteria
- tokenBudgetRemaining
- lastBeadSummary

Why: the Task needs to know where it is in the bead cycle at all times.

#### A3) Add a RalphLoopController (or BeadManager)
Cline currently runs a single continuous task loop. You need a higher-level loop that:
- starts a bead
- runs the agent
- stops at bead boundary
- checks success criteria
- decides whether to start a new bead

Where to add:
- New folder: `src/core/beads/`
  - `BeadManager.ts` (or `RalphLoopController.ts`)
  - `SuccessCriteria.ts`
  - `BeadStorage.ts`

Integration points:
- `src/core/controller/index.ts` should create and own the bead manager.
- `src/core/task/index.ts` needs a clean stop point after each bead.

#### A4) Add bead approval flow
Cline already uses `ask` messages to get user approval for tools. Add a new ask type for beads.

Changes:
- `src/shared/ExtensionMessage.ts`
  - Add new `ClineAsk` type: `bead_review`
  - Add new `ClineSay` types: `bead_started`, `bead_completed`, `bead_failed`

- `src/core/task/index.ts`
  - After a bead is done, call `ask('bead_review', ...)` before committing.

- `webview-ui/src/components/chat`
  - Add UI rendering for bead ask response.
  - Add buttons: approve, reject, skip.

#### A5) Success criteria evaluation
Success criteria are new logic (tests pass, DONE tag, etc.).

Where to implement:
- New file: `src/core/beads/success-criteria.ts`
- Use existing command runner: `src/integrations/terminal/CommandExecutor.ts`

Examples:
- tests_pass: run configured test command and parse exit code
- done_tag: scan assistant message for DONE

#### A6) Persist bead history
Beads must be saved to disk so they can be shown later.

Where:
- `src/core/storage/disk.ts`
  - Add `beads.json` to `GlobalFileNames`
  - Add read/write helpers for bead history
- `src/core/task/message-state.ts`
  - Update `saveClineMessagesAndUpdateHistory()` to include bead summary in task history if desired.

---

### B) DAG analysis engine (new background service)

Goal: a dependency graph that updates and can answer impact questions.

#### B1) Add a DAG microservice
Plans assume a Python subprocess.

Add:
- New folder: `dag-engine/` (Python package)
- New Node bridge: `src/services/dag/DagBridge.ts`

The bridge should:
- spawn Python (`child_process.spawn`)
- speak JSON-RPC over stdio
- expose methods: analyse_project, analyse_file, get_impact, get_callers, get_callees

#### B2) Manage service lifecycle
Who starts the DAG service?

Recommended:
- Start when a task starts (in `Controller.initTask()`).
- Stop when task ends or extension deactivates.

Where to wire:
- `src/core/controller/index.ts` (create/start/stop)
- `src/extension.ts` (ensure stop on deactivate)

#### B3) Add DAG state and caching
You need to hold the latest graph in memory and optionally persist it.

Where:
- `src/services/dag/DagStore.ts` (in-memory cache)
- `src/core/storage/disk.ts` (optional cached JSON file per task)

#### B4) Respect ignore rules
DAG analysis should ignore files in `.clineignore` or `.gitignore`.

Where to hook:
- Use `src/core/ignore/ClineIgnoreController.ts` to filter file lists before analysis.

#### B5) Add file watchers for incremental analysis
You need to refresh DAG when files change.

Where:
- Use VS Code file watcher in `Controller` or new `DagWatcher` service.
- Hook into `workspace.createFileSystemWatcher` or reuse existing trackers.

---

### C) DAG UI integration (new panel + impact display)

#### C1) Add DAG state to ExtensionState
Add DAG fields to `ExtensionState` so UI can render them.

Where:
- `src/shared/ExtensionMessage.ts`
  - add `dagGraphJson`, `dagSummary`, `dagWarnings`, `dagLastUpdated`
- `src/core/controller/index.ts`
  - include these fields in `getStateToPostToWebview()`

#### C2) Add a new gRPC service for DAG
UI needs to request graph data and impact queries.

Where:
- `proto/cline` (new file `dag.proto` or add to existing)
- `src/core/controller/grpc-handler` (service handlers)
- `webview-ui/src/services/grpc-client.ts` (generated)

Example RPCs:
- `GetProjectGraph`
- `GetImpact`
- `RefreshGraph`

#### C3) Create the DAG panel UI
Add new components:
- `webview-ui/src/components/dag/DagPanel.tsx`
- `webview-ui/src/components/dag/GraphCanvas.tsx`

Integrate into app layout:
- `webview-ui/src/App.tsx`
- Possibly add a sidebar tab or view switcher.

---

### D) Prompt + context injection (agent awareness)

Goal: include DAG context in the model prompt so it can avoid breaking dependencies.

Where to change:
- `src/core/prompts/system-prompt/components` (add new `dag_context.ts` section)
- `src/core/task/index.ts` in `loadContext()` (add DAG-related context blocks)

What to inject:
- impacted files/functions for the current edit
- warning flags for low-confidence edges
- suggested tests

---

### E) Bead review UI + diff

Cline already has diff and checkpoint systems. Reuse them.

Changes:
- Add new view or panel for bead review (diff + impact + approve buttons).
- Reuse existing diff rendering in:
  - `src/integrations/checkpoints/TaskCheckpointManager`
  - `webview-ui/src/components/chat/CompletionOutputRow.tsx` (pattern for "View Changes")

You will likely add:
- `webview-ui/src/components/beads/BeadReviewPanel.tsx`
- `webview-ui/src/components/beads/BeadTimeline.tsx`

And new UI state fields:
- currentBead
- beadHistory

---

### F) Git commits per bead

Cline already uses a shadow git repo for checkpoints. For bead commits you must decide:

Option 1 (simpler): commit beads in the shadow repo
- uses existing checkpoint infrastructure
- safe, non-destructive

Option 2 (user repo): commit beads directly in workspace repo
- riskier, must respect user git config

Required changes either way:
- New service: `src/services/beads/BeadGitService.ts`
- Use existing `CheckpointGitOperations` or new `simple-git` usage
- Store commit hash in bead metadata

---

### G) Settings additions (must be wired end-to-end)

Add new settings in `src/shared/storage/state-keys.ts` and expose in UI.

Suggested settings:
- `dagEnabled`
- `dagPythonPath`
- `dagAutoRefresh`
- `beadsEnabled`
- `beadAutoApprove`
- `beadCommitMode` (shadow vs workspace)
- `beadTestCommand`
- `ralphMaxIterations`
- `ralphTokenBudget`

Then update:
- `proto/cline/state.proto` (generated)
- `webview-ui` settings UI (`FeatureSettingsSection.tsx`)

---

### H) gRPC + proto regeneration (required build step)

This repo uses generated protos.
When you change any of the following, you must re-run codegen:
- `proto/cline/*.proto`
- `src/shared/storage/state-keys.ts`

Outputs to regenerate:
- `src/shared/proto/*` (ignored by git)
- `src/generated/hosts/vscode/protobus-services` (ignored by git)
- `webview-ui/src/services/grpc-client.ts` (ignored by git)

If you skip this, the UI will not compile and requests will fail.

---

### I) Tests to add (minimum)

Backend:
- bead manager unit tests (bead transitions, success criteria, retry)
- DAG bridge tests (mock JSON-RPC process)
- impact analysis correctness (for a small sample project)

UI:
- DAG panel renders with mock graph
- bead review buttons send correct gRPC requests

---

## 4) Concrete file-by-file change list (starting points)

Backend (extension host):
- `src/core/controller/index.ts`
  - create/start/stop DagBridge
  - create BeadManager/RalphLoopController
  - include bead + dag fields in `getStateToPostToWebview()`

- `src/core/task/index.ts`
  - define bead boundaries
  - insert approval step
  - call success criteria checks
  - trigger next bead

- `src/core/task/TaskState.ts`
  - add bead tracking fields

- `src/core/task/message-state.ts`
  - save bead summaries to history

- `src/shared/ExtensionMessage.ts`
  - add ClineAsk/ClineSay bead types
  - extend ExtensionState

- `src/shared/storage/state-keys.ts`
  - add settings toggles

- `src/core/storage/disk.ts`
  - add bead metadata file read/write

DAG services:
- `src/services/dag/DagBridge.ts` (new)
- `src/services/dag/DagStore.ts` (new)
- `src/services/dag/DagWatcher.ts` (new)

Proto:
- `proto/cline/state.proto` (generated from state-keys)
- `proto/cline/task.proto` or new `proto/cline/beads.proto`
- `proto/cline/dag.proto` (new)

Webview UI:
- `webview-ui/src/App.tsx` (add DAG + bead panels)
- `webview-ui/src/context/ExtensionStateContext.tsx` (new state fields)
- `webview-ui/src/components/dag/*` (new)
- `webview-ui/src/components/beads/*` (new)
- `webview-ui/src/components/chat/ChatRow.tsx` (render bead messages)
- `webview-ui/src/components/chat/task-header/TaskHeader.tsx` (show bead status)

---

## 5) Integration order (lowest risk path)

1) Add new types + state fields (bead + dag) with proto regeneration.
2) Add DAG bridge service (start/stop + simple `analyse_project`).
3) Add DAG UI panel that can show static data.
4) Add bead manager (no auto loop yet, just a manual "finish bead" action).
5) Wire bead review + approval flow.
6) Add success criteria checks and auto loop.
7) Add incremental DAG updates + impact highlighting.

---

## 6) The two biggest gotchas

1) Proto regeneration is mandatory.
   - If you add new fields and do not regenerate, the UI and extension will silently break.

2) Beads are not a tiny change.
   - The current Task loop assumes a single continuous conversation.
   - You must either reset context between beads or spawn a fresh Task instance each bead.
   - If you do not break the loop cleanly, the agent will keep running and ignore bead boundaries.

---

## 7) Minimal viable bead implementation (if you want a small first step)

If you only want "beads" without full DAG, do this:

- Add bead metadata + bead review ask type.
- After each `attempt_completion` in `src/core/task/index.ts`, force an approval prompt.
- If approved, create a checkpoint commit and store it as bead.
- If rejected, send feedback and continue the task.

This gives you "beads" quickly without building the DAG engine yet.

---

End of report.
