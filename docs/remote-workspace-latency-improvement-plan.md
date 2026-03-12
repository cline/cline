# Remote Workspace Latency Improvement Plan for Cline

This document is a detailed implementation plan for improving user-perceived latency when Cline is running in VS Code attached to a remote workspace. It is written as a development guide, not just a task list. Each step includes its objective, the mental model behind it, the concrete code changes that should be made, and the tests needed to validate the work.

The core theme of this plan is that Cline currently couples three different kinds of work too tightly during task execution:

1. **Model stream ingestion** — handling small incoming chunks from the provider as quickly as possible.
2. **UI synchronization** — updating the chat and task state shown in the webview.
3. **Durable persistence** — saving messages/history to disk and updating task history metadata.

That coupling is manageable in a purely local environment, but becomes much more expensive when VS Code is attached to a remote workspace because the extension host, filesystem, and some VS Code APIs are remote while the user-facing webview is local. The result is that tiny stream deltas can repeatedly trigger expensive persistence and transport work, increasing latency and making the UI feel “chattery” or sluggish.

The goal of this plan is to decouple these clocks so that:

- chunk ingestion stays fast,
- the UI updates at a human-friendly cadence,
- and persistence happens at durable boundaries rather than on every partial mutation.

---

## Guiding Principles

Before starting implementation, keep these principles in mind:

- **Optimize for user perception, not raw event frequency.** Users care about smooth responsiveness, not whether every token is rendered immediately.
- **Semantic boundaries matter more than token boundaries.** First token, tool approval, tool completion, error, cancellation, and completion events should feel immediate. Text streaming can be coalesced.
- **Remote-mode costs are multiplicative.** Every full-state serialization and webview push may involve remote transport, local parsing, and React reconciliation.
- **Persistence should model recovery, not animation.** Partial UI states usually do not need to be persisted synchronously.
- **Measure before and after.** This plan includes instrumentation work because latency improvements should be proven, not inferred.

---

## Phase 0 — Baseline and Instrumentation

### Goal

Before changing architecture, establish hard measurements so that development can compare before/after behavior in both local and remote contexts. The mental model here is simple: if we do not measure call frequency, serialization size, persistence time, and end-to-end chunk-to-paint delay, we will not know which optimizations actually helped.

- [x] Add instrumentation for streaming hot-path events
- [x] Add instrumentation for state payload sizes and frequencies
- [x] Add instrumentation for persistence latency
- [x] Add instrumentation for end-to-end chunk-to-webview timing
- [x] Add remote-vs-local environment tagging to these metrics

### Code changes

#### 0.1 Instrument `presentAssistantMessage()` frequency and duration

In `src/core/task/index.ts`:

- Add counters/timers around `presentAssistantMessage()`.
- Track:
  - invocation count per request,
  - total time spent in the function,
  - average time per invocation,
  - whether the call was triggered by text, reasoning, tool delta, or finalization.

Suggested implementation approach:

- Introduce a small per-request in-memory stats object on `TaskState` or a request-scoped local metrics structure inside `recursivelyMakeClineRequests()`.
- Record timestamps with `performance.now()`.
- Emit summary telemetry at the end of the request rather than per call.

#### 0.2 Instrument `postStateToWebview()` and full state serialization

In `src/core/controller/index.ts` and `src/core/controller/state/subscribeToState.ts`:

- Record:
  - number of `postStateToWebview()` calls per request,
  - time spent in `getStateToPostToWebview()`,
  - size in bytes of serialized state,
  - send time for `sendStateUpdate()`.

Telemetry already exists for state response size in `subscribeToState.ts`; extend that to include:

- frequency,
- whether the app was currently streaming,
- whether the task was remote.

#### 0.3 Instrument partial message event traffic

In `src/core/controller/ui/subscribeToPartialMessage.ts`:

- Record count of partial events sent,
- payload size,
- time spent broadcasting.

This helps answer whether full state or partial stream traffic is the bigger transport cost.

#### 0.4 Instrument persistence latency

In `src/core/task/message-state.ts`:

- Measure time spent in:
  - `saveClineMessagesAndUpdateHistoryInternal()`
  - `saveApiConversationHistory(...)`
  - `updateTaskHistory(...)`
- Break down persistence cost by operation type where possible.

This is important because partial updates currently go through `updateClineMessage()` and trigger persistence synchronously.

#### 0.5 Add remote-awareness to instrumentation

In host/environment-derived state, tag metrics with whether the extension is running against a remote workspace. If there is already an authoritative host/environment signal, use that; otherwise add one.

Places to inspect and potentially extend:

- `HostProvider.env.getHostVersion({})`
- `getStateToPostToWebview()`
- any existing platform/host metadata included in telemetry

### Tests

- [x] Add unit tests for metric aggregation helpers
- [ ] Add tests to verify instrumentation does not throw when telemetry is disabled
- [x] Add tests to verify state/partial payload-size accounting is invoked

These tests should focus on ensuring instrumentation remains non-blocking and failure-safe.

---

## Phase 1 — Introduce a Presentation Scheduler

### Goal

The purpose of this phase is to stop calling the expensive presentation path on every incoming chunk. The mental model is: **the stream can run at machine speed, but the UI should repaint at human speed**. The scheduler becomes the boundary between those two clocks.

- [x] Design and implement a `TaskPresentationScheduler`
- [x] Replace direct hot-path `presentAssistantMessage()` invocation with scheduled flushes
- [x] Preserve immediate flushes for semantic boundaries
- [x] Add local vs remote cadence selection
- [x] Add final-drain behavior at stream completion and abort

### Code changes

#### 1.1 Create a scheduler class

Add a new file, for example:

- `src/core/task/TaskPresentationScheduler.ts`

Responsibilities:

- accept presentation requests from the streaming loop,
- coalesce repeated requests,
- flush at a bounded cadence,
- support priority levels.

Suggested interface:

```ts
type PresentationPriority = "immediate" | "normal" | "low"

class TaskPresentationScheduler {
	requestFlush(priority?: PresentationPriority): void
	flushNow(): Promise<void>
	dispose(): Promise<void>
}
```

The scheduler should hold:

- whether a flush is scheduled,
- whether a flush is currently running,
- whether more updates arrived while flushing,
- the highest pending priority.

#### 1.2 Integrate scheduler into `Task`

In `src/core/task/index.ts`:

- add a scheduler instance as a `Task` field,
- initialize it in the constructor,
- make the scheduler call into a refactored internal method, e.g. `flushAssistantPresentation()`.

Refactor current `presentAssistantMessage()` into two layers:

- public scheduler-facing method: `scheduleAssistantPresentation(...)`
- internal drain method: `flushAssistantPresentation()` or keep the name `presentAssistantMessage()` and make callers go through the scheduler.

#### 1.3 Replace direct hot-path calls

In the main streaming loop in `recursivelyMakeClineRequests()`:

- replace per-chunk `await this.presentAssistantMessage()` with a non-blocking scheduling call for normal streaming text/reasoning/tool deltas,
- keep direct/forced flushing for semantic boundaries such as:
  - first visible token,
  - tool completion or tool approval state transitions,
  - ask creation,
  - finalization after stream completion,
  - stream abort/error.

The important design choice here is that chunk ingestion should no longer await UI presentation by default.

#### 1.4 Add adaptive cadence

Use different flush intervals depending on environment.

Initial recommendation:

- local: 33–50ms
- remote: 75–125ms

If there is a reliable remote signal from VS Code host metadata, use it. Otherwise keep the scheduler configurable and default to a conservative value such as 75ms.

#### 1.5 Ensure final drain semantics

At request completion, cancellation, or stream failure:

- force a final synchronous drain,
- ensure any remaining partial content is presented or completed,
- prevent pending scheduled flushes from running after task disposal.

### Tests

- [x] Unit test: multiple requests within the cadence window produce one flush
- [x] Unit test: an immediate-priority request preempts/coalesces normal requests correctly
- [ ] Unit test: scheduler drains final updates on completion
- [x] Unit test: scheduler ignores/disposes pending work after task abort/dispose
- [ ] Integration test: streaming many text chunks produces fewer presentation invocations than chunk count

These tests should be written around deterministic fake timers so cadence behavior is reproducible.

---

## Phase 2 — Separate Ephemeral UI Updates from Durable Persistence

### Goal

This phase is likely one of the highest-impact improvements. The current system often persists partial updates immediately, which is expensive and unnecessary for animation-like streaming states. The mental model is: **partial updates are for the live experience; durable saves are for crash recovery and task history**. Those are related but not the same thing.

- [x] Add non-persisting message mutation APIs for partial updates
- [x] Update streaming paths to use ephemeral mutations
- [x] Add explicit durable flush points
- [x] Add periodic safety flush for long-running streams
- [x] Preserve correctness for crash recovery and resume behavior

### Code changes

#### 2.1 Extend `MessageStateHandler` with ephemeral mutation APIs

In `src/core/task/message-state.ts`:

Introduce methods that mutate in-memory message state and emit change notifications **without** saving to disk immediately.

Suggested methods:

```ts
async updateClineMessageEphemeral(index: number, updates: Partial<ClineMessage>): Promise<void>
async addToClineMessagesEphemeral(message: ClineMessage): Promise<void>
async flushClineMessagesAndUpdateHistory(): Promise<void>
```

Implementation details:

- preserve mutex safety,
- emit `clineMessagesChanged` just like durable mutations do,
- do not call `saveClineMessagesAndUpdateHistoryInternal()` inside ephemeral operations,
- maintain an internal dirty flag so the handler knows whether there are unsaved UI mutations.

#### 2.2 Switch partial text/reasoning/tool-progress updates to ephemeral APIs

In `src/core/task/index.ts`, update these call paths to use ephemeral updates where appropriate:

- `say(..., partial: true)` when updating existing partial say messages,
- `ask(..., partial: true)` when updating existing partial ask messages,
- reasoning partial row updates,
- native-tool-call text partial finalization where no durable save is yet needed.

The goal is to keep streaming UI smooth while deferring disk work.

#### 2.3 Define durable flush boundaries

Persist synchronously at semantic boundaries such as:

- new full message insertion,
- partial → complete transition,
- tool completion,
- `api_req_started` finalization,
- request completion,
- task abort/cancel,
- task resume state changes,
- checkpoint-relevant events.

Document these boundaries clearly in code comments because this becomes an architectural contract.

#### 2.4 Add a safety flush timer for long streams

To reduce the risk of losing too much partial content on a crash, add a lightweight periodic flush during active streaming.

Initial proposal:

- if there are unsaved ephemeral message changes,
- flush them every 1–2 seconds during an active stream.

This gives much better performance than per-delta saves while still offering reasonable recovery.

#### 2.5 Preserve task history correctness

Because `saveClineMessagesAndUpdateHistoryInternal()` also updates task history metadata, ensure that deferred persistence still yields correct task history snapshots at meaningful points.

In practice this means task history may be slightly behind while tokens are streaming, which is acceptable, but it must be correct when:

- a request ends,
- the task is cancelled,
- the task is resumed,
- the user views history after execution.

### Tests

- [x] Unit test: ephemeral update mutates in-memory message and emits change without saving
- [x] Unit test: durable flush persists previously ephemeral changes
- [x] Unit test: partial → complete transition triggers persistence
- [ ] Unit test: periodic safety flush persists pending ephemeral changes
- [ ] Integration test: abort during stream still persists a recoverable final state
- [ ] Regression test: resume-from-history still works after deferred partial persistence

---

## Phase 3 — Coalesce Full State Updates

### Goal

Even after partial-message improvements, the codebase still calls `postStateToWebview()` from many locations. In remote environments, full-state pushes are especially expensive because they build and serialize a large `ExtensionState` payload. The mental model here is: **full state should be treated like a snapshot sync, not like a token stream transport**.

- [x] Add a controller-level full-state update coalescer
- [x] Prevent repeated `postStateToWebview()` calls from flooding the transport during active streaming
- [x] Add priority/urgency categories for full-state pushes
- [x] Keep initial and terminal state updates immediate and reliable

### Code changes

#### 3.1 Add a `StateUpdateScheduler` or coalescer to `Controller`

In `src/core/controller/index.ts`:

- replace the current fire-immediately behavior of `postStateToWebview()` with a coalescing scheduler,
- preserve a method for callers that need an immediate flush.

Suggested split:

```ts
async postStateToWebview(options?: { priority?: "immediate" | "normal" | "low" }): Promise<void>
private async flushStateToWebview(): Promise<void>
```

The scheduler should:

- collapse multiple requests into one pending flush,
- mark state dirty if more changes arrive while a flush is running,
- re-run once if needed after completion.

#### 3.2 Use shorter intervals outside streaming, longer during streaming

When a task is actively streaming, coalesce more aggressively.

Initial heuristic:

- idle/non-streaming: next-tick or very small debounce
- streaming local: 50ms
- streaming remote: 100–150ms

This can be implemented in the controller or driven from task state.

#### 3.3 Audit existing `postStateToWebview()` callsites

Use the already-discovered callsite inventory in the codebase and categorize them:

- must remain immediate,
- can be coalesced,
- should be replaced by deltas later.

Examples likely needing immediacy:

- task initialization,
- task clear/cancel completion,
- auth/login state changes,
- mode switch,
- explicit task switching.

Examples likely safe to coalesce:

- usage/token updates during stream,
- retry-status metadata refreshes,
- background-command state churn,
- focus-chain intermediate updates.

### Tests

- [x] Unit test: repeated `postStateToWebview()` calls within a short interval produce one flush
- [x] Unit test: a dirty state during flush causes exactly one follow-up flush
- [x] Unit test: immediate-priority post bypasses normal delay
- [ ] Integration test: active streaming generates significantly fewer full-state pushes

---

## Phase 4 — Expand from Snapshot Sync to Delta Sync for Active Task Execution

### Goal

This is a larger architectural improvement. Cline already has a partial-message subscription, which proves that the system can move small targeted UI updates instead of full snapshots. This phase extends that idea so that active task execution mostly uses **delta events**, while full-state snapshots are reserved for initialization, resync, and coarse-grained transitions.

- [x] Design a delta event model for hot task execution state
- [x] Add backend publishers for message and request metadata deltas
- [x] Update webview state handling to apply deltas safely
- [x] Keep full snapshot subscription as initialization and recovery path
- [x] Add ordering/versioning to prevent stale delta application

### Code changes

#### 4.1 Define delta event types

Create a new shared type module, for example:

- `src/shared/TaskUiDelta.ts`

Include delta types such as:

- `message_added`
- `message_updated`
- `message_deleted`
- `message_completed`
- `api_request_updated`
- `background_command_updated`
- `focus_chain_updated`
- `task_state_resynced`

Each event should include:

- task id,
- monotonic sequence number or revision,
- minimal payload required to update the client.

#### 4.2 Add subscription and publisher infrastructure

Pattern after:

- `src/core/controller/ui/subscribeToPartialMessage.ts`
- `src/core/controller/state/subscribeToState.ts`

Add something like:

- `src/core/controller/ui/subscribeToTaskUiDeltas.ts`

This should support both streaming subscribers and callback subscribers if needed.

#### 4.3 Publish deltas from message state mutations

In `MessageStateHandler` and/or `Task`:

- when a message is added/updated/deleted/completed, emit a delta event,
- for `api_req_started` usage/cost updates, emit a specific metadata delta rather than requiring a full-state push.

This may be naturally integrated with `clineMessagesChanged` events already emitted by `MessageStateHandler`.

#### 4.4 Update the webview to consume deltas

In `webview-ui/src/context/ExtensionStateContext.tsx`:

- subscribe to the new delta stream,
- patch state incrementally,
- preserve the full-state subscription for initial load and recovery/resync.

Recommended mental model for the webview:

- full state provides the initial canonical snapshot,
- deltas advance that state incrementally,
- if sequence numbers are skipped or an invariant fails, request/resubscribe to full state.

#### 4.5 Reduce full-state payload dependence during active execution

Once delta sync is working, stop relying on `state.clineMessages` inside frequent full-state pushes for active task updates.

The full state can still include `clineMessages`, but active execution should mostly ride on deltas.

### Tests

- [x] Unit test: message add/update/delete produces correct delta shape
- [x] Unit test: sequence ordering rejects or resyncs stale/missing deltas
- [ ] Webview test: applying deltas yields the same final UI state as a full snapshot
- [ ] Integration test: task execution with streaming text/tool updates works with delta transport enabled
- [ ] Regression test: reopening/resubscribing still hydrates from full state correctly

---

## Phase 5 — Reduce Webview Render Churn

### Goal

Transport improvements alone are not enough if the webview still performs expensive reconciliation on every small update. The mental model here is: **we want the frontend to patch the smallest possible UI surface, especially for the active streaming row**.

- [ ] Audit React render behavior for active streaming messages
- [ ] Ensure partial text updates overwrite in place rather than causing broader list churn
- [ ] Reduce expensive derived computations on every incremental update
- [ ] Add memoization and stable references where beneficial

### Code changes

#### 5.1 Audit `ExtensionStateContext` update behavior

In `webview-ui/src/context/ExtensionStateContext.tsx`:

- examine where full state merges replace large arrays/objects,
- ensure delta/partial paths do the minimum necessary mutation via state replacement patterns.

Current behavior already patches the last matching message by `ts` for partial updates. Preserve this model and make it the standard for all active task deltas.

#### 5.2 Ensure active message row is the primary repaint target

In chat list rendering components (for example `ChatView` and related rows):

- make sure the active partial message updates do not cause avoidable re-renders of unrelated rows,
- add memoization around row components if not already present,
- keep keys stable and avoid replacing the entire messages array unnecessarily in hot paths.

#### 5.3 Reduce repeated expensive derivations

Components such as request rows, grouped tool rows, and task headers may derive substantial state from the whole `clineMessages` array.

Audit components such as:

- `webview-ui/src/components/chat/RequestStartRow.tsx`
- task header components
- any grouping/aggregation helpers used on every render

Refactor to:

- memoize by relevant slices,
- move repeated scans into selectors,
- avoid recomputing expensive groupings when only the current active row changed.

### Tests

- [ ] Webview test: partial text updates only rerender the active message row (or as few components as practical)
- [ ] Regression test: no flicker during partial→complete transition
- [ ] Regression test: tool rows still group/render correctly under coalesced updates

---

## Phase 6 — Throttle Usage and Metadata Updates Separately from Text Streaming

### Goal

Token/cost counters and request metadata do not need to update at text-stream cadence. The mental model is: **the user watches the answer, not the token counter**. This phase reduces low-value churn without sacrificing correctness.

- [x] Batch usage/token/cost updates on a slower cadence
- [x] Flush final usage data immediately when a request ends
- [x] Keep telemetry capture decoupled from UI update cadence

### Code changes

#### 6.1 Decouple UI update cadence from telemetry capture cadence

In `src/core/task/index.ts` near `queueUsageChunkSideEffects(...)`:

- keep internal metrics accumulation immediate,
- continue recording telemetry as appropriate,
- but do not call `postStateToWebview()` for every usage chunk.

Instead:

- update the UI on a slower schedule (for example 250–500ms),
- always flush final metrics on request completion/abort.

#### 6.2 Publish lightweight request-metadata deltas

If Phase 4 is implemented, use `api_request_updated` deltas rather than full-state pushes for these metrics.

If Phase 4 is not yet implemented, at minimum route metrics through the controller-level coalescer from Phase 3.

### Tests

- [ ] Unit test: many usage chunks produce fewer UI updates than chunk count
- [ ] Integration test: final displayed token/cost values remain accurate at request completion
- [ ] Regression test: retry/cancel/error flows still show correct request metadata

---

## Phase 7 — Reduce Hostbridge and Environment-Detail Overhead at Request Boundaries

### Goal

Not all latency comes from streaming. Some comes from request setup, environment detail gathering, open-tab queries, and terminal state inspection. The mental model here is: **request boundaries should avoid recomputing or refetching unchanged data**.

- [ ] Audit request-boundary hostbridge calls
- [x] Cache visible/open tab data with a short TTL
- [x] Cache or coalesce terminal-state inspections where safe
- [x] Avoid redundant expensive environment-detail reconstruction

### Code changes

#### 7.1 Cache tab queries briefly

In the hostbridge/window integration path:

- `src/hosts/vscode/hostbridge/window/getVisibleTabs.ts`
- `src/hosts/vscode/hostbridge/window/getOpenTabs.ts`

or in the task/controller layer that consumes them:

- add a short-lived cache (e.g. 250–1000ms),
- invalidate on known tab-change events if such hooks are available,
- avoid repeated identical calls within one request-setup window.

#### 7.2 Audit `getEnvironmentDetails(...)`

In `src/core/task/index.ts`:

- identify repeated expensive sections,
- cache/reuse values that do not change materially within a short time,
- avoid unnecessary terminal cooling waits if there is no relevant terminal activity.

#### 7.3 Avoid full file-list regeneration when not needed

The code already avoids expensive file listing except when `includeFileDetails` is true. Preserve that behavior and further document it. If additional optimizations are needed, consider memoizing recent file-list snapshots per cwd for the duration of a task turn.

### Tests

- [ ] Unit test: repeated tab/environment requests within TTL reuse cached values
- [ ] Integration test: environment details still reflect fresh changes after invalidation/TTL expiry
- [ ] Regression test: open/visible tabs remain accurate enough for prompt quality

---

## Phase 8 — Remote-Aware Policy and Configuration

### Goal

Different environments deserve different tuning. The mental model here is: **remote mode is a different performance envelope, so the product should adapt rather than relying on one-size-fits-all behavior**.

- [x] Detect remote execution context reliably
- [x] Add remote-aware defaults for presentation/state-update cadence
- [x] Expose internal config flags for development and staged rollout
- [ ] Decide whether any user-facing settings are appropriate

### Code changes

#### 8.1 Establish remote-context detection

Decide on the most reliable source of truth for remote-vs-local execution. Candidate sources include host version/environment metadata already available through `HostProvider.env.getHostVersion({})` or VS Code host APIs.

Normalize this into a helper so the rest of the codebase can ask one question such as:

```ts
isRemoteWorkspaceEnvironment(): boolean
```

#### 8.2 Tune scheduler defaults based on remote context

Apply remote-aware cadence in:

- `TaskPresentationScheduler`
- controller state-update coalescer
- usage/metadata UI update cadence
- optional safety-flush intervals if needed

#### 8.3 Add development flags

Use internal settings, feature flags, or env vars to control rollout, for example:

- enable/disable presentation scheduler,
- enable/disable ephemeral partial persistence,
- enable/disable delta sync,
- override cadence intervals.

This is important for safe rollout and A/B comparison.

### Tests

- [ ] Unit test: remote detection helper behaves correctly for representative host metadata
- [ ] Unit test: cadence selection changes in remote mode
- [ ] Integration test: remote-mode config path enables the intended scheduler defaults

---

## Phase 9 — Rollout and Safety Strategy

### Goal

These changes touch the hottest and most stateful part of task execution. The mental model here is: **performance work must be staged so that correctness is preserved while the architecture evolves**.

- [ ] Roll out in small phases behind feature flags
- [ ] Compare telemetry between old and new paths
- [ ] Add fallback/resync paths for delta-sync failures
- [ ] Prepare debugging aids for support and dogfooding

### Rollout order recommendation

1. **Instrumentation only**
2. **Presentation scheduler**
3. **Ephemeral partial persistence split**
4. **Controller full-state coalescing**
5. **Usage/metadata throttling**
6. **Frontend render optimizations**
7. **Delta sync for active task execution**
8. **Request-boundary hostbridge caching**

The reason for this order is that the early steps are high-value and lower risk, while delta sync is the largest architectural change and should be done only after the team has visibility and confidence.

### Telemetry comparisons to monitor during rollout

- [ ] average `presentAssistantMessage()` invocations per request
- [ ] average partial message events per request
- [ ] average `postStateToWebview()` calls per request
- [ ] average serialized full-state payload size
- [ ] average persistence time per request
- [ ] median and p95 chunk-to-visible-update time
- [ ] median and p95 task initialization/request-start latency
- [ ] regression indicators: cancellation failures, resume failures, message ordering issues

### Debugging and support aids

- [ ] Add optional debug logging for scheduler flush/coalescing behavior
- [ ] Add optional debug counters in webview devtools for delta/full-state application counts
- [ ] Add a forced full-resync mechanism if delta state diverges

---

## Detailed File-by-File Implementation Map

This section gives a practical map of the files most likely to change and what each change should do.

### Backend / extension host
- [x] `src/core/task/index.ts`
  - Introduce presentation scheduling hooks
  - Replace direct hot-path presentation awaits
  - Separate semantic-boundary flushes from normal streaming cadence
  - Reduce usage-metadata UI push frequency

- [x] `src/core/task/message-state.ts`
  - Add ephemeral mutation APIs
  - Add dirty tracking and explicit flush behavior
  - Preserve mutex correctness

- [x] `src/core/task/TaskState.ts`
  - Add any scheduler/config/metrics state needed

- [x] `src/core/task/TaskPresentationScheduler.ts` (new)
  - Implement coalesced assistant presentation scheduling

- [x] `src/core/controller/index.ts`
  - Add state-update coalescer
  - Differentiate immediate vs coalesced state flushes

- [x] `src/core/controller/state/subscribeToState.ts`
  - Extend payload/frequency instrumentation
  - Potentially support lighter-weight state categories if needed later

- [x] `src/core/controller/ui/subscribeToPartialMessage.ts`
  - Add payload/frequency instrumentation
  - Potentially evolve into or complement broader delta transport

- [x] `src/core/controller/ui/subscribeToTaskUiDeltas.ts` (new, later phase)
  - Streaming task UI delta subscription channel

- [x] `src/shared/TaskUiDelta.ts` (new, later phase)
  - Delta type definitions and versioning model

- [ ] `src/hosts/vscode/hostbridge/window/getVisibleTabs.ts`
  - Add optional caching/invalidation if implemented in host layer

- [ ] `src/hosts/vscode/hostbridge/window/getOpenTabs.ts`
  - Add optional caching/invalidation if implemented in host layer

### Webview / frontend

- [x] `webview-ui/src/context/ExtensionStateContext.tsx`
  - Continue handling full state snapshots
  - Add delta subscription path
  - Apply partial/delta updates with minimal state churn

- [ ] `webview-ui/src/components/chat/RequestStartRow.tsx`
  - Optimize expensive recomputation on active request updates

- [ ] `webview-ui/src/App.tsx` / `ChatView` and related chat row components
  - Audit rerender boundaries
  - Memoize rows/selectors where useful

- [ ] Any shared message-grouping or selector utilities used during chat rendering
  - Extract and memoize repeated scans over the full message list

---

## Test Plan Summary

Below is a consolidated development checklist for tests. This can be used as a progress tracker during implementation.

### Backend tests

- [x] Scheduler unit tests with fake timers
- [x] MessageStateHandler ephemeral-vs-durable mutation tests
- [x] Coalesced controller state-posting tests
- [ ] Usage/metadata throttling tests
- [x] Remote-mode cadence selection tests
- [ ] Hostbridge/environment TTL caching tests

### Integration tests

- [ ] Streaming text request produces fewer presentation flushes than chunks
- [ ] Native tool calling request preserves correct tool execution behavior under coalesced presentation
- [ ] Abort/cancel during stream preserves recoverable task state
- [ ] Resume from history still works after deferred partial persistence
- [ ] Full state and delta state converge to the same result

### Frontend tests

- [ ] Partial message update patches active row correctly
- [ ] Partial→complete transition does not flicker
- [ ] Delta events update chat state correctly in order
- [ ] Full snapshot resync repairs intentionally diverged state

### Performance/regression validation

- [ ] Benchmark before/after counts for `presentAssistantMessage()`
- [ ] Benchmark before/after counts for `postStateToWebview()`
- [ ] Benchmark before/after persistence latency
- [ ] Benchmark before/after full-state payload sizes
- [ ] Benchmark before/after perceived streaming smoothness in remote mode

---

## Recommended First Milestone

If the team wants the fastest path to meaningful improvement, the first milestone should include only the highest-ROI, lowest-risk work:

- [x] Add instrumentation
- [x] Implement `TaskPresentationScheduler`
- [x] Convert partial streaming updates to ephemeral message mutations
- [x] Add controller-level `postStateToWebview()` coalescing
- [ ] Add tests and collect before/after telemetry

### Why this milestone first?

This milestone addresses the main latency amplifier without requiring a full transport redesign. It should materially improve remote responsiveness by reducing the number of times Cline:

- enters the presentation path,
- persists partial streaming state,
- serializes and transports full snapshots.

It also lays the foundation for later delta-sync work because once the hot path is decoupled, it becomes much easier to evolve transport behavior safely.

---

## Developer Mental Model Recap

When implementing this plan, keep the following model in your head:

- **The provider stream is not the UI clock.** Let the model emit chunks freely.
- **The UI should repaint at a deliberate cadence.** Fast enough to feel live, slow enough to avoid thrash.
- **Persistence is a safety boundary, not an animation system.** Save when the state becomes meaningfully durable.
- **Full state is for hydration and recovery.** Deltas are for active execution.
- **Remote mode magnifies every unnecessary snapshot and every synchronous save.** Favor coalescing, patching, and deferred durability.

If the implementation consistently follows those ideas, Cline should feel substantially more responsive in remote workspace scenarios while preserving correctness and recoverability.