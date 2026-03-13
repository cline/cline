# Technique Plan: Controller Full-State Coalescing

This document is the implementation plan for the **controller full-state coalescing** technique identified in `docs/remote-workspace-latency-branch-analysis-report.md` as one of the top four highest-impact improvements for remote-workspace UX.

The key idea is:

> **Full state is a snapshot transport, not a token transport.**

When Cline is actively streaming, repeatedly rebuilding and sending large `ExtensionState` snapshots is one of the biggest avoidable costs in remote mode. Even if each snapshot is “not that large,” the repeated serialization, transport, parsing, and frontend reconciliation create visible UI churn.

This technique reduces that cost by coalescing repeated `postStateToWebview()` requests into a scheduler-driven snapshot flow with priorities and remote-aware cadence.

## How To Use This Plan

This plan is for extracting a coherent technique into its **own branch**, while treating `eve_troubleshooting-remote-workspaces` as the **fully developed reference implementation**.

That means the branch work has already been done once. The goal now is not to rediscover the architecture from scratch; it is to produce a smaller, easier-to-review implementation plan that tells a developer exactly how to extract and verify the technique with high confidence.

Be smart about this. Continually compare your work to the reference implementation and actively take implementation details from it when executing each step. The reference branch should be your source of truth for subtle behaviors, edge-case handling, and interactions with the rest of the product surface.

## Developer Operating Posture

This technique sits at the boundary between extension-host state management and frontend hydration. That makes it highly leveraged and easy to get wrong in ways that only show up under load or during cross-surface interactions.

While implementing:

- keep snapshot semantics explicit,
- preserve immediate behavior where product correctness or UX requires it,
- and use the reference implementation to understand which callsites were intentionally allowed to coalesce.

The governing principle remains:

> **Stop treating every streamed chunk as a durable, full-state, immediately-presented event.**

For this technique, the emphasis is on the **full-state** part.

## Document Type, Audience, and Quality Bar

This is an **extraction implementation plan** written for a **Staff+ level distributed systems / infrastructure engineer**. Its purpose is to turn an already-integrated optimization into a smaller, understandable, safe-to-review change set.

The quality bar is:

- state-posting behavior must remain easy to reason about,
- the extracted scheduler must preserve correctness across non-streaming product surfaces,
- and the doc must make explicit where coalescing is appropriate versus dangerous.

## Artifact Stack and Dependency Position

This doc should be used in the following sequence:

1. read the branch analysis report for prioritization context,
2. inspect `eve_troubleshooting-remote-workspaces` for the integrated implementation,
3. use this plan to extract a smaller, coherent PR with clear verification boundaries.

This sequence reduces rework and helps ensure the extraction remains anchored to the actual behavior we already know works.

## Minimal Coherent Extraction Boundary

The smallest coherent PR for this technique should usually include:

- controller-level scheduler introduction,
- controller `postStateToWebview()` routing changes,
- build/send/payload instrumentation,
- priority selection defaults,
- and tests covering coalescing plus immediate bypass.

What should **not** be split away if avoidable:

- scheduler extraction from controller integration,
- payload/build/send instrumentation from the coalescing work,
- default-priority logic from the scheduler rollout,
- and product-surface regression coverage for init/cancel/auth/task switching.

## Common Failure Modes While Extracting

Watch for these failure modes explicitly:

- coalescing the scheduler mechanically without auditing callsite urgency,
- reducing full-state post count while accidentally delaying critical UI transitions,
- proving frequency reduction without measuring payload size or send/build time,
- treating streaming and non-streaming surfaces the same,
- and forgetting that snapshot bugs often manifest as broad UI inconsistency rather than narrow chat glitches.

---

## Why This Technique Matters

In remote workspaces, a full-state update can imply all of the following:

- gather current extension state,
- build `ExtensionState`,
- JSON serialize it,
- transport it from extension host to webview boundary,
- parse it on the receiving side,
- merge it into frontend state,
- trigger React render work.

That is acceptable for:

- initialization,
- task switches,
- mode changes,
- recovery/resync.

It is **not** acceptable as the default transport for high-frequency streaming churn.

---

## Success Criteria

- Repeated `postStateToWebview()` calls during active streaming are coalesced.
- Immediate flushes are still available where correctness or UX requires them.
- State payload size and posting frequency are instrumented.
- Streaming tasks generate significantly fewer full-state pushes.
- No regressions appear in task switching, auth changes, cancellation, or other non-streaming product surfaces.

---

## Files Most Likely to Change

- `src/core/controller/StateUpdateScheduler.ts`
- `src/core/controller/index.ts`
- `src/core/controller/state/subscribeToState.ts`
- `src/core/controller/postStateToWebview.test.ts`
- `src/core/controller/StateUpdateScheduler.test.ts`
- `src/core/task/index.ts` for request metrics hookup

---

## Step-by-Step Implementation Plan

## Step 1 — Define snapshot posting priorities and rules

### Goal

Make it explicit which state posts must remain immediate and which can be coalesced.

### Mental model

If every caller thinks its update is urgent, the scheduler will collapse back into immediate mode and lose its value. We need a principled split between:

- **must be immediate**,
- **safe to coalesce**,
- **background/low priority**.

### Work

- [ ] Define `immediate`, `normal`, and `low` state update priorities.
- [ ] Audit core state-posting callsites.
- [ ] Document which flows must bypass coalescing.

### Detailed code changes

- In `src/core/controller/index.ts`, document priority expectations near `postStateToWebview(...)`.
- Categorize at least these as typically immediate:
  - [ ] task initialization,
  - [ ] explicit task clear/switch,
  - [ ] auth/login/logout state changes,
  - [ ] mode switch.
- Categorize these as usually coalescible during streaming:
  - [ ] usage/cost updates,
  - [ ] background command state churn,
  - [ ] focus-chain intermediate changes,
  - [ ] repeated chat-state updates caused by streaming partials.

Use the reference implementation branch to validate these classifications before finalizing them in your extraction. The point is not to make an abstract list; it is to preserve the already-learned boundary between “must feel instant” and “safe to batch.”

### Tests

- [ ] No behavior test required yet beyond upcoming scheduler tests.

---

## Step 2 — Build the controller-level state update scheduler

### Goal

Create a scheduler that coalesces repeated full-state posting requests while preserving immediate flush semantics.

### Mental model

This scheduler is conceptually parallel to the presentation scheduler, but it controls **snapshot delivery**, not message presentation. The implementation must handle:

- pending work,
- in-progress flushes,
- higher-priority upgrades,
- rerun-on-dirty behavior.

### Work

- [ ] Implement `StateUpdateScheduler` with request/flush/dispose behavior.
- [ ] Support priority merging.
- [ ] Avoid overlapping snapshot flushes.
- [ ] Re-run once if additional work arrives during flush.

### Detailed code changes

- In `src/core/controller/StateUpdateScheduler.ts`:
  - [ ] track `scheduledTimer`, `pendingPriority`, `flushInProgress`, `pendingWhileFlushing`, and `disposed`.
  - [ ] support `requestFlush(priority)`.
  - [ ] support `flushNow()`.
  - [ ] support `dispose()`.
  - [ ] ensure `immediate` preempts a pending delayed timer.

Be smart about the scheduler design here. A controller-level scheduler can look mechanically similar to the presentation scheduler, but the failure mode is different: a presentation bug is usually visible in one message stream, while a snapshot bug can destabilize the whole UI state model.

### Tests

- [ ] Unit test: repeated normal-priority calls inside cadence window produce one flush.
- [ ] Unit test: immediate-priority request bypasses delay.
- [ ] Unit test: updates arriving while flush is running trigger exactly one follow-up flush.
- [ ] Unit test: dispose clears scheduled work.

---

## Step 3 — Route `postStateToWebview()` through the scheduler

### Goal

Make the scheduler the default behavior for full-state posting without breaking existing callers.

### Mental model

The API should remain convenient for the rest of the codebase. Most callers should still say “post state,” but the controller decides whether that means immediate flush or scheduled coalescing.

### Work

- [ ] Add optional priority parameter to `postStateToWebview(...)`.
- [ ] Determine the default priority based on whether the task is actively streaming.
- [ ] Preserve an explicit immediate path.

### Detailed code changes

- In `src/core/controller/index.ts`:
  - [ ] instantiate `StateUpdateScheduler` in the constructor.
  - [ ] change `postStateToWebview(options?)` so it:
    - [ ] flushes immediately for `priority: "immediate"`,
    - [ ] otherwise requests scheduled flush.
  - [ ] add `getDefaultStateUpdatePriority()` that returns `normal` while streaming and `immediate` when idle/non-task.

When extracting this step, prefer preserving the reference implementation’s method boundaries and control flow. That will make later comparison and debugging much smoother.

### Tests

- [ ] Unit test: no-task / idle state posts remain immediate by default.
- [ ] Unit test: active-streaming posts default to coalesced priority.

---

## Step 4 — Instrument full-state payload size, build time, and send time

### Goal

Quantify the actual cost of snapshot posting and verify coalescing reduces it.

### Mental model

Snapshot frequency alone is not enough. One giant expensive snapshot can be worse than several small ones. We want to measure:

- how often full-state posts happen,
- how large they are,
- how long they take to build,
- how long they take to send.

### Work

- [ ] Measure `getStateToPostToWebview()` build time.
- [ ] Measure serialized payload size.
- [ ] Measure send time.
- [ ] Feed these metrics into per-request latency telemetry.

### Detailed code changes

- In `src/core/controller/index.ts`:
  - [ ] add `flushStateToWebview()` that records build duration and delivery stats.
  - [ ] call `task?.noteStateUpdateMetrics(...)` with build duration, payload bytes, and send duration.
- In `src/core/controller/state/subscribeToState.ts`:
  - [ ] ensure payload byte counting remains available and accurate.

This step is not just observability polish. It is what lets the team prove that the extracted technique is actually reducing snapshot churn rather than merely moving it around.

### Tests

- [ ] Unit test: state update metrics are recorded when a flush occurs.
- [ ] Unit test: payload byte accounting is invoked.

---

## Step 5 — Audit and tune state-posting callsites

### Goal

Ensure callsites use the right priority and are not silently undermining the scheduler.

### Mental model

The scheduler provides the mechanism; callsite audit provides the correctness. Without the audit, some codepaths will still over-post or misuse immediacy.

### Work

- [ ] Review all major `postStateToWebview()` callsites.
- [ ] Keep task initialization and state transitions immediate where appropriate.
- [ ] Allow hot streaming churn to use normal or low priority.

### Detailed code changes

- In controller and task flows, inspect callsites involving:
  - [ ] task init / resume,
  - [ ] cancel / clear,
  - [ ] auth state changes,
  - [ ] usage updates,
  - [ ] focus-chain metadata,
  - [ ] background command metadata,
  - [ ] periodic stream-related updates.
- Where needed, pass explicit priority rather than relying only on defaults.

The smart move here is to audit callsites with the reference implementation open, because the coalescing behavior only makes sense in context. The subtle value of the reference branch is that it already captures where the team discovered hidden urgency requirements.

### Tests

- [ ] Regression test: task init still hydrates the UI immediately.
- [ ] Regression test: cancel/clear still updates UI promptly.
- [ ] Regression test: auth/settings flows are not delayed in a user-visible bad way.

---

## Step 6 — Validate behavior during high-churn scenarios, especially large-file writes

### Goal

Verify that the feature materially helps the scenarios that produce the most snapshot churn.

### Mental model

Large-file writes often produce:

- repeated tool/progress updates,
- repeated request metadata changes,
- repeated message-state changes,
- possible repeated snapshot posts.

This technique should reduce the transport overhead from that churn even if the write tool itself remains functionally the same.

That is the key link to the large-file-write scenario: even when the tool work is mostly backend-side, the surrounding UI state churn can still create a slow, noisy experience if snapshots are over-posted.

### Work

- [ ] Add or extend validation scenarios for high-churn task execution.
- [ ] Compare full-state update count enabled vs disabled.
- [ ] Compare payload-byte totals enabled vs disabled.

### Tests

- [ ] Validation harness scenario: coalescing reduces full-state count in long-running tasks.
- [ ] Validation harness scenario: remote mode benefits more than local mode.
- [ ] Regression test: final state still fully converges after coalesced posting.

---

## Step 7 — Add remote-aware cadence and tuning controls

### Goal

Choose defaults that are appropriate for remote environments and safe to tune during rollout.

### Mental model

Remote mode should intentionally trade a little more coalescing for much less transport thrash. That should be tunable, not hard-coded forever.

### Work

- [ ] Centralize cadence defaults in `latency.ts`.
- [ ] Expose env var overrides for local and remote state cadence.
- [ ] Document these in `.env.example`.

### Detailed code changes

- In `src/core/task/latency.ts`:
  - [ ] add/preserve `getStateUpdateCadenceMs(isRemoteWorkspace, priority)`.
- In `.env.example`:
  - [ ] document state update cadence overrides.

Keep the tuning hooks aligned with the reference implementation so extracted behavior can be compared apples-to-apples during rollout and validation.

### Tests

- [ ] Unit test: remote defaults are more conservative than local defaults.
- [ ] Unit test: env override behavior works as expected.

---

## Step 8 — Verify product-surface safety outside the streaming path

### Goal

Make sure coalescing full-state snapshots does not degrade other product surfaces.

### Mental model

The branch goal is not just “remote chat feels better.” It is “remote workspaces improve without harming the rest of Cline.” State posting is used by many surfaces, so safety checks matter.

### Work

- [ ] Test history/task switching behavior.
- [ ] Test settings/auth-related UI updates.
- [ ] Test onboarding / welcome state hydration.
- [ ] Test focus-chain/background-command metadata behavior.

### Tests

- [ ] Regression test: state hydration on startup remains correct.
- [ ] Regression test: switching tasks shows the correct snapshot.
- [ ] Regression test: metadata deltas + snapshot flow do not leave stale UI after task switch.

---

## Developer Checklist Summary

- [ ] Define snapshot posting priorities
- [ ] Build controller-level scheduler
- [ ] Route `postStateToWebview()` through scheduler
- [ ] Instrument build/send/payload metrics
- [ ] Audit state-posting callsites
- [ ] Validate high-churn and large-file-write scenarios
- [ ] Add remote-aware cadence tuning
- [ ] Verify non-streaming product-surface safety

---

## Final Mental Model Recap

- **Full state is for hydration and synchronization.**
- **It is too expensive to be the main streaming transport in remote mode.**
- **Coalescing snapshots preserves correctness while reducing transport thrash.**

That is the idea developers should keep front-of-mind while implementing this technique.