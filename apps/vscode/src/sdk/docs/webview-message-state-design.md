# SDK → Webview message & status pipeline

This is reference documentation for how SDK session events are translated into the webview's
conversation transcript and UI state. It explains the architecture, the invariants that keep
the UI from getting stuck, and how to extend or debug it.

Historically this layer produced a class of repeated bugs — "Thinking" missing or stuck, the
last message disappearing, duplicated tool rows, vanishing/contradictory approval buttons.
§1–§2 describe those symptoms and their two root causes; §3–§8 describe the architecture that
fixes them; §9 is the test strategy; §10 records implementation status; §11 is a debugging
log of regressions found and how they were chased down. The original live investigation
captures are in `webview-message-state-findings.md` next to this file.

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

## 10. Implementation map

The architecture above is implemented across these pieces. This section is a map from concept
to code, so a future reader can find and extend each part.

| Concern | Where it lives |
|---|---|
| `id`/`seq`/`epoch` authority | `apps/vscode/src/sdk/message-id-minter.ts` (one process-wide `MessageIdMinter`, owned by `MessageTranslatorState`, shared by live translation, the interaction coordinator, and history rendering) |
| seq/epoch stamping on messages | `SdkMessageCoordinator` stamps every message flowing to the webview |
| stateVersion/epoch stamping on snapshots | `SdkController.getStateToPostToWebview()` |
| epoch bumps (the fence) | `SdkController.resetMessageTranslatorAndFence()` wired into the `resetMessageTranslator` callback sites (clear, show-from-history, reinit, mode rebuild, new-session follow-up); cancel bumps via `raiseCancelFence` (§7) |
| fire-and-forget delivery | `sendPartialMessageEvent` / `sendStateUpdate` do not await `postMessage` |
| convergent reducer | `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts` (`applyMessage`/`applyStateSnapshot`), wired into `ExtensionStateContext` for both channels |
| `turnState` type | `shared/ExtensionMessage.ts` (`TurnPhase`, `TurnState`, `ExtensionState.turnState`) |
| `turnState` transitions | `apps/vscode/src/sdk/turn-state-tracker.ts` + the call sites in `SdkController` (streaming/error/resumable/idle), `SdkInteractionCoordinator` (awaiting_approval/awaiting_followup/back-to-streaming), and `SdkSessionEventCoordinator` (completed vs awaiting_followup on turn end) |
| footer + buttons read `turnState` | `buttonConfig.buttonsForPhase` / `getButtonConfigFromState` (used by `ActionButtons`); `MessagesArea.isWaitingForResponse` short-circuits on `phase === "streaming"` |
| translator hygiene | `message-translator.ts` suppresses `ask_question`/`ask_followup_question` from the generic tool renderer; the `done` handler emits no synthetic ask |
| cancel fence | `SdkTaskControlCoordinator.cancelTask` calls `raiseCancelFence()` before `sdkHost.abort()` |

Known follow-ups / deliberate exceptions:
- The `ClineMessage` field is still named `ts`; it is used as an identity/merge key. Renaming to
  `id` is cosmetic and deferred.
- The interaction-coordinator approval ask still mints its own id rather than reusing the
  streaming tool row's id, so a tool that requires approval can render as two rows. Collapsing
  them needs cross-coordinator id threading (deferred).
- The legacy tail heuristics (`getButtonConfigForMessages` + `isInertStatusMessage`, the
  `isWaitingForResponse` tail inference, the `!isRunning` ask filter) remain as the fallback for
  when `turnState` is absent (classic/older state); they can be removed once classic is retired.
- The persisted-history renderer (`sdkMessagesToClineMessages`) still appends a trailing
  `ask:completion_result` so a reopened task shows the resume affordance — intentional.

---

## 11. Debugging log

A running log of regressions found in this layer and how they were chased down. The discipline
is always: **(1) observe live, (2) replicate with a unit test, (3) only then fix** — so every
fix is anchored to a reproduction that would have caught it.

### 2026-06 — regressions after the TurnState cutover (§4–§7)

Two regressions reported after wiring the webview to read `turnState` (§5) and removing the
`done` synthetic ask (§7). Both are accidental, not intended.

**Symptom A — no Cancel button during generation.** During a turn the footer shows only the
scroll up/down arrow, not "Cancel". The scroll-arrow branch in `ActionButtons` renders when
`buttonConfig` has no primary/secondary text, i.e. `BUTTON_CONFIGS.default`. `buttonsForPhase`
returns `default` only for `phase === "idle"`. So during generation the webview's
`turnState.phase` is `idle` (or `turnState` is stale), not `streaming`.

**Symptom B — Enter after a completed task starts a NEW task** instead of continuing the
conversation. In `useMessageHandlers.handleSendMessage` the routing is: `messages.length === 0`
→ `newTask()`; else if `clineAsk` → `askResponse()`; else if running → interrupt; else nothing.
For `newTask()` to fire, the webview's `clineMessages` must be **empty**.

**Theories (confirmed by reading the code; see Resolution for the unit tests that pin them):**

1. *Stale `turnState` clobber (most likely for A).* `turnState` rides inside the full state
   snapshot and is adopted wholesale in `ExtensionStateContext` (`newState = {...stateData}`)
   with **no seq gate** — unlike `clineMessages`, which the reducer gates by `stateVersion`/
   `seq`. So a late or lower-version snapshot carrying an older `turnState` (e.g. `idle`) can
   overwrite a newer `streaming`. The design says "TurnState only moves forward by seq" (§6)
   but that gate was **not implemented** in the webview — only the message merge was. This
   matches A: the webview briefly sees `streaming` then a stale snapshot reverts it to `idle`.

2. *Empty transcript via an epoch over-bump (most likely for B).* For Enter to start a new
   task, `clineMessages` must be empty. The reducer wholesale-**replaces** (and can reset to
   empty) when an incoming snapshot's `epoch` is greater than the local epoch. `epoch` is
   bumped by `resetMessageTranslatorAndFence()` at several lifecycle points and by
   `raiseCancelFence()`. If an epoch bump fires while a snapshot with an empty/partial
   transcript is in flight (e.g. during the clear→reload inside `initTask`, or a stray reset),
   the webview replaces its transcript with an empty one and never recovers → `messages.length
   === 0` → Enter routes to `newTask()`. Needs confirmation of exactly which bump + snapshot
   pairing produces the empty replace.

3. *Send-path still depends on the removed `done` ask (contributes to B regardless of #2).*
   §7 removed the trailing `ask:completion_result`, so after completion `clineAsk` is
   `undefined`. Even with a non-empty transcript, the `else if (clineAsk)` branch no longer
   fires, so a follow-up after completion is not routed to `askResponse`. The send path must be
   updated to consult `turnState` (e.g. continue the conversation when phase is
   `completed`/`awaiting_followup`) rather than relying on a trailing ask. This is a real
   coupling the TurnState cutover broke and must be fixed even if #2 is also true.

**Plan (observe → replicate → fix):**
1. **Observe live.** Rebuild + run the debug harness; with the message recorder, capture the
   exact `turnState`/`stateVersion`/`epoch`/`clineMessages.length` sequence during: a fresh
   turn (does phase reach and stay `streaming`?), and right after completion + Enter (is the
   transcript empty? what is `clineAsk`/`turnState`?). Confirm which theory holds.
2. **Replicate with unit tests.** Add failing tests at the smallest layer each bug lives in:
   - webview state-handler/reducer test: applying snapshots out of order must NOT revert
     `turnState` to an older phase (seq gate), and must NOT empty the transcript on a spurious
     epoch (A and B-#2);
   - send-routing test: a follow-up after `phase === "completed"` routes to `askResponse`, not
     `newTask` (B-#3).
3. **Only then fix**, guided by the failing tests: add the `turnState` seq gate in the webview;
   make the send path TurnState-aware; and correct any epoch over-bump found in step 1.

**Resolution (fixes landed; ⚠️ live verification still pending):**

Step 1 (observe live) could **not** be completed in the working environment: the debug harness
builds the extension fine but `_electron.launch()` fails immediately with "Process failed to
launch!" (Playwright never sees Electron's DevTools handshake line). The VSCode build is
complete and the binary runs standalone, so this is the documented macOS Playwright-launch
limitation, not a code/build issue. The theories were therefore confirmed by **reading the
code** rather than a live capture, and steps 2–3 were completed against deterministic tests.
The fixes still need a live pass on a machine where the harness can launch (see below).

Fixes:
- **A — `turnState` seq gate (`messageReducer.ts`).** `ReplicaState` now carries `turnState`;
  `applyTurnState()` keeps the highest-`seq` TurnState and ignores older ones; `applyStateSnapshot()`
  takes the snapshot's `turnState` and applies it through that gate (adopting it wholesale on a
  newer epoch). `ExtensionStateContext` feeds `stateData.turnState` into the reducer and reads the
  **gated** result back, so a late/stale snapshot can no longer revert `streaming` → `idle` and
  hide the Cancel button.
- **B-#2 — never empty a live transcript (`messageReducer.ts`).** `applyMessage`'s newer-epoch
  branch no longer resets the transcript to just the incoming message; it advances the fence while
  carrying the existing transcript forward and merging the new row. The authoritative wholesale
  replace for a genuine new task still comes from a newer-epoch full **snapshot**
  (`applyStateSnapshot`), so a lone newer-epoch *partial* (e.g. a bookkeeping `api_req_started`
  that raced ahead of its snapshot) can no longer strand the webview at `messages.length === 0`.
- **B-#3 — TurnState-aware send path (`useMessageHandlers.ts`).** When there is no `clineAsk`,
  the send path now also continues the conversation via `askResponse` (`messageResponse`) when
  `turnState.phase` is `completed` / `awaiting_followup` / `streaming`, instead of relying on the
  removed trailing `ask:completion_result`. An empty transcript still routes to `newTask()`.

Tests (all green; each was confirmed to fail before its fix):
- `messageReducer.test.ts` — turnState seq-gate cases (newer-seq advances; older-seq cannot
  revert; order-independent; newer epoch resets turnState) and transcript-never-emptied cases
  (empty same-epoch snapshot doesn't clear; lone newer-epoch partial doesn't discard).
- `hooks/useMessageHandlers.test.tsx` — follow-up after `completed`/`awaiting_followup` routes to
  `askResponse`, not `newTask`; empty transcript still starts a new task.

⚠️ **Still TODO (live):** run the debug harness on a machine where Electron launches and walk the
two reported flows end-to-end — (a) start a turn and confirm the footer shows Cancel for the whole
`streaming` phase; (b) after completion, type + Enter and confirm the conversation continues
(no new task) — capturing the `turnState`/`epoch`/`stateVersion`/`clineMessages.length` trace to
close out step 1.

### 2026-06 (follow-up) — live testing exposed the BACKEND phase bugs

A manual run of the first-round fixes surfaced that those were necessary but not sufficient: the
webview now *consumes* `turnState` correctly, but the backend was **emitting the wrong phase (or
not emitting at all)** at several lifecycle points. Observed: cancel → footer shows the scroll-arrow
default instead of Resume; resuming by sending kept the scroll-arrow state and blocked the send
button (stuck); a plain conversation that finished was stuck on scroll-arrows (though still
sendable). The scroll-arrow footer is `BUTTON_CONFIGS.default`, which `buttonsForPhase` returns only
for `phase === "idle"` — i.e. the webview's effective phase was wrong/stale in every case.

Root causes (all backend; confirmed by reading the SDK adapter):

1. **Turn end didn't push state when the event had no messages.** `SdkSessionEventCoordinator`
   set the terminal phase (`completed`/`awaiting_followup`/`error`) on `turnComplete`, but the
   `postStateToWebview()` call was gated on `result.messages.length > 0`. Since the `done` handler
   emits **no** transcript message (S7 removed the synthetic completion ask), a clean turn end
   produced zero messages → no state push → the webview never learned the turn ended and stayed on
   the prior phase. *Fix:* also post when `result.sessionEnded || result.turnComplete`.

2. **`askResponse` never set `streaming`.** `initTask`/`reinitExistingTaskFromId` set
   `phase = "streaming"`, but answering an ask / continuing after completion / resuming a cancelled
   task (all routed through `SdkController.askResponse`) did not. So the resumed turn ran with a
   stale non-streaming phase (no Cancel, send blocked). *Fix:* `askResponse` sets `streaming` before
   delegating, mirroring `initTask`.

3. **A post-cancel straggler clobbered `resumable`.** `cancelTask` sets `resumable`, but the SDK can
   emit a trailing `done`/`turnComplete` after the abort. That straggler hit the turn-end branch and
   overwrote `resumable` with `awaiting_followup`/`completed` → Resume button lost. *Fix:* at turn
   end, if the session is already `!isRunning` (i.e. cancelled), do not set a phase — leave the
   cancel-set `resumable` intact.

Tests added (each confirmed to fail first):
- `sdk-session-event-coordinator.test.ts` — posts state on a zero-message turn end; does NOT
  override phase on a turn-complete straggler from an already-cancelled (`!isRunning`) session.

⚠️ **Still TODO (live):** re-run the harness on a GUI-capable machine and confirm all four flows
end-to-end (cancel → Resume; resume → Cancel during the new turn → terminal buttons; plain finish →
Start New Task / followup; send-after-finish continues the conversation).

---

## Appendix: evidence

The original investigation log — live debug-harness captures and the two deterministic
reproductions (screenshots) that established RC1 and RC2 — is preserved in
`webview-message-state-findings.md` alongside this file.

