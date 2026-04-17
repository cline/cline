# Cline Crash Investigation, Testing, and Fix Implementation Plan

## Purpose of this document

This document is a standalone implementation plan for identifying extension crash causes in Cline, reproducing them reliably, writing tests that prove the failures, implementing fixes, and verifying that the fixes work.

It is written so a development team can pick it up without needing the full conversation that led to it. It explains:

- what problem we are solving,
- why the problem matters,
- how the relevant parts of the Cline architecture work,
- what crash candidates we currently suspect,
- how to systematically assess each candidate,
- how to turn each candidate into a reproducible failing test,
- how to implement fixes safely, and
- how to verify the fixes under realistic and extreme conditions.

The goal is not only to fix one bug at a time. The goal is to create a durable crash-investigation program for the VS Code extension so that future regressions become easier to detect, understand, and prevent.

---

## High-level vision

### What we are trying to achieve

We want Cline to remain stable when it is pushed far beyond “normal” usage. Historically, many users work in relatively short sessions, with modest task sizes, modest chat history, modest file sizes, and modest tool output. But increasingly, Cline is being used for:

- long-horizon multi-hour tasks,
- very large repositories,
- large file edits,
- repeated state updates,
- repeated tool approvals,
- heavy webview traffic,
- noisy MCP servers,
- retries, cancellations, and task restarts,
- tasks that accumulate a large amount of context and metadata over time.

The extension therefore needs to tolerate “stress shapes” that look more like a continuously running agent than a short assistant conversation.

### What counts as success

Success means:

- we can name the major crash candidates,
- we can reproduce them intentionally,
- we can write tests that fail before the fix,
- we can implement fixes that are understandable and maintainable,
- the same tests pass after the fix,
- and we have ongoing protection against regressions.

### What counts as a “crash” for this effort

For this program, the word “crash” should be interpreted broadly. It includes any catastrophic or near-catastrophic failure mode that makes the extension unusable or unstable.

Treat the following as crash-class failures:

- extension host process exit or restart,
- out-of-memory failure,
- fatal allocation error,
- unhandled exception or unhandled promise rejection,
- gRPC/webview stream breakage under load,
- extreme UI freeze or event-loop stall,
- runaway resource accumulation that makes continued operation unsafe,
- repeated teardown leaks that eventually destabilize the extension,
- algorithmic blowups that hang the extension long enough to be functionally equivalent to a crash.

---

## Architectural overview for lay readers

This section explains the relevant parts of the system in plain language.

### 1. The task loop

At the center of the extension is the `Task` class in `src/core/task/index.ts`.

Its job is to:

- accept user input,
- build environment details and prompt context,
- call the active model provider,
- stream model output,
- parse tool calls,
- execute tools,
- update the chat state,
- persist data to disk,
- and post fresh state to the webview.

This means the `Task` object is a pressure point where many subsystems meet. Any mismatch between streaming, tool execution, persistence, UI updates, and cleanup can turn into instability over time.

### 2. Message state and persistence

The task’s visible conversation is handled by `MessageStateHandler` in `src/core/task/message-state.ts`.

It keeps two important collections in memory:

- `clineMessages`: the UI-facing message list,
- `apiConversationHistory`: the provider-facing conversation history.

It also writes those structures back to disk using functions in `src/core/storage/disk.ts`.

This is important because long tasks can accumulate many messages. If the system repeatedly rewrites or reparses large message arrays, it may create CPU spikes, memory spikes, or large transport payloads.

### 3. State transport to the webview

The controller builds the extension state in `src/core/controller/index.ts`, and then `src/core/controller/state/subscribeToState.ts` sends that state to the webview over the gRPC-style bridge.

Today, this is especially important because full state snapshots include the full `clineMessages` array.

That means a large conversation can be:

- materialized in memory,
- stringified into JSON,
- transmitted across the bridge,
- parsed again in the webview,
- and then used to update React state.

When repeated often, this can become a major crash vector.

### 4. File editing and diff presentation

The file-edit path is a major area of concern because it often handles large strings.

Key components include:

- `src/core/task/tools/handlers/WriteToFileToolHandler.ts`
- `src/core/task/tools/handlers/ApplyPatchHandler.ts`
- `src/integrations/editor/DiffViewProvider.ts`
- `src/hosts/vscode/VscodeDiffViewProvider.ts`
- `src/integrations/editor/FileEditProvider.ts`
- `src/core/assistant-message/diff.ts`
- `src/core/task/tools/utils/PatchParser.ts`

These components can hold several versions of a file at once:

- original file content,
- incoming model patch text,
- reconstructed target content,
- streamed editor content,
- pre-save content,
- post-save content,
- user-edited content,
- pretty diff output,
- final content returned to the model.

That duplication is manageable for small files, but becomes dangerous for very large files or very long lines.

### 5. Watchers, background resources, and teardown

Long-running tasks and repeated task churn can leave behind background resources if cleanup is incomplete.

Important examples:

- file watchers in `FileContextTracker`,
- `.clineignore` watcher in `ClineIgnoreController`,
- focus-chain watcher in `src/core/task/focus-chain/index.ts`,
- MCP settings and local file watchers in `src/services/mcp/McpHub.ts`,
- hook processes tracked by `HookProcessRegistry`,
- browser sessions,
- diff editors,
- terminal resources,
- task locks,
- background worker intervals.

Even if one leak is small, repeated task creation/cancellation can turn it into a serious stability issue.

---

## Guiding principles for the whole effort

### Principle 1: Turn every suspected crash into a formal hypothesis

Each crash candidate should be written down as a structured hypothesis with:

- **Cause**: what we think goes wrong,
- **Trigger**: what load or input shape makes it happen,
- **Oracle**: how we know it happened,
- **Fix direction**: what kind of change should address it,
- **Regression test**: the proof that it stays fixed.

### Principle 2: Reproduce failures at the cheapest layer possible

If a pure function can demonstrate the bug, write a unit test first.

If the failure only appears when the controller, task loop, and transport interact, write an integration test.

If the failure only appears over long periods or repeated churn, create a soak test.

### Principle 3: Use budgets, not just binary crashes

Some failures will not show up as immediate process exits. Instead they will look like:

- memory usage that never comes back down,
- CPU time that grows with message count,
- state payloads that become too large,
- event-loop lag that becomes unacceptable,
- handles/watchers that steadily increase.

Those are still real failures. Build tests that enforce resource budgets.

### Principle 4: Fix the architecture, not just the symptom

If a bug happens because the same large payload is copied five times, a local workaround is not enough. The real fix may require:

- delta-based state updates,
- explicit size caps,
- bounded queues,
- incremental persistence,
- deterministic cleanup,
- or replacing an algorithm with a better one.

---

## Development program structure

The recommended work is divided into nine workstreams.

### Workstream A — Establish common crash instrumentation

Before writing many candidate-specific tests, add shared instrumentation so failures are visible and comparable.

#### Goals

- Measure memory, CPU pressure, event-loop lag, active watchers/handles, and payload sizes.
- Make stress tests fail quickly and informatively.
- Avoid vague “it feels slower” debugging.

#### Tasks

- [x] Add a shared stress-test utilities module under `src/test/` or `tests/` for:
  - [x] `process.memoryUsage()` snapshots
  - [x] event-loop lag measurement
  - [x] active handle counting where feasible
  - [x] timing helpers
  - [x] payload byte-size assertions
- [x] Add helpers for running specific tests with reduced Node heap settings.
- [x] Add a test convention for resource-budget assertions.
- [x] Add a standard failure report shape for stress tests.

#### Why this matters

Without common instrumentation, every bug investigation becomes bespoke. With it, we can compare candidates consistently and know whether a fix genuinely improved resource behavior.

---

### Workstream B — Build a crash-hypothesis inventory

Create and maintain a candidate inventory document or machine-readable file.

#### Suggested artifact

Create one of the following:

- `docs/crash-candidate-matrix.md`, or
- `docs/crash-candidate-matrix.json`

Each candidate should include:

- candidate ID,
- title,
- subsystem,
- suspected root cause,
- risk level,
- trigger pattern,
- expected failure signal,
- test layer,
- likely files to touch,
- status.

#### Tasks

- [x] Create the initial crash-candidate matrix.
- [x] Seed it with the currently known candidates from this document.
- [ ] Add owner/severity/status columns if the team will actively manage it.
- [ ] Keep it updated as each candidate moves from “suspected” to “confirmed”, “fixed”, or “not reproducible”.

#### Why this matters

This prevents important crash candidates from being rediscovered repeatedly and gives the team a shared view of what is being worked on.

---

### Workstream C — Add deterministic unit tests for algorithmic blowups

Start with pure or nearly pure code where failures are cheap to reproduce.

#### Primary targets

- `src/core/task/tools/utils/PatchParser.ts`
- `src/core/assistant-message/diff.ts`
- any utility used to generate pretty diffs or reconstruct content

#### What to test

- [x] Huge single-line SEARCH/REPLACE blocks
- [x] Very large near-match contexts that trigger similarity fallback
- [ ] Many repeated chunks in one patch
- [ ] Out-of-order replacement edge cases
- [x] Pathological line lengths
- [ ] Empty-search whole-file replace behavior under huge content

#### Failure oracles

- operation exceeds time budget,
- heap exceeds budget,
- Node dies under low-heap configuration,
- test process stalls,
- function throws unexpected error.

#### Likely fixes

- [x] Add explicit maximum search block size.
- [x] Add maximum line-length guardrails.
- [x] Disable expensive partial-similarity fallback above safe work thresholds.
- [x] Skip oversized diff fallback scans when near-match search work exceeds safe thresholds.
- [ ] Replace quadratic similarity checks with cheaper heuristics.
- [x] Fail fast with clear error messages instead of trying to process absurdly large patches.

#### Why this matters

These are the best first tests because they are deterministic, fast to run, and directly target catastrophic CPU/memory hotspots.

---

### Workstream D — Add integration tests for state transport and persistence growth

The next highest-value area is the combination of message growth, persistence, and webview state broadcasting.

#### Primary targets

- `src/core/task/message-state.ts`
- `src/core/storage/disk.ts`
- `src/core/controller/index.ts`
- `src/core/controller/state/subscribeToState.ts`
- `webview-ui/src/context/ExtensionStateContext.tsx`

#### What to test

- [ ] Repeated `addToClineMessages()` with thousands of messages
- [ ] Repeated `updateClineMessage()` on large histories
- [ ] Full `postStateToWebview()` calls with large `clineMessages`
- [ ] Webview-side repeated `JSON.parse(response.stateJson)` under large payloads
- [ ] Repeated save/reload cycles on large `ui_messages.json`
- [ ] Long task histories with large per-message text bodies

#### Failure oracles

- state payload byte size exceeds budget,
- serialization/deserialization time grows unacceptably,
- memory grows monotonically across repeated updates,
- integration test times out,
- gRPC state subscribers disconnect under load.

#### Likely fixes

- [ ] Replace full-state updates with delta or paged updates.
- [ ] Keep only recent message windows in hot UI state.
- [ ] Change persistence from rewrite-heavy to append/coalesce-heavy where safe.
- [ ] Remove expensive operations from per-message save paths.
- [x] Add payload-size telemetry thresholds and warnings.
- [x] Suppress duplicate serialized state broadcasts to existing subscribers.
- [x] Skip no-op task-history rewrites when the computed history item is unchanged.

#### Why this matters

This is one of the strongest currently suspected long-horizon crash causes because it affects both the extension host and the webview simultaneously.

---

### Workstream E — Add integration tests for large-file editing failure modes

This workstream targets the main file-edit pipeline.

#### Primary targets

- `src/core/task/tools/handlers/WriteToFileToolHandler.ts`
- `src/core/task/tools/handlers/ApplyPatchHandler.ts`
- `src/integrations/editor/DiffViewProvider.ts`
- `src/hosts/vscode/VscodeDiffViewProvider.ts`
- `src/integrations/editor/FileEditProvider.ts`

#### Test fixtures to create

- [ ] large text file fixture (5 MB)
- [ ] very large text file fixture (20+ MB)
- [ ] single-line giant file fixture
- [ ] notebook fixture with large JSON body
- [ ] multi-file patch fixture with several large files

#### What to test

- [ ] `write_to_file` on huge file content
- [ ] `replace_in_file` against huge original content
- [ ] `apply_patch` against multiple large files
- [ ] manual approval payload generation for huge edits
- [ ] `saveChanges()` behavior with giant pre-save/post-save content
- [ ] `scrollToFirstDiff()` on very large file diffs

#### Failure oracles

- extension host crash,
- diff editor fails to open or hangs,
- heap spike greatly exceeding file size,
- operation exceeds timeout,
- test cannot complete under constrained heap.

#### Likely fixes

- [ ] Add file-size and line-size limits for edit tools.
- [ ] Short-circuit oversized edits with a clear user-visible error.
- [x] Avoid returning full final file content for oversized files.
- [x] Use summary output instead of full content in approval messages for large files.
- [x] Use summary output instead of full original-file echoes in edit failure messages for large files.
- [ ] Consider chunked or direct file-edit modes for large content.

#### Why this matters

The edit path is one of the most plausible catastrophic failure paths because it duplicates large strings across many layers at once.

---

### Workstream F — Fix transport architecture hazards in diff and webview presentation

This workstream addresses architectural patterns likely to produce crashes even if specific tests pass today.

#### Primary known concern: base64 diff URI payloads

`VscodeDiffViewProvider.openDiffEditor()` currently embeds `originalContent` as base64 in a URI query string. That can create a huge in-memory and transport footprint for large files.

#### Tasks

- [x] Write a focused integration test around large diff-editor open operations.
- [x] Measure URI length and memory cost for large inputs.
- [x] Replace base64-in-URI transport with a safer mechanism.

#### Preferred fix directions

- [ ] Use a temporary file for original-content snapshots.
- [x] Or use an in-memory registry keyed by short ID instead of embedding the content directly in the URI.
- [x] Ensure the virtual-document provider resolves content from a bounded source.

#### Why this matters

This is the kind of problem that can fail suddenly and spectacularly under a single giant file, even if most workloads never trigger it.

---

### Workstream G — Add teardown and leak-churn tests

This workstream focuses on repeated task churn and incomplete cleanup.

#### Primary targets

- `Task.abortTask()` in `src/core/task/index.ts`
- `FileContextTracker.dispose()`
- `ClineIgnoreController.dispose()`
- `FocusChainManager.dispose()`
- `McpHub.dispose()`
- `HookProcessRegistry`
- browser session cleanup
- diff/editor cleanup

#### Why this matters

Even if one task only leaks a little, many create/cancel/clear cycles can accumulate enough background resources to destabilize the extension.

#### What to test

- [x] create task -> cancel task, repeated N times
- [ ] create task -> open diff -> cancel before completion, repeated N times
- [x] task with tracked files -> abort -> ensure watcher count returns to baseline
- [x] task with focus-chain enabled -> abort -> ensure focus-chain watcher is gone
- [x] task with active hook process -> abort -> ensure registry count returns to baseline
- [x] repeated background command start/cancel loops
- [x] component-level watcher disposal and duplicate-watcher regression tests

#### Failure oracles

- active watcher count drifts upward,
- active hook-process count drifts upward,
- open handles never return to baseline,
- events still arrive after teardown,
- memory grows across repeated create/cancel loops.

#### Likely fixes

- [x] Await all async disposals in `abortTask()`.
- [x] Centralize teardown sequencing.
- [x] Add explicit cleanup assertions in test-only code.
- [x] Make background resources idempotently disposable.
- [x] Await controller-level MCP cleanup during controller disposal.
- [x] Await focus-chain watcher cleanup during focus-chain disposal.

#### Important note

One already identified concern is that `Task.abortTask()` currently calls async `dispose()` methods such as `fileContextTracker.dispose()` and `clineIgnoreController.dispose()` without awaiting them. That should be treated as a real teardown-race candidate.

---

### Workstream H — Add MCP-specific backlog and noisy-server tests

This workstream targets the MCP subsystem as a long-running background source of pressure.

#### Primary targets

- `src/services/mcp/McpHub.ts`

#### Suspected issues

- `pendingNotifications` can accumulate without an explicit cap,
- server error strings can grow without a bound,
- restart/watcher churn may create noisy behavior,
- repeated notifications can become a hidden memory leak when no active task consumes them.

#### What to test

- [ ] noisy notification stream with no active task callback
- [ ] repeated server stderr/error output
- [ ] repeated MCP settings file changes
- [ ] repeated server restart cycles

#### Failure oracles

- notification backlog grows without bound,
- memory grows steadily,
- error strings become enormous,
- restart loops leave stale connections or watchers.

#### Likely fixes

- [x] cap `pendingNotifications` queue length,
- [x] cap or summarize accumulated error strings,
- [x] add telemetry when truncation/drop occurs,
- [x] ensure watchers are removed deterministically.

---

### Workstream I — Add nightly soak tests for long-horizon stability

Some failures are only visible after sustained operation.

#### Goals

- simulate multi-hour or high-iteration task behavior,
- catch monotonic growth that shorter tests miss,
- validate that fixes still hold over time.

#### Suggested soak profiles

- [ ] 10,000 incremental message updates
- [ ] 1,000 repeated state broadcasts with growing conversation
- [ ] repeated diff-edit open/update/reset cycles
- [ ] 1,000 create/cancel task cycles
- [ ] noisy MCP notification run
- [ ] large-file edit run under reduced heap

#### Recommended CI strategy

- keep fast deterministic tests in normal PR CI,
- run soak tests in nightly or scheduled CI,
- publish artifacts: heap snapshots, payload size traces, handle-count traces.

---

## Current high-priority crash candidates

This section captures the most important known candidates today.

### Candidate 1 — Full-state rebroadcast of large `clineMessages`

**Why we suspect it**

The controller builds a state object containing the full `clineMessages` array, serializes it, and broadcasts it to all state subscribers. The webview parses it again. This repeats often.

**Primary files**

- `src/core/controller/index.ts`
- `src/core/controller/state/subscribeToState.ts`
- `webview-ui/src/context/ExtensionStateContext.tsx`

**Trigger pattern**

- a large conversation,
- repeated partial updates,
- repeated tool activity,
- repeated `postStateToWebview()` calls.

**Test plan**

- [ ] seed a synthetic task with very large `clineMessages`
- [ ] repeatedly post state
- [ ] measure payload size, time, and memory
- [ ] assert state-update budget

**Likely fix direction**

- delta-based updates,
- pagination/windowing,
- separate “chat history” transport from “shell state” transport.

---

### Candidate 2 — Full-array persistence churn in message state

**Why we suspect it**

Every add/update/delete in `MessageStateHandler` can trigger full message persistence and task-history recalculation. This can become extremely expensive on long tasks.

**Primary files**

- `src/core/task/message-state.ts`
- `src/core/storage/disk.ts`

**Test plan**

- [ ] benchmark repeated mutations as message counts grow
- [ ] assert that latency growth stays below acceptable threshold
- [ ] run under reduced heap

**Likely fix direction**

- coalesced saves,
- append-style persistence where safe,
- move expensive task-size calculations off the hot path.

---

### Candidate 3 — File-edit string amplification

**Why we suspect it**

Large files can be copied across many representations during one edit.

**Primary files**

- `src/core/task/tools/handlers/WriteToFileToolHandler.ts`
- `src/core/task/tools/handlers/ApplyPatchHandler.ts`
- `src/integrations/editor/DiffViewProvider.ts`

**Test plan**

- [ ] write huge file content
- [ ] patch huge file content
- [ ] measure peak memory during approval and save

**Likely fix direction**

- hard limits,
- chunked strategies,
- summarized responses instead of full content echoes.

---

### Candidate 4 — Base64 diff URI size explosion

**Why we suspect it**

Original file content is encoded into a URI query string for diff presentation.

**Primary files**

- `src/hosts/vscode/VscodeDiffViewProvider.ts`
- `src/extension.ts`

**Test plan**

- [ ] open diff editor with progressively larger original files
- [ ] record URI size and memory impact
- [ ] detect threshold where behavior fails or becomes unstable

**Likely fix direction**

- replace URI payload with temp-file or ID-based virtual-doc lookup.

---

### Candidate 5 — Quadratic patch matching and diff reconstruction

**Why we suspect it**

`PatchParser` and `constructNewFileContent` contain fallback matching strategies that can become very expensive on large inputs.

**Primary files**

- `src/core/task/tools/utils/PatchParser.ts`
- `src/core/assistant-message/diff.ts`

**Test plan**

- [ ] giant near-match strings,
- [ ] large repeated patterns,
- [ ] giant single-line searches,
- [ ] multi-block pathological patches.

**Likely fix direction**

- cap expensive fallbacks,
- introduce safe-size thresholds,
- use heuristics before similarity math,
- fail fast for pathological inputs.

---

### Candidate 6 — MCP pending notification backlog

**Why we suspect it**

Notifications are stored when no task callback is attached, and the storage queue is currently not bounded.

**Primary files**

- `src/services/mcp/McpHub.ts`

**Test plan**

- [ ] simulate noisy server with no active task
- [ ] assert queue length and memory do not grow without bound

**Likely fix direction**

- bounded queue,
- drop policy,
- summarize old notifications,
- telemetry for truncation.

---

### Candidate 7 — Async teardown races and leaked watchers

**Why we suspect it**

Not all async cleanup appears to be awaited during task abort, and several subsystems create watchers or background resources.

**Primary files**

- `src/core/task/index.ts`
- `src/core/context/context-tracking/FileContextTracker.ts`
- `src/core/ignore/ClineIgnoreController.ts`
- `src/core/task/focus-chain/index.ts`

**Test plan**

- [ ] repeated task create/cancel loops
- [ ] track watchers/handles before and after
- [ ] assert stable cleanup baseline

**Likely fix direction**

- await all disposals,
- centralize teardown,
- add test-only cleanup introspection if needed.

---

## Recommended implementation order

The team should not attack everything at once. The best sequence is:

### Phase 1 — Build the shared testing and observability foundation

- [x] Add stress-test utilities
- [x] Add reduced-heap runner support
- [x] Add resource-budget assertion helpers
- [x] Create crash-candidate matrix

### Phase 2 — Confirm deterministic hotspots first

- [x] PatchParser stress tests
- [x] diff reconstruction stress tests
- [x] large-file edit pipeline tests

### Phase 3 — Confirm state growth hazards

- [x] message-state churn tests
- [x] state broadcast / webview parse tests
- [x] payload-size instrumentation thresholds

### Phase 4 — Confirm teardown and backlog risks

- [x] watcher leak churn tests
- [x] MCP noisy-server tests
- [x] cancellation/restart churn tests

### Phase 5 — Implement architecture fixes

- [ ] add caps and fail-fast protections
- [ ] reduce full-state broadcasting
- [ ] reduce full-array persistence churn
- [ ] replace risky diff transport patterns
- [ ] bound queues and error accumulation
- [ ] harden teardown semantics

### Phase 6 — Run regression and soak validation

- [ ] rerun deterministic tests
- [ ] rerun constrained-heap tests
- [ ] rerun nightly soak tests
- [ ] document residual risks and future follow-ups

---

## Detailed implementation requirements

This section explains what developers should actually build.

### Requirement 1 — Add explicit budgets

The system currently has some caps in isolated places, but the main crash-prone paths need explicit, documented limits.

Add limits for:

- [x] maximum file-edit size,
- [x] maximum single-line size for file-edit tools,
- [x] maximum patch-search block size,
- [x] maximum state snapshot size warning threshold,
- [x] maximum MCP notification backlog length,
- [x] maximum accumulated server error text length.

Each limit should:

- have a named constant,
- have a clear user-facing failure message,
- have tests that prove the cap works,
- and ideally emit telemetry when tripped.

### Requirement 2 — Separate “hot path” work from “bookkeeping” work

Developers should audit hot paths and move nonessential work away from frequent updates.

Examples:

- [ ] do not compute full task directory size on every message mutation,
- [ ] do not repeatedly stringify enormous full-state snapshots if only a small delta changed,
- [x] do not rewrite task history when the derived item has not changed,
- [ ] do not compute expensive whole-document diffs unless needed,
- [ ] do not store oversized model-facing artifacts when summaries are enough.

### Requirement 3 — Make teardown deterministic

Every background resource should have:

- a clear owner,
- a clear creation point,
- a clear disposal point,
- and tests proving it is cleaned up.

Developers should:

- [ ] inventory all watcher/process/session/timer resources,
- [ ] confirm who owns each one,
- [x] ensure abort/clear/dispose paths await cleanup where necessary,
- [x] add tests that verify cleanup baselines.

### Requirement 4 — Use the same repro after every fix

Every bug fix must keep the repro around.

The standard workflow should be:

1. create repro,
2. make test fail,
3. implement fix,
4. rerun same repro,
5. confirm new resource budget,
6. keep test in suite.

This is non-negotiable if we want the crash program to produce durable value.

---

## Suggested test harness taxonomy

Use this vocabulary consistently in code review and planning.

### Unit stress test

Use for pure functions or nearly pure logic.

Good for:

- `PatchParser`
- `constructNewFileContent`
- diff/statistics helpers

### Integration stress test

Use when multiple extension subsystems interact.

Good for:

- controller state updates,
- message-state persistence,
- diff editor lifecycle,
- task abort/teardown.

### Extension-host crash test

Use when the behavior depends on VS Code APIs, webview bridge behavior, or actual editor lifecycle.

Good for:

- diff view opening,
- large state transport,
- repeated VS Code-side resource churn.

### Soak test

Use when the failure depends on elapsed time, repeated cycles, or gradual buildup.

Good for:

- repeated state updates,
- repeated create/cancel loops,
- MCP notification accumulation,
- long-running agent simulations.

---

## Verification checklist for each candidate

For every crash candidate, do not mark it complete until all of the following are checked.

- [ ] Candidate is written up in the crash-candidate matrix
- [ ] Trigger workload is explicitly defined
- [ ] Failure oracle is explicitly defined
- [ ] Repro fixture or harness exists in the repo
- [ ] Test fails before fix
- [ ] Root cause is documented in code review or issue notes
- [ ] Fix is implemented
- [ ] Test passes after fix
- [ ] Resource budget is measured after fix
- [ ] Follow-up risks are documented

---

## Developer-facing execution checklist

This section is designed to be worked through directly.

### Foundation

- [x] Create `docs/crash-candidate-matrix.md` or equivalent tracking artifact
- [x] Add shared stress instrumentation helpers
- [x] Add reduced-heap test runner support
- [ ] Decide which tests run in PR CI vs nightly CI

### Candidate confirmation

- [x] Confirm full-state rebroadcast candidate
- [x] Confirm message persistence churn candidate
- [x] Confirm large-file edit amplification candidate
- [x] Confirm base64 diff URI candidate
- [x] Confirm PatchParser/diff quadratic candidate
- [x] Confirm MCP pending notification backlog candidate
- [x] Confirm teardown/watcher leak candidate

### Fix implementation

- [x] Add explicit caps to dangerous payload paths
- [x] Refactor hot paths to reduce full snapshot work
- [x] Replace risky diff transport mechanics
- [x] Bound queues and error accumulation
- [x] Harden abort and teardown sequencing

### Validation

- [x] Rerun all deterministic repros
- [x] Rerun constrained-heap repros
- [ ] Rerun create/cancel churn tests
- [ ] Rerun long-horizon soak tests
- [x] Capture before/after measurements
- [x] Update crash-candidate matrix status

### Handoff

- [ ] Summarize which candidates were confirmed
- [ ] Summarize which fixes landed
- [ ] Summarize which candidates remain open
- [ ] Summarize remaining architectural follow-ups

---

## Acceptance criteria for the overall initiative

The initiative is complete only when:

- [ ] every currently known high-priority crash candidate has a formal hypothesis,
- [ ] every high-priority candidate has at least one reproducible test,
- [ ] confirmed candidates have fixes or explicit deferrals,
- [ ] the extension has explicit size and resource guardrails in the highest-risk paths,
- [ ] teardown stability has been tested under churn,
- [ ] nightly soak coverage exists for long-horizon risks,
- [ ] the crash-candidate matrix is current,
- [ ] and the team can explain the remaining residual risk.

---

## Final note to the development team

The most important mindset shift is this:

Do not wait for users to report a literal crash dialog before treating a behavior as a crash-class problem.

If a large task causes:

- repeated full-state snapshots,
- large-string duplication,
- unbounded queues,
- watchers that outlive their owner,
- or algorithms that go nonlinear under extreme inputs,

then the crash is already “in the architecture”, even if it has not yet been triggered in a reproducible user report.

This plan is designed to move the team from reactive debugging to proactive crash engineering.
