# SDK → Webview message & status pipeline — design

This document explains a class of repeated bugs in the layer that translates SDK session
events into webview messages ("Thinking" missing or stuck, the last message disappearing,
duplicated tool rows, vanishing approval buttons), the two root causes, and a robust
redesign with no hacks. It ends with the test plan.

A longer investigation log with the original live captures is preserved at the end under
"Appendix: evidence".

---

## 1. Symptoms

- "Thinking…" is shown forever, or never shows.
- The model's final message disappears; the task looks stuck.
- A tool/command row renders two or three times.
- Approve/Reject (or Run Command) buttons vanish, or the footer and the buttons disagree
  (footer says "Thinking", buttons say "Run Command").

All were reproduced deterministically (see appendix), so this is a structural defect, not a
flaky model.

## 2. Two root causes

### RC1 — UI mode is inferred from the message array's tail (order-sensitive)
The webview decides "thinking vs approving vs done" and which buttons to show by inspecting
the *last* element(s) of a flat `ClineMessage[]`:
- `MessagesArea.isWaitingForResponse` keys off `clineMessages.at(-1)`.
- `buttonConfig.getButtonConfigForMessages` walks backward over an "inert" skip-list.

The backend appends bookkeeping (`say:api_req_started` usage rows) *after* content and even
*after* approval asks, and streams text *after* a completion. So the tail routinely does not
mean what the UI assumes. The two webview heuristics use different rules on the same array,
so a single trailing bookkeeping row can drive them into mutual contradiction. The translator
compensates with "this ask must be emitted last" hacks; lose that ordering (cancel, error,
one extra event) and the UI sticks.

### RC2 — Two unsynchronized delivery channels, with wholesale replacement (timing-sensitive)
The same conversation reaches the webview by two independent gRPC streams with no ordering
between them:
- `subscribeToPartialMessage` — incremental: add/update one message.
- `subscribeToState` — wholesale: replaces `clineMessages` from a full snapshot
  (`ExtensionStateContext`, the `// HACK: Preserve clineMessages if currentTaskItem is the
  same` block).

At turn end the backend fires several `postStateToWebview()` calls concurrently and
un-awaited, racing the partial stream. A state snapshot captured a moment before the final
message was appended can resolve last and clobber the correct array — the last message
vanishes, the tail reverts to a non-terminal row, and the UI sticks.

Both causes share one disease: **global UI state is reconstructed from a flat, append-ordered
array delivered over two racy channels.**


---

## 3. Design principles

1. **One explicit status, not tail inference.** UI mode is read from a single backend-owned
   field, never from `array.at(-1)` or a skip-list.
2. **The transcript is a pure log.** The order of `clineMessages` carries no control meaning.
   Appending bookkeeping after an ask, or text after a completion, changes nothing.
3. **The webview is a convergent replica.** Delivery is fire-and-forget and unreliable
   (a webview can be hidden, reloaded, or closed). Correctness must not depend on any single
   message arriving; the webview converges to the correct state from whatever it receives.
4. **Delete hacks, don't add them.** The redesign removes the "must-be-last" ask emission, the
   mistake-limit session-abort, the inert skip-list walk, and the wholesale-replace block.

## 4. Data model

Three small, in-memory-only quantities. None are persisted — on disk the SDK stores only LLM
messages (no ids); `ClineMessage`s (and their ids) are regenerated on every load.

- **`id`** — message identity / merge key. Replaces today's `ts`, which was a timestamp only by
  origin and is really used as an id. Minted by a single process-wide monotonic counter
  (`MessageIdMinter`), shared by live translation *and* history rendering, so ids are globally
  unique within a process and never collide. A streaming item keeps one `id` across its
  partial → final updates (and, for a tool, across content_start → approval → content_end).
- **`seq`** — freshness. A global monotonic counter, stamped synchronously in the extension at
  the moment a message is minted/updated and at the moment a state snapshot is taken. Resolves
  "two copies of the same `id` — which is newer". (`stateVersion` on a state push is the same
  counter sampled at snapshot time.)
- **`epoch`** — the reset fence. One integer, bumped synchronously at conversation/replica
  boundaries (the existing `resetMessageTranslator()` sites, plus cancel — see §4.2). Fences off
  all traffic from a previous task or a previous render of the same task.

`turnState` (below) and these three quantities ride inside the existing `state_json`
(`ExtensionState`); no proto change is required. (Optionally the partial-message envelope's
already-present, unused `sequence_number` field can carry `seq`/`epoch`.)

### 4.1 Where the counters live (the id/seq/epoch authority)

All three counters are owned by **one process-wide authority in the extension**, the natural
home being the singleton `MessageTranslatorState` that `SdkController` already constructs once
(`private messageTranslatorState = new MessageTranslatorState()`) and passes to every
coordinator. We extend it (or factor a small `MessageIdMinter` it holds) with:

```ts
class MessageIdMinter {
  private idCounter = 0     // pure ++; identity. seeded once; never reads the clock
  private seqCounter = 0    // pure ++; freshness; also sampled as stateVersion at snapshots
  private epochCounter = 0  // bumped only at conversation boundaries (§4.2)

  nextId(): number   { return ++this.idCounter }
  nextSeq(): number  { return ++this.seqCounter }   // call at every mint/update AND snapshot
  bumpEpoch(): number { return ++this.epochCounter }
  get epoch(): number { return this.epochCounter }
}
```

Rules:
- There is exactly ONE minter per extension process. Live translation, the interaction
  coordinator (tool-approval / ask_question / user_feedback), and history rendering
  (`sdkMessagesToClineMessages`) all draw ids/seqs from it — so nothing mints ids independently
  (today the interaction coordinator and history each have their own `Date.now()`-based path;
  those are removed and routed through the minter).
- `nextSeq()` is called synchronously at the point a message is created/updated and at the point
  a state snapshot is assembled, before any `await`. Because the extension is single-threaded,
  this yields a total order matching causal order, independent of delivery timing.
- `history rendering must NOT new up its own state` — it receives the shared minter so
  regenerated history ids are strictly greater than (and never overlap) live ids in the process.
- The in-translator `MessageTranslatorState.reset()` at `iteration_start` clears only the
  *streaming pointers* (which open text/tool id is current). It must NOT touch idCounter,
  seqCounter, or epochCounter — iteration_start is mid-turn, same conversation.

### 4.2 Epoch transitions (what bumps the fence)

`epoch` bumps once per **conversation/replica boundary**, synchronously, BEFORE the new state
is pushed. These are exactly the existing `resetMessageTranslator()` call sites, plus cancel:

| Transition                                              | Call site                              |
|---------------------------------------------------------|----------------------------------------|
| Start / clear a task                                    | `clearTask` (task-control)             |
| Open a task from history                                | `showTaskWithId` (task-control)        |
| Resume / reinit an existing task                        | `reinitExistingTaskFromId` (task-start)|
| Plan/Act mode rebuild that swaps the session            | mode-coordinator (rebuild path)        |
| Follow-up that starts a new session                     | followup-coordinator (new-session path)|
| Cancel                                                  | `cancelTask` (task-control) — §7       |

It does NOT bump on (these are same-conversation, mid-turn):
- `iteration_start` / `content_*` streaming (in-translator `state.reset()` only).
- a follow-up that continues an already-running session (no `resetMessageTranslator`).
- a usage/bookkeeping event.

Implementation note: co-locate `minter.bumpEpoch()` with each `resetMessageTranslator()` call
(they mark the same boundary), and add the one extra bump in `cancelTask` before `abort()`.

already-present, unused `sequence_number` field can carry `seq`/`epoch`.)

### `turnState` — the single source of UI truth
```ts
export type TurnPhase =
  | "idle"               // no active turn; input enabled, no buttons
  | "streaming"          // model producing content / tool running; Thinking + Cancel
  | "awaiting_approval"  // a tool/command/mcp/subagent approval is pending
  | "awaiting_followup"  // ask_question / plan_mode_respond / done-without-completion
  | "completed"          // attempt_completion done; Start New Task
  | "error"              // api_req_failed / fatal; Retry / recovery
  | "resumable"          // task cancelled / interrupted; Resume Task

export interface TurnState {
  phase: TurnPhase
  anchorId?: number   // id of the message this phase is "about" (the pending ask, etc.)
  seq: number         // webview keeps the highest-seq TurnState, ignores older
}

---

## 5. Backend behavior

The backend drives the SDK session and owns every interaction promise, so it always knows the
true phase. It sets `turnState` at the exact lifecycle point where the fact becomes known:

| Lifecycle point                                            | phase             |
|------------------------------------------------------------|-------------------|
| initTask / iteration_start / content_* streaming           | streaming         |
| handleRequestToolApproval (before awaiting the user)       | awaiting_approval |
| handleAskQuestion / plan_mode_respond ask emitted          | awaiting_followup |
| done, reason=completed, attempt_completion was used        | completed         |
| done, reason=completed, no attempt_completion              | awaiting_followup |
| error / api_req_failed / mistake_limit                     | error             |
| cancelTask                                                 | resumable         |
| user answered / approved (resolvePending*)                 | streaming         |
| session ended / cleared                                    | idle              |

Consequences for the translator (all are deletions):
- `done` no longer emits a synthetic "must-be-last" `ask:completion_result`. completed and
  "done-without-completion" are just phases.
- `mistake_limit` sets `phase=error`; the forced `sdkHost.abort()` whose only purpose was to
  keep the ask in the last slot is removed (stopping the loop can still happen on its own
  merits).
- `ask_question` (and any tool serviced by an interaction coordinator) is suppressed from the
  generic `say:tool` renderer, exactly as the CLI already does. This removes the orphan
  partial `say:tool` row.
- A tool call uses ONE `id` across content_start, the approval ask, and content_end, so the
  webview renders a single row that morphs partial → approval → final (no duplicates).

Delivery is fire-and-forget:
- Never `await` a post to the webview in the emit path (today the emit loops `await`, which can
  stall the turn on a hidden/unloaded webview). Fire and swallow errors.
- Stamp every message and every state snapshot with the current `seq` and `epoch`
  synchronously, before any await.

Usage/cost is exempt from the fence (see §7).

## 6. Webview reducer (the convergent merge)

The webview holds `{ epoch, byId: Map<id, ClineMessage>, order: id[], turnState }`. Every
incoming partial message or state snapshot carries `epoch` and per-message `seq`. The reducer
is pure and total — it produces correct output under any arrival order, duplication, or loss.

```
applyMessage(incoming):                      # one ClineMessage from either channel
  if incoming.epoch < state.epoch:  return state          # stale: from an old task/render
  if incoming.epoch > state.epoch:  resetTo(incoming.epoch)   # new task/render: fresh replica
  existing = state.byId.get(incoming.id)
  if existing && existing.seq >= incoming.seq: return state   # older copy: ignore
  upsert(incoming)                                            # add or replace in place
  return state

applyStateSnapshot(snapshot):                # full ExtensionState from subscribeToState
  if snapshot.epoch < state.epoch:  return state
  if snapshot.epoch > state.epoch:  resetTo(snapshot.epoch); replaceAllFrom(snapshot)
  else: for m in snapshot.clineMessages: applyMessage(m)      # merge, never truncate
  if snapshot.turnState.seq > state.turnState.seq: state.turnState = snapshot.turnState
  return state

applyTurnState(ts):
  if ts.seq > state.turnState.seq: state.turnState = ts
```

Key invariants:
- **Gate on `epoch` only.** `taskId` is no longer a gate (it's display data); `epoch` subsumes
  it and also fences same-task re-renders that `taskId` cannot distinguish.
- **Within an epoch, merge by `id`, keep highest `seq`.** A same-epoch snapshot may add or
  update rows but may NEVER shrink the transcript.
- **`turnState` only moves forward by `seq`.** A late "streaming" can never overwrite a newer
  "completed".
- **History load = new epoch ⇒ replace.** History is delivered as one full snapshot at a fresh
  epoch (never streamed as partials), so the replica resets cleanly.

## 7. Cancel

`sdkHost.abort()` is cooperative; the SDK may emit a few more events after it. Order matters:

1. Synchronously: `epoch++`, set `turnState.phase = "resumable"`, mark the turn `cancelled`,
   and push that state at the new epoch.
2. Then call `sdkHost.abort()`.

Because the fence is raised before the abort, every straggler the SDK emits afterward carries
the old epoch and is dropped by the reducer — it cannot append a row, move the tail, or flip
the phase. The brittle "filter these two ask types but not says" rule is replaced by "if the
turn is cancelled, suppress its remaining display output."

Usage is the one exception: a post-cancel `usage` event reflects tokens the provider really
generated, so it still updates the task's cost. To stay idempotent under stragglers and
retries, prefer setting cost from the SDK's authoritative session `totals` rather than adding
deltas. Usage accounting is therefore exempt from the epoch/cancelled message fence.

## 8. SDK boundary (why our ids are safe)

Our `id`/`seq`/`epoch` are extension-private. We send the SDK only `{ sessionId, prompt,
images, files }`; the SDK never sees, stores, or echoes our ids. Request↔response correlation
is by `sessionId` (turn) and the SDK's own `toolCallId` (tool call ↔ result). Three decoupled
namespaces: `sessionId`, `toolCallId` (SDK-owned), `id` (ours). We have unilateral control over
id minting, with no reconciliation against the SDK.


---

## 9. Testing

The goal is high confidence that the reducer is correct **under any message arrival ordering**.
The reducer is a pure function over `(state, event) → state`, which makes this directly and
exhaustively testable as plain unit tests — no webview, no gRPC, no timers.

### 9.1 Reducer unit tests (the core confidence)
Extract the merge logic (`applyMessage` / `applyStateSnapshot` / `applyTurnState`) into a pure
module with no React/gRPC dependencies, and test it directly.

Deterministic cases (each a fixed sequence with an asserted final state):
- partial → final by same `id` updates in place (length stays 1; `partial` ends false).
- a lower-`seq` copy of an existing `id` is ignored.
- a same-epoch snapshot that omits the last message does NOT shrink the transcript
  (reproduces RC2 / "last message missing": result must keep the message).
- a snapshot with a higher `epoch` replaces wholesale and resets the seq highwater.
- a message/snapshot with a lower `epoch` is dropped (straggler from a prior task/render).
- `turnState` with a lower `seq` never overwrites a newer one (late "streaming" after
  "completed" is ignored).
- a trailing bookkeeping row after an `awaiting_approval` turnState does not change the phase
  (reproduces RC1 / vanishing buttons at the data layer).

Order-independence (property-based): given a fixed *causal* event log (each event carrying its
`epoch`/`id`/`seq` as the extension stamped them), assert that **every permutation of delivery
order, with arbitrary duplication and arbitrary drops of non-final messages, converges to the
same final state** as the in-order, no-loss delivery.
- Use `fast-check` (or an explicit permutation generator for small logs) to shuffle, duplicate,
  and drop events.
- The oracle: apply the log in causal order with no loss → that is the canonical state. Any
  delivery schedule that does not drop the *final* copy of any `id` must equal it; schedules
  that drop a final copy must still equal it after a final full-snapshot reconcile (model the
  reconcile as one more event = the canonical full state at the latest epoch).
- This is the test that gives us confidence the system "can't get stuck" regardless of timing.

### 9.2 Backend translator unit tests
- `ask_question` content_start/end emits no `say:tool` row.
- one tool call (content_start + approval ask + content_end) yields exactly one `id`/row.
- `done` emits no synthetic ask; the coordinator sets `phase` (completed vs awaiting_followup).
- `MessageIdMinter` is monotonic and shared: live + history rendering never produce overlapping
  ids; a history render after live activity yields ids strictly greater than the live ones.
- `seq`/`epoch` are stamped synchronously before any await (assert via a minter spy).

### 9.3 Backend coordinator unit tests
- cancel: epoch is bumped and `phase=resumable` is set BEFORE `abort()` is called (assert call
  order); a session event delivered after cancel for the cancelled turn produces no display
  messages but still applies usage.
- mistake_limit: sets `phase=error`; no forced abort-for-ordering remains.
- usage accounting is idempotent: replaying the same usage event (or a post-cancel straggler)
  does not double-count (cost set from totals, not added).

### 9.4 Webview rendering unit tests (thin, on top of the reducer)
- footer "Thinking" iff `turnState.phase === "streaming"`.
- button set is chosen by `phase`; label/variant comes from the `anchorId` message.
- These assert that rendering reads `turnState`, never `array.at(-1)` — guard against
  regressions back into tail inference.

### 9.5 End-to-end smoke (debug harness, manual / CI-optional)
Re-run the two on-camera reproductions and the cancel path:
- inject a stale (shorter) state snapshot at the same epoch → transcript must NOT shrink
  (was RC2 stuck-Thinking).
- append a trailing `api_req_started` after an approval → buttons and footer stay consistent
  (was RC1 contradiction).
- cancel mid-stream → lands on Resume Task, no stuck Thinking, stragglers ignored.

## 10. Rollout

Each step is independently shippable and re-verified against the reproductions.

- S1. Single `MessageIdMinter` (pure monotonic, shared by live translation + interaction
      coordinator + history). DONE: removed the translator `tsCounter` and the interaction
      coordinator's `Date.now()`-based `lastInteractionMessageTs`; both now mint from the shared
      minter, wired via `MessageTranslatorState.getMinter()`. (Field is still named `ts` on
      `ClineMessage`; the rename to `id` is cosmetic and deferred.)
      REMAINING for S2: ~13 one-off `ts: Date.now()` mint sites in coordinators (error rows,
      mcp messages, resume/cancel asks, task-start) should also route through the shared minter
      when those coordinators are threaded for `seq`/`epoch` stamping. They are low-frequency
      boundary messages, but collision-safety wants them on the one counter too.
- S2. `seq` + `epoch` stamping in the extension; fire-and-forget delivery (stop awaiting posts).
      DONE: SdkMessageCoordinator stamps seq/epoch on every message; getStateToPostToWebview
      stamps stateVersion/epoch; epoch bumps via resetMessageTranslatorAndFence() at the reset
      sites; ClineMessage proto + ExtensionState carry the fields; sendPartialMessageEvent /
      sendStateUpdate no longer await postMessage. (Cancel's epoch bump is folded into S6.)
- S3. Webview reducer: gate on `epoch`, merge by `id`/`seq`, drop the wholesale-replace `// HACK`.
      DONE: messageReducer.ts (pure applyMessage/applyStateSnapshot) wired into
      ExtensionStateContext for both channels; 120-permutation order-independence test proves
      convergence under any arrival order/duplication/loss. → fixes RC2 ("last message missing").
- S4. `turnState` type + backend transitions, shipped in `state_json` (additive).
- S5. Webview footer + buttons read `turnState` (delete `isWaitingForResponse` tail inference and
      the inert skip-list walk). → fixes RC1. Re-verify with the trailing-bookkeeping injection.
- S6. Cancel: fence-before-abort; usage exemption; replace the ask-only filter.
- S7. Translator hygiene: suppress `ask_question` `say:tool`; one-`id` tool calls; remove the
      `done` synthetic ask and the mistake-limit abort.
- S8. Full live pass: plan ask_question, act command approval, attempt_completion, cancel
      mid-stream, api error — confirm no stuck states.

---

## Appendix: evidence

The original investigation log — live debug-harness captures and the two deterministic
reproductions (screenshots) that established RC1 and RC2 — is preserved in
`webview-message-state-findings.md` alongside this file.

