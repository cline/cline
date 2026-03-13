# Technique Plan: Task UI Delta Sync for Active Task Execution

This document is the implementation plan for the **task UI delta sync** technique identified in `docs/remote-workspace-latency-branch-analysis-report.md` as the fourth most impactful technique in the branch and the strongest long-term transport architecture improvement.

The key idea is:

> **During active task execution, send targeted deltas rather than repeated full snapshots.**

This technique is more invasive than the first three top-ranked improvements, but it is strategically important because it moves the system toward a better model for remote workspaces: full-state snapshots for hydration and recovery, targeted deltas for live execution.

## How To Use This Plan

This plan should be executed on a dedicated extraction branch, while `eve_troubleshooting-remote-workspaces` is treated as the **fully developed reference implementation**.

That distinction matters. This technique is not a hypothetical architecture proposal; it is a plan for extracting and verifying a technique that already exists in integrated form in the reference branch. Developers working this plan should actively inspect the reference implementation for each step and pull implementation details from it deliberately.

Be smart about this. Because delta sync spans backend mutation publishing, transport contracts, and frontend application logic, the fastest way to make the development process stronger and smoother is to let the reference branch answer the “how did we already solve this edge case?” question early, rather than rediscovering it late.

## Developer Operating Posture

This is the most architecturally ambitious of the top four techniques. It changes how the system thinks about live task transport. That means the correct mindset is not “build a clever delta layer,” but:

- preserve snapshots as canonical hydration and recovery,
- shrink active-execution transport to the minimum necessary changes,
- and fall back to resync aggressively when invariants are violated.

The cross-cutting project wisdom still applies here:

> **Stop treating every streamed chunk as a durable, full-state, immediately-presented event.**

For this technique, the emphasis is on moving active execution away from **full-state** and toward **targeted transport**.

## Document Type, Audience, and Quality Bar

This is an **extraction implementation plan** for a **Staff+ level distributed systems / infrastructure engineer**. It assumes the reader is capable of reasoning about transport contracts, ordering invariants, state hydration, and recovery semantics.

The quality bar is especially high here because this technique crosses backend, transport, and frontend boundaries. The plan must therefore make it easy to answer:

- what the transport contract is,
- what invariants must hold,
- what recovery behavior is expected,
- and how the extracted version will be validated against the reference implementation.

## Artifact Stack and Dependency Position

This doc should be read as part of the following artifact sequence:

1. `docs/remote-workspace-latency-branch-analysis-report.md` explains why delta sync is strategically valuable but later in the extraction order.
2. `eve_troubleshooting-remote-workspaces` shows the integrated end state and should be consulted constantly.
3. This document defines the extraction steps, invariants, and test strategy for a smaller implementation branch.

Because this technique is more coupled than the other top-four techniques, keeping that sequence explicit will make development much smoother.

## Minimal Coherent Extraction Boundary

The smallest coherent PR for this technique should usually include:

- shared delta type definitions,
- backend publish/subscribe infrastructure,
- message-state delta emission,
- frontend delta application with sequencing and resync,
- and tests covering ordering, divergence, and recovery.

What should **not** be split away if avoidable:

- sequence validation from delta application,
- resync path from initial delta rollout,
- backend emission from frontend application if the goal is an end-to-end usable slice,
- and the fallback snapshot path that preserves product correctness.

## Common Failure Modes While Extracting

Watch for these failure modes explicitly:

- treating deltas as a replacement for snapshots rather than a companion to them,
- making the reducer permissive instead of sequence-strict,
- emitting deltas from the wrong abstraction boundary,
- forgetting task-identity filtering and task-switch behavior,
- and validating only happy-path ordered deltas without aggressive resync/fallback testing.

---

## Why This Technique Matters

Even after presentation scheduling, deferred persistence, and state coalescing, active execution can still generate meaningful transport churn. Full snapshots are fundamentally a coarse-grained mechanism. They resend lots of state that did not change.

In remote mode, that means unnecessary work across the whole pipeline:

- backend snapshot construction,
- serialization,
- remote transport,
- frontend parsing,
- broad state replacement / render churn.

Delta sync fixes the shape of the transport itself by sending only the state mutations that matter:

- message added,
- message updated,
- message deleted,
- task metadata updated,
- explicit resync signal.

---

## Success Criteria

- Active task execution can advance the webview primarily through task UI deltas.
- Full-state snapshots remain the canonical initialization and recovery path.
- Delta application is sequence-safe and can resync on gap or divergence.
- Backend message mutations publish minimal targeted deltas.
- Frontend applies deltas with minimal state churn.
- Task switches and stale deltas do not corrupt the UI.

---

## Files Most Likely to Change

- `src/shared/TaskUiDelta.ts`
- `src/core/controller/ui/subscribeToTaskUiDeltas.ts`
- `src/core/task/message-state.ts`
- `src/core/controller/index.ts`
- `webview-ui/src/context/ExtensionStateContext.tsx`
- `webview-ui/src/context/taskUiDeltaState.ts`
- `webview-ui/src/context/taskUiDebugCounters.ts`
- related tests in backend and webview

---

## Step-by-Step Implementation Plan

## Step 1 — Define the delta model and sequencing contract

### Goal

Create a small, explicit, versionable transport contract for active task execution changes.

### Mental model

Delta systems fail when they are “implicit.” They need an explicit contract for:

- what changed,
- which task it belongs to,
- in what order it must be applied,
- what to do if order is broken.

### Work

- [ ] Define delta event types.
- [ ] Ensure every delta contains `taskId` and `sequence`.
- [ ] Define resync behavior on missing/stale sequence.

### Detailed code changes

- In `src/shared/TaskUiDelta.ts`:
  - [ ] define or refine delta union including:
    - [ ] `message_added`
    - [ ] `message_updated`
    - [ ] `message_deleted`
    - [ ] `task_metadata_updated`
    - [ ] `task_state_resynced`
  - [ ] document the sequencing contract in comments.
- Decide that:
  - [ ] deltas are only valid for the current task,
  - [ ] sequence must increment monotonically by 1,
  - [ ] a gap triggers full resync.

Do not improvise this contract from memory. Read the reference implementation branch carefully and preserve the exact mental model it uses for sequence monotonicity and recovery semantics.

### Tests

- [ ] Unit test: type helpers or guards behave correctly.
- [ ] Unit test: sequence mismatch triggers resync result.

---

## Step 2 — Build backend delta publishing infrastructure

### Goal

Provide a transport channel for task UI deltas parallel to existing state and partial-message subscriptions.

### Mental model

Full-state snapshots and deltas should coexist, not replace each other outright. The backend must be able to publish deltas cheaply while retaining the existing snapshot transport as a recovery path.

### Work

- [ ] Add subscription/publisher mechanism for task UI deltas.
- [ ] Ensure it is failure-safe and non-blocking.
- [ ] Keep transport format minimal, ideally serialized delta JSON.

### Detailed code changes

- In `src/core/controller/ui/subscribeToTaskUiDeltas.ts`:
  - [ ] implement backend subscription registry / broadcaster.
  - [ ] add `sendTaskUiDelta(...)` helper.
  - [ ] record payload-size metrics if useful.
- If protobuf transport needs changes:
  - [ ] ensure message contract is appropriately wired through `proto/cline/ui.proto` or equivalent.

This is a good example of where “be smart about this” matters. The developer should not just make the channel exist; they should make it easy to reason about, easy to debug, and obviously subordinate to the canonical snapshot path.

### Tests

- [ ] Unit test: subscribers receive published deltas.
- [ ] Unit test: publisher handles no-subscriber case safely.
- [ ] Unit test: serialized payload shape is stable.

---

## Step 3 — Publish deltas from message-state mutations

### Goal

Make the message-state layer emit task UI deltas whenever live task messages mutate.

### Mental model

The message-state layer is the natural source of truth for chat mutation events. If deltas are emitted here, the system stays aligned with actual message semantics rather than ad hoc UI-side guesses.

### Work

- [ ] Emit `message_added` on add.
- [ ] Emit `message_updated` on update.
- [ ] Emit `message_deleted` on delete.
- [ ] Emit `task_state_resynced` on full replacement/set flows.
- [ ] Increment a per-task delta sequence on each publish.

### Detailed code changes

- In `src/core/task/message-state.ts`:
  - [ ] wire `emitClineMessagesChanged(...)` to publish deltas when delta sync is enabled.
  - [ ] use `taskState.taskUiDeltaSequence` as the monotonic sequence source.
  - [ ] send minimal payloads for each mutation type.
- Ensure ephemeral and durable mutations both publish the same deltas so live UI behavior does not depend on durability choice.

This step should be executed with the reference implementation branch open beside the extraction branch. The key engineering task is not simply “emit deltas,” but “emit deltas from the true state mutation boundary without creating semantic skew between durable and ephemeral paths.”

### Tests

- [ ] Unit test: add publishes `message_added` with correct sequence.
- [ ] Unit test: update publishes `message_updated` with correct sequence.
- [ ] Unit test: delete publishes `message_deleted` with correct sequence.
- [ ] Unit test: set/overwrite publishes `task_state_resynced`.

---

## Step 4 — Publish task metadata deltas outside message-state mutations

### Goal

Handle non-message hot-path changes, such as focus-chain and background-command metadata, without relying on full snapshots.

### Mental model

Some of the most annoying snapshot churn comes from small metadata updates that are orthogonal to the message list. These deserve their own lightweight path.

### Work

- [ ] Add controller helper for metadata delta publication.
- [ ] Route focus-chain and background-command metadata through it.
- [ ] Fall back to snapshot posting when no current task or invalid task context exists.

### Detailed code changes

- In `src/core/controller/index.ts`:
  - [ ] add or refine `postTaskMetadataDelta(...)`.
  - [ ] only publish deltas when target task matches current active task.
  - [ ] otherwise request a normal full-state post as fallback.

Keep the fallback path boring and reliable. Smart engineering here means preferring explicit fallback to snapshot sync over any attempt to get fancy when task identity or activity context is ambiguous.

### Tests

- [ ] Unit test: metadata delta publishes for current active task.
- [ ] Unit test: mismatched/non-active task falls back to snapshot path.

---

## Step 5 — Implement frontend delta application and ordering safety

### Goal

Make the webview able to apply deltas incrementally while detecting sequence gaps and requesting resync.

### Mental model

Frontend delta handling must be strict, not permissive. If it misses a sequence or applies a delta for the wrong task, stale UI bugs will appear and be hard to debug.

### Work

- [ ] Track latest applied sequence in the frontend.
- [ ] Ignore deltas for non-current tasks.
- [ ] Trigger resync on sequence mismatch.
- [ ] Apply message add/update/delete with minimal array churn.

### Detailed code changes

- In `webview-ui/src/context/taskUiDeltaState.ts`:
  - [ ] validate `delta.sequence === latestSequence + 1`.
  - [ ] return `resync` on mismatch.
  - [ ] ignore deltas for non-current tasks while still advancing sequence semantics intentionally if that is the chosen policy.
  - [ ] apply message mutations minimally.
- In `webview-ui/src/context/ExtensionStateContext.tsx`:
  - [ ] subscribe to delta stream,
  - [ ] feed deltas into reducer/helper,
  - [ ] trigger full-state resync when helper returns `resync`.

The frontend side should be implemented with a bias toward correctness and repairability. If you find yourself making the delta reducer permissive to “keep things working,” stop and compare with the reference implementation. The right answer is usually stricter sequencing plus easier resync.

### Tests

- [ ] Webview test: ordered deltas produce correct final state.
- [ ] Webview test: sequence gap triggers resync path.
- [ ] Webview test: stale/non-current-task delta is ignored safely.

---

## Step 6 — Keep full-state snapshots as canonical hydration and recovery path

### Goal

Ensure deltas complement snapshots rather than replacing them unsafely.

### Mental model

Snapshots are still the canonical state source for:

- initial load,
- task switch,
- reconnect/reopen,
- recovery after divergence.

Deltas should advance current state, not become the sole source of truth.

### Work

- [ ] Preserve `subscribeToState` as initialization path.
- [ ] Reset delta sequence on full snapshot hydration.
- [ ] Trigger snapshot fetch on divergence.

### Detailed code changes

- In `ExtensionStateContext.tsx`:
  - [ ] after receiving a fresh full snapshot, reset latest delta sequence tracking.
  - [ ] on resync request, fetch latest state and replace current state.
- Ensure startup / reload still works even if no deltas arrive.

This step is essential to keeping the rest of Cline’s product surfaces healthy. Delta sync should improve active execution, not quietly turn startup, reopen, or task switching into undefined behavior.

### Tests

- [ ] Regression test: initial load hydrates correctly without prior deltas.
- [ ] Regression test: reopening or task switching still works.
- [ ] Regression test: full snapshot repairs intentionally diverged delta state.

---

## Step 7 — Minimize frontend churn when applying deltas

### Goal

Capture the benefit of deltas by applying them with minimal structural churn in React state.

### Mental model

A delta transport is less valuable if the frontend responds by rebuilding large portions of state anyway. The frontend should patch the smallest possible region.

### Work

- [ ] Update only the changed message when possible.
- [ ] Avoid replacing `clineMessages` unless necessary.
- [ ] Keep metadata updates narrow.

### Detailed code changes

- In `webview-ui/src/context/taskUiDeltaState.ts`:
  - [ ] add/update should preserve array identity only where safe and replace minimal slices.
  - [ ] delete should only filter when message exists.
  - [ ] metadata updates should shallow-merge only changed fields.

Be smart about this at the React-state level too: if the frontend re-renders large portions of the tree on every delta, then the transport win will be partially squandered.

### Tests

- [ ] Webview test: unchanged update payload does not cause unnecessary state replacement.
- [ ] Webview test: active message row updates correctly under repeated deltas.

---

## Step 8 — Instrument, debug, and validate remote-mode benefit

### Goal

Make the delta system observable and prove it reduces snapshot dependence during active execution.

### Mental model

Delta systems are harder to reason about than snapshots, so they need better visibility. Developers should be able to see:

- how many deltas were applied,
- how many full states were still applied,
- how often resync happened.

### Work

- [ ] Add debug counters for full-state applications, partial-message applications, delta applications, and resync requests.
- [ ] Compare default mode vs delta-disabled mode in validation harness.
- [ ] Ensure feature flag exists for safe staged rollout.

### Detailed code changes

- In `webview-ui/src/context/taskUiDebugCounters.ts`:
  - [ ] add counters for delta application and resync requests.
- In `.env.example` / `latency.ts`:
  - [ ] preserve `CLINE_DISABLE_TASK_UI_DELTA_SYNC` or equivalent.
- In validation tooling:
  - [ ] compare `stateUpdateCount`, `taskDeltaCount`, and payload bytes across variants.

Since the reference implementation already exists, one of the strongest ways to smooth development is to validate the extracted technique against both disabled-mode behavior and the known-good reference branch behavior.

### Tests

- [ ] Validation harness scenario: delta-enabled mode reduces full-state payload bytes during active execution.
- [ ] Validation harness scenario: delta-disabled variant falls back cleanly to snapshot behavior.
- [ ] Unit test: debug counters increment correctly where applicable.

---

## Step 9 — Validate the technique in large-file-write and long-running task scenarios

### Goal

Confirm that delta sync specifically helps long, noisy task executions, including large-file operations.

### Mental model

Large-file writes are not only about the write tool itself. They often generate a lot of nearby live task activity that becomes expensive when transported as snapshots. Delta sync should reduce that excess movement.

That is why this technique still matters for large-file-write scenarios, even though it is not the first thing to land: it attacks the remaining active-execution transport cost after the first three higher-ROI techniques have already reduced hot-path churn.

### Work

- [ ] Add scenario coverage for long active execution with many message mutations.
- [ ] Compare delta-enabled vs delta-disabled behavior.
- [ ] Verify convergence at the end of execution.

### Tests

- [ ] Integration/validation scenario: long-running execution with many message updates works correctly under delta sync.
- [ ] Regression test: final UI state matches snapshot-based state.
- [ ] Regression test: no stale message duplication or ordering bug appears after many updates.

---

## Developer Checklist Summary

- [ ] Define delta model and sequencing contract
- [ ] Build backend delta subscription/publishing infrastructure
- [ ] Publish deltas from message-state mutations
- [ ] Publish metadata deltas for non-message hot paths
- [ ] Implement frontend delta application with strict ordering safety
- [ ] Preserve full snapshots for hydration and recovery
- [ ] Minimize frontend churn during delta application
- [ ] Add observability, flags, and validation coverage
- [ ] Validate large-file / long-running execution scenarios

---

## Final Mental Model Recap

- **Full snapshots establish truth.**
- **Deltas advance truth during active execution.**
- **If ordering breaks, resync instead of guessing.**
- **The point is not cleverness; the point is to avoid shipping unchanged state over and over in remote mode.**

That is the mindset developers should keep while implementing this technique.