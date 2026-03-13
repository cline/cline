# Technique Plan: Ephemeral Partial Persistence Split

This document is the implementation plan for the **ephemeral partial persistence split** technique identified in `docs/remote-workspace-latency-branch-analysis-report.md` as the highest-impact improvement for remote-workspace user-perceived latency.

The core idea is simple:

> **Stop treating every streamed chunk as durable state that must be written to disk immediately.**

That principle matters everywhere in this project, but it is especially important here. In remote workspace mode, partial updates are expensive not because the bytes are individually large, but because there are many of them and each one can pull in remote filesystem I/O, history recomputation, serialization work, and follow-on transport churn. For the user, this shows up as sluggish or jittery streaming, especially during long answers or large-file operations where the agent emits lots of progress text.

This plan focuses on splitting **ephemeral UI mutations** from **durable persistence boundaries** while preserving crash recovery, history correctness, and the rest of Cline’s product behavior.

## How To Use This Plan

This plan should be executed **on a new development branch**, not by continuing to stack work directly onto `eve_troubleshooting-remote-workspaces`.

That branch, `eve_troubleshooting-remote-workspaces`, should be treated as the **fully developed reference implementation** for this technique. In other words, the work described here is not speculative greenfield design work; it is a structured plan for re-deriving, validating, and extracting the technique from the already-working reference implementation into a smaller, more reviewable changeset.

The most effective way to use this document is:

1. read the goal and mental model for the step,
2. inspect how the reference implementation branch already solved it,
3. extract the minimum coherent version of that change into your own branch,
4. run the tests and validation described here,
5. compare behavior against the reference implementation when in doubt.

Be smart about this. Do not re-invent behavior that already exists in the reference implementation unless there is a very clear reason to improve or simplify it. The branch already contains the end-state shape we want to learn from. Your job is to extract, verify, and explain the minimal version of that behavior safely.

## Document Type, Audience, and Quality Bar

This is an **extraction implementation plan**, not a greenfield design doc and not a PR description. It is intended for a **Staff+ level distributed systems / infrastructure engineer** who is extracting a production-worthy technique from a known-good integrated implementation.

That means the quality bar is:

- the plan should be executable with minimal ambiguity,
- the reasoning behind each step should be legible to a strong reviewer,
- and the extraction should preserve product behavior across the rest of Cline while improving remote-workspace latency.

If a step in this plan would not help a strong engineer quickly answer “what exactly am I changing, why now, what must remain true, and how do I verify it?”, then the step is not detailed enough.

## Artifact Stack and Dependency Position

This doc sits in the broader artifact stack as follows:

1. `docs/remote-workspace-latency-branch-analysis-report.md` explains **which techniques matter most and why**.
2. This document explains **how to extract and implement one technique in a smaller branch/PR**.
3. A later PR-slicing / execution phase should use this document to drive real implementation work.

When using this plan, always begin by re-reading the branch analysis report so the extraction stays aligned with the larger prioritization and product intent.

## Developer Operating Posture

This plan is written for a Staff+-level engineer who is expected to use judgment, not just mechanically check boxes.

While implementing each step:

- actively compare your changes to `eve_troubleshooting-remote-workspaces`,
- preserve the original user experience across non-remote product surfaces,
- prefer coherent extraction over literal copy-paste,
- and keep asking: **what hot-path work are we removing, and what correctness boundary are we preserving?**

The most important meta-principle is still:

> **Stop treating every streamed chunk as a durable, full-state, immediately-presented event.**

For this technique specifically, the emphasis is on the **durable** part of that sentence.

## Minimal Coherent Extraction Boundary

The smallest coherent PR for this technique should usually include:

- message-state ephemeral mutation APIs,
- dirty tracking plus explicit flush support,
- task callsite conversion for partial updates,
- periodic safety flush,
- and the minimum set of tests needed to prove correctness.

What should **not** be split away from this technique if avoidable:

- the dirty-bit / flush contract,
- the durable-boundary logic for partial → complete transitions,
- safety-flush lifecycle management,
- and the tests that prove resume/abort correctness.

If those pieces are separated too aggressively, reviewers will have a much harder time understanding whether the extraction is actually safe.

## Common Failure Modes While Extracting

Watch for these failure modes explicitly:

- extracting the ephemeral APIs without converting the real hot-path callsites,
- clearing the dirty bit too early,
- leaving abort/resume paths on stale assumptions about immediate persistence,
- making durable and ephemeral mutation paths diverge semantically,
- and validating only happy-path streaming while missing crash-recovery or resume regressions.

If any of those happen, the extraction may appear simpler while actually weakening the product.

---

## Why This Technique Matters

When Cline is writing a large file, updating a long reasoning trace, or streaming many incremental tool/progress updates, the old behavior effectively says:

1. mutate message state,
2. save messages to disk,
3. update task history,
4. possibly trigger more UI/state work,
5. repeat on the next partial chunk.

That is the wrong clock boundary.

The better mental model is:

- **Streaming partials are animation state.** They exist to help the user perceive progress.
- **Durable persistence is recovery state.** It exists so the task can survive restart, cancellation, or history resume.
- **Those are related, but they are not the same thing.**

So the goal here is to keep the UI feeling live while only persisting at meaningful boundaries plus an occasional safety flush.

---

## Success Criteria

- Partial `say(...)` and `ask(...)` updates no longer synchronously persist on every mutation.
- Durable persistence still occurs at semantic boundaries such as completion, cancel, tool completion, and request completion.
- Long-running streams periodically safety-flush unsaved partial changes.
- Resume-from-history and crash-recovery behavior remain correct and predictable.
- Message-state behavior remains mutex-safe and consistent under concurrent tool / stream / abort activity.

---

## Files Most Likely to Change

- `src/core/task/message-state.ts`
- `src/core/task/index.ts`
- `src/core/task/EphemeralMessageFlushScheduler.ts`
- `src/test/message-state-handler.test.ts`
- `src/core/task/__tests__/EphemeralMessageFlushScheduler.test.ts`
- `src/core/task/__tests__/latency.test.ts`
- possibly targeted resume / abort integration tests

---

## Step-by-Step Implementation Plan

## Step 1 — Define the durability contract for message mutations

### Goal

Write down the architectural contract before changing behavior, so future developers know which updates are ephemeral and which are durable.

### Mental model

If developers cannot quickly answer “does this mutation need to survive a crash immediately?”, they will accidentally route new hot-path updates back through synchronous persistence. This step prevents future regression.

### Work

- [ ] Add code comments near `MessageStateHandler` describing the distinction between ephemeral and durable mutations.
- [ ] Add code comments in `Task.say(...)` and `Task.ask(...)` documenting which partial flows are intentionally ephemeral.
- [ ] Define a durable-boundary checklist in comments or docstrings, including at minimum:
  - [ ] partial → complete transition
  - [ ] tool completion / tool result boundary
  - [ ] request completion
  - [ ] cancellation / abort
  - [ ] resume-related state changes
  - [ ] checkpoint-relevant events

### Detailed code changes

- In `src/core/task/message-state.ts`, add a short header comment near the class definition explaining:
  - durable methods write immediately,
  - ephemeral methods mutate in memory and emit change notifications,
  - `flushClineMessagesAndUpdateHistory()` is the bridge between the two.
- In `src/core/task/index.ts`, add comments above the partial-update branches in `say(...)` and `ask(...)` explaining why partial updates are not always durable.

When doing this work, read the corresponding code in `eve_troubleshooting-remote-workspaces` first and copy the intent, not just the surface syntax. The point of this step is to make the extraction self-explanatory for future reviewers and maintainers.

### Tests

- [ ] No behavioral tests required for comments alone.
- [ ] Ensure any snapshot/doc-based linting or type-check flow still passes.

---

## Step 2 — Add explicit ephemeral mutation APIs to `MessageStateHandler`

### Goal

Create first-class APIs for in-memory message changes that emit message-change notifications without synchronously persisting.

### Mental model

The presence of dedicated APIs changes developer behavior. If the only available mutation helper is a durable save path, then everything becomes durable by default. We want the inverse for streaming partials: durable only when intentionally requested.

### Work

- [ ] Add `addToClineMessagesEphemeral(message)`.
- [ ] Add `updateClineMessageEphemeral(index, updates)`.
- [ ] Add internal dirty tracking for unsaved ephemeral changes.
- [ ] Ensure ephemeral methods emit the same `clineMessagesChanged` events and task UI deltas as durable methods.
- [ ] Ensure all of the above remain protected by the existing mutex.

### Detailed code changes

- In `src/core/task/message-state.ts`:
  - [ ] Add a `hasDirtyEphemeralChanges` flag if it does not already exist.
  - [ ] In `addToClineMessagesEphemeral(...)`:
    - [ ] set `conversationHistoryIndex` and `conversationHistoryDeletedRange` exactly as durable add does,
    - [ ] mutate `clineMessages`,
    - [ ] mark dirty,
    - [ ] emit `clineMessagesChanged`.
  - [ ] In `updateClineMessageEphemeral(...)`:
    - [ ] validate index,
    - [ ] capture previous message,
    - [ ] mutate in place,
    - [ ] mark dirty,
    - [ ] emit `clineMessagesChanged`.
  - [ ] Keep delta emission behavior identical between ephemeral and durable changes so frontend live behavior stays consistent.

The smart way to execute this step is to compare the durable and ephemeral codepaths side by side in the reference implementation branch and preserve the shared invariants exactly. The extraction should reduce write amplification, not create a shadow message-state model with slightly different semantics.

### Tests

- [ ] Unit test: ephemeral add mutates in-memory state without calling persistence.
- [ ] Unit test: ephemeral update mutates in-memory state without calling persistence.
- [ ] Unit test: ephemeral mutation emits `clineMessagesChanged` with correct shape.
- [ ] Unit test: ephemeral mutation still emits task UI deltas when delta sync is enabled.
- [ ] Unit test: invalid index still throws in ephemeral update path.

---

## Step 3 — Add explicit flush behavior for previously-ephemeral changes

### Goal

Provide a single durable flush method that persists all dirty ephemeral changes and updates task history once.

### Mental model

We are not removing durability; we are **batching** durability at the right semantic times. The flush method is the “commit” for a burst of ephemeral UI activity.

### Work

- [ ] Add `flushClineMessagesAndUpdateHistory()` if not already present.
- [ ] Make it a no-op when no ephemeral changes are dirty.
- [ ] Ensure it reuses the same internal persistence logic as durable mutations.

### Detailed code changes

- In `src/core/task/message-state.ts`:
  - [ ] Add `flushClineMessagesAndUpdateHistory()` guarded by `withStateLock(...)`.
  - [ ] If `hasDirtyEphemeralChanges` is false, return early.
  - [ ] Otherwise call `saveClineMessagesAndUpdateHistoryInternal()`.
  - [ ] Ensure `saveClineMessagesAndUpdateHistoryInternal()` clears the dirty flag only after successful save/update-history flow.

This step is where the implementation starts to feel like a deliberate state machine rather than a collection of helper methods. Be smart about failure ordering here: if the code clears the dirty bit too early or conflates flush success with mutation success, recovery correctness will quietly degrade.

### Tests

- [ ] Unit test: flush persists previously-ephemeral changes.
- [ ] Unit test: flush is a cheap no-op when there are no dirty changes.
- [ ] Unit test: task history reflects flushed content after prior ephemeral mutation.

---

## Step 4 — Switch streaming partial update callsites to ephemeral APIs

### Goal

Move the actual hot-path streaming mutations onto the new ephemeral methods.

### Mental model

The APIs only matter if the streaming loop uses them. This is the step that converts theory into latency improvement.

### Work

- [ ] Audit all partial `say(...)` paths.
- [ ] Audit all partial `ask(...)` paths.
- [ ] Switch normal streaming partial updates from durable to ephemeral mutation methods.
- [ ] Keep complete/finalized messages on durable paths unless explicitly flushed immediately after ephemeral completion.

### Detailed code changes

- In `src/core/task/index.ts`, update `say(...)`:
  - [ ] partial update of existing partial `say` message should use `updateClineMessageEphemeral(...)`.
  - [ ] new partial `say` message insertion should use `addToClineMessagesEphemeral(...)` where appropriate.
- In `src/core/task/index.ts`, update `ask(...)`:
  - [ ] partial update of existing partial `ask` message should use `updateClineMessageEphemeral(...)`.
  - [ ] new partial `ask` insertion should use `addToClineMessagesEphemeral(...)` where appropriate.
- For reasoning/tool-progress-related live updates:
  - [ ] ensure they remain visible to the UI through message-change events / partial-message events,
  - [ ] but no longer synchronously persist each partial mutation.

This is the step where it becomes easy to accidentally under-extract or over-extract. Use the reference implementation branch aggressively here. If a callsite was made ephemeral in `eve_troubleshooting-remote-workspaces`, understand why. If a callsite remained durable, understand why. Preserve that distinction intentionally.

### Tests

- [ ] Integration-style test: many partial text updates do not trigger per-update durable saves.
- [ ] Unit test: partial `say(...)` path still emits live UI updates while skipping persistence.
- [ ] Unit test: partial `ask(...)` path still emits live UI updates while skipping persistence.

---

## Step 5 — Define and enforce durable flush boundaries

### Goal

Ensure the system persists at the correct semantic points so correctness is preserved.

### Mental model

This is the balancing step. We are intentionally reducing durability frequency, so we must be precise about where durability is still required.

### Work

- [ ] Identify all partial → complete transitions.
- [ ] Flush at request completion.
- [ ] Flush on abort / cancellation.
- [ ] Flush when tool execution reaches a stable durable boundary.
- [ ] Flush when history / resume semantics require consistency.

### Detailed code changes

- In `src/core/task/index.ts`:
  - [ ] when `partial: false` finalizes a previously partial message, use durable `updateClineMessage(...)` or explicit flush right after ephemeral completion.
  - [ ] in request-finalization logic, call `flushClineMessagesAndUpdateHistory()` before or alongside final durable save path where needed.
  - [ ] in abort/cancel paths, ensure pending ephemeral changes are flushed before task shutdown is considered complete.
  - [ ] in resume-related flows, ensure history-visible state is not left behind dirty.

This step is the heart of the technique. The way to think about it is: we are removing durability from the hot path only because we are reintroducing durability at the right semantic boundaries. If those boundaries are fuzzy, the technique is incomplete.

### Tests

- [ ] Unit test: partial → complete transition results in durable persistence.
- [ ] Integration test: abort during stream persists a recoverable state.
- [ ] Regression test: resume-from-history still works after deferred partial persistence.
- [ ] Regression test: tool result flows remain properly visible in history after finalization.

---

## Step 6 — Add the periodic safety-flush scheduler

### Goal

Bound the amount of live UI state that could be lost if the extension host crashes during a long-running stream.

### Mental model

The correct behavior is not “persist every partial” and not “never persist until the very end.” The practical middle ground is:

- partials stay ephemeral during normal live streaming,
- but dirty state gets checkpointed periodically at low frequency.

### Work

- [ ] Add or finish `EphemeralMessageFlushScheduler`.
- [ ] Start it when a request begins streaming.
- [ ] Stop it when the request completes or aborts.
- [ ] Make it call `flushClineMessagesAndUpdateHistory()` on cadence only when dirty.

### Detailed code changes

- In `src/core/task/EphemeralMessageFlushScheduler.ts`:
  - [ ] ensure a single timer is active,
  - [ ] prevent overlap between flushes,
  - [ ] support clean start/stop/dispose semantics.
- In `src/core/task/index.ts`:
  - [ ] start scheduler near request start,
  - [ ] stop scheduler in both success and error/finally paths,
  - [ ] make cadence conservative (for example ~1.5s) to preserve UX win while bounding recovery loss.

Use the reference implementation’s chosen cadence and lifecycle wiring as the default starting point. Only diverge if you can clearly articulate why a different extraction improves isolation or reviewability without changing the core behavior.

### Tests

- [ ] Unit test: scheduler flushes pending ephemeral changes on cadence.
- [ ] Unit test: scheduler does nothing when there is no dirty ephemeral state.
- [ ] Unit test: scheduler stops cleanly on request completion/abort.

---

## Step 7 — Validate large-file and long-stream scenarios explicitly

### Goal

Confirm that the technique helps exactly the user scenario we care about: long-running, high-churn operations such as writing or rewriting large files.

### Mental model

Large-file operations are effectively “progress-heavy” workloads. Even if the tool invocation itself is durable, the surrounding reasoning, progress, and partial text can create a huge amount of avoidable mutation churn.

This is the direct answer to the large-file-write scenario: this technique helps because large-file operations tend to produce many small intermediate UI updates, and those should not all be treated like crash-critical persistence boundaries.

### Work

- [ ] Add a targeted validation scenario for large streamed output / large-file write behavior.
- [ ] Confirm persistence flush count drops sharply versus baseline.
- [ ] Confirm the user still sees smooth progress and correct final durable state.

### Detailed code changes

- Extend existing latency validation or tests to simulate:
  - [ ] long streaming response,
  - [ ] tool progress and completion,
  - [ ] large-file write workflow or equivalent sustained partial-update workload.
- Use telemetry fields already added in latency instrumentation to compare:
  - [ ] persistence flush count,
  - [ ] save durations,
  - [ ] chunk-to-webview timing.

### Tests

- [ ] Performance/regression test: long stream causes far fewer persistence flushes than partial-update count.
- [ ] Validation harness comparison: baseline vs ephemeral-persistence-enabled variant.
- [ ] Regression test: final message history and resume state remain correct.

---

## Step 8 — Rollout safeguards and developer controls

### Goal

Make the feature easy to disable, validate, and debug during rollout.

### Mental model

Hot-path changes need escape hatches. If behavior regresses in an edge case, the team should be able to isolate the feature quickly.

### Work

- [ ] Keep or add env flag gating for ephemeral persistence behavior.
- [ ] Ensure telemetry can compare enabled vs disabled behavior.
- [ ] Add debug logging only if low-noise and useful.

### Detailed code changes

- In `src/core/task/latency.ts` / `.env.example`:
  - [ ] preserve `CLINE_DISABLE_EPHEMERAL_MESSAGE_PERSISTENCE` or equivalent.
  - [ ] document intended use for A/B validation.

Treat the feature flag and validation path as first-class extraction requirements, not afterthoughts. Since the reference implementation already exists, the smoother development process is to keep comparison easy between “extracted technique enabled” and “feature disabled” modes.

### Tests

- [ ] Unit test: disable flag routes behavior back to durable-per-update path where applicable.
- [ ] Validation harness variant: feature-disabled mode still behaves correctly.

---

## Developer Checklist Summary

- [ ] Document the durability contract
- [ ] Add explicit ephemeral mutation APIs
- [ ] Add dirty tracking and explicit flush support
- [ ] Convert streaming partial callsites to ephemeral mutations
- [ ] Enforce durable flushes at semantic boundaries
- [ ] Add periodic safety flush scheduler
- [ ] Validate large-file / long-stream scenarios
- [ ] Preserve rollout flags and debugging support
- [ ] Run unit, integration, and validation-harness checks

---

## Final Mental Model Recap

When implementing this technique, keep this in mind:

- **Partial updates are for perception.**
- **Durable saves are for recovery.**
- **Doing recovery work on every animation step is what makes remote mode feel bad.**
- **The fix is not to persist less carelessly; it is to persist more intentionally.**

If this plan is implemented cleanly, large-file writes, long reasoning streams, and other high-churn tasks should feel markedly smoother in remote workspaces without sacrificing correctness.