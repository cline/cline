# Technique Plan: Assistant Presentation Scheduler

This document is the implementation plan for the **assistant presentation scheduler** technique identified in `docs/remote-workspace-latency-branch-analysis-report.md` as one of the highest-ROI improvements for remote-workspace responsiveness.

The central principle is:

> **The provider stream is not the UI clock.**

In other words, the model may emit chunks at machine cadence, but the user only needs the UI to update at a human-friendly cadence. Trying to present every chunk immediately is what turns remote-mode transport, persistence, and rendering overhead into visible jitter.

This plan explains how to introduce a scheduler that coalesces presentation work without compromising semantic immediacy at important boundaries like first token, tool transitions, errors, and final completion.

---

## Why This Technique Matters

The streaming loop is one of the hottest paths in the whole system. If every chunk does all of the following synchronously:

- parse/update assistant content,
- present to the UI,
- possibly trigger follow-on state posting,
- possibly interact with persistence or tool execution,

then the stream becomes paced by downstream work rather than by provider availability.

That problem gets worse in remote workspaces because UI presentation is no longer “just local work.” It often implies transport across host boundaries, local parsing, and frontend reconciliation.

The goal here is not to make the UI less live. The goal is to make it live at the **right cadence**.

---

## Success Criteria

- Normal text/reasoning/tool-progress chunk presentation is coalesced behind a scheduler.
- The streaming loop no longer awaits presentation on every chunk.
- Important semantic boundaries still flush immediately.
- Remote workspaces use more conservative cadences than local workspaces.
- Final drain behavior guarantees that no residual content is left unpresented.

---

## Files Most Likely to Change

- `src/core/task/TaskPresentationScheduler.ts`
- `src/core/task/index.ts`
- `src/core/task/latency.ts`
- `src/core/task/__tests__/TaskPresentationScheduler.test.ts`
- `src/core/task/__tests__/latency.test.ts`

---

## Step-by-Step Implementation Plan

## Step 1 — Define the presentation contract and priorities

### Goal

Establish which kinds of updates can be coalesced and which must feel immediate.

### Mental model

Not all updates are equal.

- A tenth text chunk arriving 20ms after the ninth is not urgent.
- The first visible token is urgent.
- A tool completion or approval transition is urgent.
- Finalization is urgent.

The scheduler works only if priority rules are intentional and documented.

### Work

- [ ] Define presentation priorities such as `immediate`, `normal`, and `low`.
- [ ] Document semantic boundaries that must flush immediately.
- [ ] Document which chunk types default to normal coalescing.

### Detailed code changes

- In `src/core/task/TaskPresentationScheduler.ts`:
  - [ ] expose or preserve a `PresentationPriority` type.
- In `src/core/task/index.ts`:
  - [ ] document priority mapping logic near `getPresentationPriorityForChunk(...)`.
- In comments/docstrings, explicitly call out immediate boundaries:
  - [ ] first visible token,
  - [ ] tool transitions,
  - [ ] finalization,
  - [ ] abort/error cleanup.

### Tests

- [ ] Unit test: priority merge rules behave as expected.

---

## Step 2 — Implement the scheduler primitive

### Goal

Build a reusable scheduler that coalesces repeated requests, avoids overlapping flushes, and supports immediate preemption.

### Mental model

Think of the scheduler as a small state machine:

- a flush may be pending,
- a flush may be running,
- more work may arrive while the flush is running,
- the highest pending priority wins.

The implementation must be robust under bursty chunk arrival, not just simple timer-based debounce logic.

### Work

- [ ] Implement `requestFlush(priority)`.
- [ ] Implement `flushNow()`.
- [ ] Track pending priority, active flush, and pending-while-flushing state.
- [ ] Add disposal semantics so no timers survive task teardown.

### Detailed code changes

- In `src/core/task/TaskPresentationScheduler.ts`:
  - [ ] keep a `scheduledTimer`.
  - [ ] keep `pendingPriority`.
  - [ ] keep `flushInProgress`.
  - [ ] keep `pendingWhileFlushing`.
  - [ ] when `requestFlush(immediate)` arrives, cancel scheduled timer and run now.
  - [ ] when work arrives during flush, mark pending and re-run once afterward.
  - [ ] support `dispose()` to clear timer and suppress future work.

### Tests

- [ ] Unit test: multiple requests inside the cadence window produce one flush.
- [ ] Unit test: immediate priority preempts pending normal work.
- [ ] Unit test: updates arriving during a flush produce exactly one follow-up flush.
- [ ] Unit test: dispose clears timers and suppresses future flushes.

---

## Step 3 — Integrate scheduler into `Task`

### Goal

Make the `Task` use the scheduler as the default path for presentation without breaking existing semantics.

### Mental model

`presentAssistantMessage()` should become the **drain implementation**, not the hot-path public API that every chunk directly awaits.

### Work

- [ ] Add a scheduler field to `Task`.
- [ ] Add a scheduling wrapper such as `scheduleAssistantPresentation(...)`.
- [ ] Refactor direct callers to go through the wrapper except where explicit immediate drain is needed.

### Detailed code changes

- In `src/core/task/index.ts`:
  - [ ] instantiate `TaskPresentationScheduler` in the constructor.
  - [ ] wire `flush: async () => this.flushAssistantPresentation()`.
  - [ ] add `scheduleAssistantPresentation(trigger, priority)`.
  - [ ] keep `flushAssistantPresentation()` as the method that actually calls `presentAssistantMessage()`.

### Tests

- [ ] Unit test: `scheduleAssistantPresentation(...)` increments request metrics correctly.
- [ ] Unit test: scheduling-disabled mode still drains immediately.

---

## Step 4 — Replace direct per-chunk presentation awaits in the streaming loop

### Goal

Remove the default `await presentAssistantMessage()` behavior from the chunk-ingestion hot path.

### Mental model

This is where the real latency win happens. If the chunk loop no longer blocks on presentation for normal chunk traffic, provider ingestion stays fast and the UI drains on its own cadence.

### Work

- [ ] Update text chunk path to schedule presentation instead of awaiting it.
- [ ] Update reasoning chunk path to schedule presentation instead of awaiting it.
- [ ] Update tool-progress/native-tool-call related chunk path similarly.
- [ ] Preserve immediate scheduling for first-token and tool-related semantic transitions.

### Detailed code changes

- In `src/core/task/index.ts`, inside streaming chunk handling:
  - [ ] text chunks should update assistant content and then call `scheduleAssistantPresentation("text", priority)`.
  - [ ] reasoning chunks should call `scheduleAssistantPresentation("reasoning", priority)`.
  - [ ] tool-call chunks should call `scheduleAssistantPresentation("tool", priority)`.
- Ensure priority logic uses whether visible assistant content already exists.

### Tests

- [ ] Integration-style test: many streaming chunks produce fewer presentation invocations than chunk count.
- [ ] Regression test: first visible token still appears promptly.
- [ ] Regression test: tool execution order is preserved under scheduled presentation.

---

## Step 5 — Add remote-aware cadence selection

### Goal

Use different default cadences for local and remote environments.

### Mental model

Remote workspaces need more coalescing because each UI flush is more expensive. The right question is not “what is the minimum possible delay?” but “what cadence is imperceptibly live while materially reducing churn?”

### Work

- [ ] Centralize cadence lookup in `latency.ts`.
- [ ] Keep `immediate` priority at zero-delay.
- [ ] Use more conservative normal/low cadences in remote mode.
- [ ] Allow env-var overrides for tuning.

### Detailed code changes

- In `src/core/task/latency.ts`:
  - [ ] add or preserve `getPresentationCadenceMs(isRemoteWorkspace, priority)`.
  - [ ] keep override env vars for local and remote cadence values.
- In `Task` constructor:
  - [ ] pass cadence callback into scheduler so it adapts automatically once remote detection is known.

### Tests

- [ ] Unit test: remote mode returns higher normal cadence than local mode.
- [ ] Unit test: env var override wins over default values.
- [ ] Unit test: immediate priority always returns zero.

---

## Step 6 — Preserve final-drain semantics

### Goal

Guarantee that all pending content is fully presented before request completion, abort, or disposal.

### Mental model

Schedulers are easy to add and easy to get subtly wrong at teardown. The user must never lose the last bit of visible content because it was still sitting in a pending timer when the request ended.

### Work

- [ ] Force a final synchronous drain when the stream completes.
- [ ] Force final drain on abort/error cleanup where appropriate.
- [ ] Dispose scheduler cleanly during task teardown.

### Detailed code changes

- In `src/core/task/index.ts`:
  - [ ] after the streaming loop has completed and partial blocks are finalized, call `await this.presentationScheduler.flushNow()`.
  - [ ] in abort/finally paths, ensure no pending scheduled flush survives past task shutdown.
- In `TaskPresentationScheduler`:
  - [ ] make `dispose()` clear timers and suppress post-disposal flushes.

### Tests

- [ ] Unit test: final `flushNow()` drains pending coalesced work.
- [ ] Unit test: task disposal suppresses delayed pending flushes.
- [ ] Regression test: final text is visible before next request starts.

---

## Step 7 — Add instrumentation and verify chunk-to-visible behavior

### Goal

Measure the scheduler’s actual effect so cadence tuning is based on data.

### Mental model

Scheduling is always a tradeoff between update frequency and perceived responsiveness. The only good tuning process is to measure:

- how many flushes occur,
- how long flushes take,
- what the chunk-to-visible delay looks like.

### Work

- [ ] Track presentation invocation count.
- [ ] Track total/average presentation duration.
- [ ] Track final chunk-to-webview delay distribution.
- [ ] Emit request-level telemetry summary.

### Detailed code changes

- In `src/core/task/index.ts`:
  - [ ] accumulate presentation metrics in request-scoped latency metrics.
  - [ ] record chunk-to-webview delay when state or partial-message updates occur.
- In telemetry summary helpers:
  - [ ] ensure presentation-related fields are included and comparable.

### Tests

- [ ] Unit test: metrics aggregate correctly under multiple scheduler flushes.
- [ ] Unit test: instrumentation is failure-safe when telemetry is disabled/unavailable.

---

## Step 8 — Validate special high-churn scenarios such as large-file writes

### Goal

Ensure the scheduler meaningfully helps the scenarios users actually notice.

### Mental model

Large-file write scenarios often generate:

- lots of reasoning text,
- tool descriptions/progress,
- potential partial previews,
- repeated task-state churn.

The scheduler should reduce the “chatty” feel without making the operation feel frozen.

### Work

- [ ] Add validation scenario for long streamed response and/or large-file write workflow.
- [ ] Compare presentation flush count with scheduler enabled vs disabled.
- [ ] Confirm first-token latency remains acceptable.

### Tests

- [ ] Validation harness scenario: scheduler-enabled mode produces fewer presentation flushes than chunk count.
- [ ] Comparison run: scheduler-disabled variant shows meaningfully higher presentation activity.

---

## Developer Checklist Summary

- [ ] Define presentation priorities and semantic boundaries
- [ ] Implement the scheduler primitive
- [ ] Integrate scheduler into `Task`
- [ ] Replace direct per-chunk presentation awaits
- [ ] Add remote-aware cadence selection
- [ ] Preserve final-drain semantics
- [ ] Instrument and verify behavior
- [ ] Validate large-file / long-stream scenarios

---

## Final Mental Model Recap

- **Streams run at machine speed.**
- **People read at human speed.**
- **UI presentation should honor the latter without blocking the former.**

If developers hold that model throughout implementation, this technique will reliably reduce jitter and improve perceived responsiveness in remote workspaces.