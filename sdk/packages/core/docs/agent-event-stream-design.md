# Agent event stream v2 — scoped frames, one assembler

Status: DRAFT for review. Nothing here is implemented.

## Problem

Every surface that renders an agent session (VSCode webview, CLI terminal,
CLI TUI, ACP, hub clients, desktop app) consumes the same underlying event
stream, but the stream's structure — which events form a block, which block
an update belongs to, how a turn ends — is not part of the contract. It is
re-derived by hand in each consumer as mutable parser state. The result is
five independent stream assemblers, each with its own ordering folklore,
its own straggler defenses, and its own bugs.

This document proposes: (1) a versioned frame schema that makes stream
structure explicit (scope addresses, sequence numbers, one spelling of every
lifecycle transition); (2) a single shared assembler ("demux") that parses
frames into typed object lifecycles, so consumers implement rendering only;
(3) validators and a trace generator derived from the same transition tables,
so malformed streams fail at the producer and translators are property-tested.

TypeScript is the first-class target. The schema is language-neutral JSON so
the Go consumers (core-platform) can generate types from it later, but no Go
work is in scope here.

## Specific problems this removes

Each claim names the code that exists today and what deletes it. These are
falsifiable; check the citations.

**P1 — Five hand-rolled assemblers.** Each of these maintains private state
whose only purpose is reconstructing stream structure:

| Consumer | Parser state | Lines |
|---|---|---|
| `apps/vscode/src/sdk/message-translator.ts` | `MessageTranslatorState`: `streamingTextTs`, `streamingToolTs`, `streamingToolInput`, `streamingToolName`, `openCompactionTs`, `pendingToolUses` | 2,799 |
| `apps/cli/src/utils/events.ts` | `activeInlineStream` mode variable | 357 |
| `apps/cli/src/tui/hooks/use-agent-events.ts` | per-toolCallId entry tracking | 438 |
| `apps/examples/desktop-app/webview/hooks/use-chat-session.ts` | `pendingStreamTextRef`, `pendingStreamReasoningRef`, `pendingToolOutputRef`, stale-stream poller | 3,208 |
| core-platform `dashboard/.../useHubChat.ts` | own reimplementation | 1,980 |

After: one assembler in the SDK; each consumer is a `TurnConsumer`
implementation containing rendering logic only. The parser state above is
deleted, not moved. Honest sizing: these files also contain rendering
logic, which stays. The deletions are the parser-state fields, the
buffering/staleness machinery, and the structural `switch`es — roughly a
third to a half of each file, not the whole file. `useHubChat.ts` is out
of scope for this plan (core-platform) and listed to show the recurring
cost of each new surface.

**P2 — `content_end` duplicates deltas, discovered three times.** The rule
"final text on `content_end` repeats the streamed deltas" is documented
independently at `apps/examples/desktop-app/sidecar/context.ts:310`,
core-platform `agentsession/streamer.go:147`, and handled again inside the
hub `session-event-projector.ts`. After: the frame schema states which frame
carries authoritative final text; the assembler applies it once
(`onBlockClose` carries the final content); the three private discoveries
delete.

**P3 — Tool input carried from start to end by hand.**
`content_end(tool)` does not carry the tool input, so consumers save it at
`content_start` and join at `content_end`: `streamingToolInput` in
MessageTranslatorState, `pendingToolUses` map in the same file's history
path (`message-translator.ts:2323`), and equivalents in the TUI and hub.
After: `ToolSink.close(result)` delivers the input captured at open. The
join happens once, in the assembler.

**P4 — Straggler fencing invented twice.** VSCode: epoch/seq minter, bumped
before abort so stale events are dropped (`SdkController.ts:602-608`,
`2216-2317`; straggler special case in
`sdk-session-event-coordinator.ts:107-117`). Desktop: settled-epoch check
and unmatched-tool-end dropping (`use-chat-session.ts:1716, 1777-1781`).
After: `(epoch, seq)` is stamped by the producer in the frame envelope; the
assembler drops stale frames in one place. The desktop's fence deletes
entirely; VSCode's minter keeps its ClineMessage id-stamping role but its
straggler-dropping role moves into the assembler.

**P5 — Sub-agent demux by timing heuristic.**
`message-translator.ts:2023-2029`: sub-agent events sometimes lack
`parentAgentId`, so the translator suppresses *all* non-spawn events while
any spawn_agent call is running — eating legitimate parent output. After:
every frame carries a full scope address; the consumer prunes sub-agent
streams structurally (`onSubAgent → null`); the heuristic and
`hasRunningSpawnAgents()` delete.

**P6 — Turn end has three spellings.** A turn may end via `done(reason)`,
via terminal `error`, or via `done(reason:"error")` with no error event
(`message-translator.ts:1865-1870`); recoverable errors reuse the `error`
type but are not terminal (`:1896-1911` documents a shipped bug from this).
The hub re-derives the mapping (`run-handlers.ts:28-31`) and needs a
suppression flag to avoid double-publishing terminal events
(`handlers/context.ts:69`). After: exactly one `turn_close` frame with one
`TurnOutcome`; recoverable errors are notices inside the turn.

**P7 — Errors flattened differently at every wire.** `AgentErrorEvent.error`
is a JS `Error` (`shared/src/agents/types.ts:211`). It survives in-process
but each serializing boundary invents a flattening: `error.message` at
`run-handlers.ts:289` and `apps/cline-hub/src/server/agent-events.ts:137`;
the VSCode translator reconstructs structured ClineError data out of the
message string (`reshapeErrorForWebview`). After: the schema defines one
structured, serializable error shape; reconstruction-by-parsing deletes.

**P8 — Liveness/quiescence tracked by polling.**
`SdkSessionRebuildScheduler` drains MCP/provider rebuilds "only while the
session is idle" by polling `activeSession.isRunning` plus explicit
`sessionBecameIdle()` nudges. The desktop has a stale-stream poller
(`use-chat-session.ts:393`). After: the assembler owns the open-scope set
(it must, to route frames) and exposes it; idle is an edge-triggered
callback derived from the same fold that routes frames, so it cannot drift
from what was actually delivered.

## Non-goals — what this does not fix

- The LLM wire-format translation family (`message-builder.ts`,
  `ai-sdk.ts`) is a separate translation problem and is untouched.
- ClineMessage, ACP SessionUpdate, and the TUI model remain: surfaces still
  map assembled structure to their own output vocabulary. This proposal
  shrinks each surface to that mapping; it does not unify output formats.
- The hub wire protocol and core-platform Go consumers keep working
  unchanged during all phases here; regenerating them from the schema is
  future work. Note the hub producer also ships as an independently
  released pod image (cloud-platform `apps/cline-core`, pinned runtime
  versions tracking SDK nightlies), so producer/consumer version skew on
  that wire is an operational fact — the envelope `v` field,
  unknown-variant tolerance, and Phase 1's dual-emit are required for
  that deployment, not defensive extras.
- The forked desktop/hub webview UIs are a separate problem, out of scope.

## Design

### Scope tree

A session's events form a tree of nested intervals:

```
session
├── turn*                        (sequential within one agent's stream)
│   ├── block*                   (text | reasoning | tool | media; tools may be concurrent)
│   └── agent*                   (sub-agent spawned for this turn; recursive: has its own turns)
└── detached*                    (session-scoped: async team runs, detached commands)
```

Rules:

1. Every frame carries the address of exactly one scope.
2. A scope emits frames only between its `open` and `close`.
3. Closing a scope closes its children first (producer emits the child
   closes; see force-close below).
4. A scope outlives its parent only by one of two explicit means:
   - **detach**: the scope closes with outcome `detached` and a resource
     handle (a file path, a runId). Later activity belongs to a *new*
     session-scoped object, not the closed scope. This is the existing
     "Proceed While Running" behavior (`vscode-run-commands-tool.ts`)
     generalized: the tool block closes, output goes to a named log file.
   - **born wider**: async team runs are session-scoped from creation
     (today's `team_progress` is already a sibling of `agent_event` in
     `CoreSessionEvent`, not inside any turn).

### Frame envelope

```jsonc
{
  "v": 2,
  "epoch": 7,          // conversation/replica fence; bumped on task switch, cancel, reinit
  "seq": 1042,         // per-session monotonic, one counter across all scopes
  "scope": {
    "agentPath": ["root", "agent-3f"],  // root agent to owning agent; frames from
                                        // sub-agents always carry the full path
    "turnId": "t-12",                   // absent for session-scoped frames
    "blockId": "b-7"                    // absent for turn/agent/session frames
  },
  "frame": { /* discriminated union, below */ }
}
```

`blockId` is producer-assigned for every block, including text and
reasoning (today only tools have IDs via `toolCallId`; text blocks are
identified by folklore: "at most one open at a time"). For tool blocks,
`blockId` is the `toolCallId`.

`(epoch, seq)` is the producer's obligation. Frames within one scope are
totally ordered by seq; a child scope's `open` has a higher seq than its
parent's `open` and lower than its parent's `close`. This is what the
VSCode minter already implements privately (P4); it moves into the
protocol.

### Frame kinds

Lifecycle frames are generic over scope kind; payload frames are
kind-specific. One level of hierarchy, no more (helpers that benefit:
demux routing, validation, live-set tracking, recording, force-close —
none of which inspect payloads).

```
open        { kind: "turn" | "text" | "reasoning" | "tool" | "media" | "agent" | "run",
              start: KindStart }       // ToolStart carries toolName+input; AgentStart carries ids
delta       { payload: KindDelta }     // text chunk, reasoning chunk, tool progress
close       { outcome: Outcome, final: KindFinal }
annotation  { ns: string, body: NamespacedBody }   // see Annotations
notice      { ... }                    // in-scope, non-structural (recovery, status)
usage       { ... }                    // turn-scoped
snapshot    { openScopes: [...] }      // session-scoped; for attach/reconnect
```

```ts
type Outcome =
  | { kind: "completed" }
  | { kind: "error"; error: StreamError }      // structured, serializable (P7)
  | { kind: "interrupted" }                    // parent force-closed (abort/cancel)
  | { kind: "detached"; resource: ResourceRef }
```

`close.final` carries the authoritative final content (full text, tool
output *and the input from open*) — P2 and P3 become schema statements.

`StreamError` replaces the JS `Error` in `AgentErrorEvent`: a code,
message, provider error class, and optional structured details
(sufficient for what `reshapeErrorForWebview` currently reconstructs by
string parsing).

### Grammar (per-scope automata)

The full interleaved stream is not one automaton; each *projection onto a
scope* is a small one. Three tables, written once, from which the
validator, the trace generator, and the assembler's internal states are
all derived (one source; derivations cannot drift):

**Block** (project frames by blockId):

| state | frame | next |
|---|---|---|
| — | open | streaming |
| streaming | delta | streaming |
| streaming | annotation, notice | streaming |
| streaming | close | closed |
| closed | annotation | closed (late annotations allowed; see below) |
| closed | anything else | **violation** |

**Turn** (project by turnId; block/agent opens and closes appear here as
child events):

| state | frame | next |
|---|---|---|
| — | open(turn) | running |
| running | child open/delta/close, notice, usage, annotation | running |
| running | close(turn) | closed — **violation if any child block/agent of this turn is still open** |
| closed | annotation | closed |
| closed | anything else | **violation** |

**Session** (project session-scoped frames):

| state | frame | next |
|---|---|---|
| attached | open(turn), open(run), snapshot, annotation | attached |
| attached | close(session) | ended |

Plus one cross-scope check per session: seq strictly increases, and every
child `open` falls inside its parent's (open, close) seq interval.

Two automata run in production, not just tests:

- **Producer validator**: after the runtime adapter emits frames, assert
  legality. In dev/test builds a violation throws; in production it logs
  and force-repairs (emit the missing close with `interrupted`). Cost is a
  map lookup and an enum compare per frame — cheap enough to always run.
- **Assembler**: the consumer-side instance of the same tables. On a
  violating frame it repairs to the nearest legal state (drop stale-epoch
  frames; synthesize `interrupted` closes) and reports via a diagnostics
  hook, so one buggy producer path degrades to a logged glitch instead of
  a stuck spinner.

### Consumer API (assembler output)

Push-based visitor. The consumer supplies concrete sink objects; the
assembler routes each scope's frames to the object created at that scope's
open. Ordering rules are consequently unrepresentable in consumer code:
you cannot handle an update for a block you were never handed, and close
is a method on the same object. No type parameters: the kind set is
closed, so distinct factory methods with concrete return types give exact
typing without casts.

```ts
interface SessionConsumer {
  onTurn(start: TurnStart): TurnConsumer
  onRun(start: RunStart): RunSink | null          // session-scoped (async team runs)
  onSessionNotice(notice: Notice): void
  onIdle(): void                                   // edge-triggered; see Quiescence
  onDiagnostic(d: StreamDiagnostic): void          // repairs, dropped frames
}

interface TurnConsumer {
  onText(start: TextStart): TextSink
  onReasoning(start: ReasoningStart): ReasoningSink
  onTool(start: ToolStart): ToolSink
  onMedia(m: MediaFinal): void                     // media arrives whole
  onSubAgent(start: AgentStart): TurnObserver | null  // null = prune subtree (P5)
  onNotice(notice: Notice): void
  onUsage(usage: Usage): void
  onClose(outcome: TurnOutcome): void              // all sinks already closed
}

interface ToolSink {
  onProgress(update: ToolProgress): void
  onAnnotation(a: Annotation): void
  onClose(outcome: Outcome, final: ToolFinal): void  // final includes input from open
}
// TextSink / ReasoningSink analogous: onDelta, onAnnotation, onClose.
```

Delivery contract:

1. Callbacks fire in seq order.
2. `onClose` is the last non-annotation call on any sink. Annotations may
   arrive after close (e.g. a checkpoint restore marking a completed
   tool's edits reverted); the assembler retains routing entries until
   session end.
3. `TurnConsumer.onClose` fires after every child sink's `onClose`. On
   abort the assembler synthesizes `interrupted` closes first. "What does
   my spinner do on cancel" is therefore a guaranteed callback, replacing
   the `!isLast || lastMessage.ask === "resume_task"` inference documented
   in `.clinerules` (ChatRow cancelled-state pattern).
4. The assembler exposes `openScopes(): ScopeSnapshot` — derived from the
   same routing table, usable for debugging and state displays.

The assembler sits behind the existing tee (`subscribeEvents` fan-out is
unchanged); each consumer gets its own assembler instance and live set.

### History replay and reconnect

The same assembler consumes persisted history (frames are the persistence
format for the stream layer; `messages.json` v1 remains the LLM-turn
artifact, see messages-contract-v1.md — different layer, both stay). On
attach/reconnect the producer sends `snapshot` first; the assembler diffs
it against its live set and synthesizes opens/closes so the consumer sees
only legal transitions. Live-after-history dedup is `(scopeId, seq)`
comparison — the desktop's reconcile-delay heuristic
(`use-chat-session.ts:70`) and its dedup folklore delete.

### Annotations

Cross-cutting concerns (tool approval, checkpoints, hook status) currently
correlate with tool blocks via side tables in each consumer
(`approvedToolMessageTsByCallId`, `deniedToolApprovalsByCallId` in
MessageTranslatorState). These become `annotation` frames: addressed to a
scope, ordered by seq, published by coordinators other than the agent loop.

- `Annotation` is a **closed discriminated union in the schema**
  (`{ns:"approval",...} | {ns:"checkpoint",...} | {ns:"hook",...}`).
  Adding a namespace is a reviewed schema change. There is no open
  `Record<string, unknown>` bag.
- Unknown namespaces from a newer producer decode as
  `{ns:"unknown", raw}` — ignorable, visible, not silent.
- Storage is consumer-owned: sinks receive annotations via `onAnnotation`
  and keep what they render. Nothing is stored on shared objects; no
  WeakMaps.

### Quiescence

Definition: a session is **idle** when it has no open turn and no open
session-scoped run. This is computable from the assembler's live set, so
`onIdle` is an edge-triggered signal emitted when the last of those scopes
closes (and once immediately after snapshot reconciliation if the session
is already idle — new subscribers need the edge they missed).

Current consumers of this signal, today hand-rolled:

- `SdkSessionRebuildScheduler` (MCP tool reload, provider rebuild,
  terminal mode changes): polls `activeSession.isRunning` plus manual
  `sessionBecameIdle()` calls. Becomes an `onIdle` subscriber. Its
  serialization of rebuilds (`runExclusive`) stays — that is scheduling
  policy, not stream structure.
- Desktop turn-end reconcile and notification triggers.
- Hub `session.updated` status projections.

Note `onIdle` deliberately does not distinguish *why* the session went
idle; `TurnConsumer.onClose(outcome)` carries that. A rebuild scheduler
does not care whether the turn completed or errored, only that nothing is
running.

## Edge cases

Checked against the design; each resolves to existing frames rather than
new mechanism.

**Error truncates a turn mid-block.** Producer emits, in order:
`close(block, interrupted)` for each open block (or `error` if the block
itself failed), `close(turn, {kind:"error", error})`. The assembler
guarantees this order to consumers even if a buggy producer omits the
block closes (repair). A tool that was mid-approval gets
`close(interrupted)`; the approval coordinator separately publishes its
annotation. No consumer infers truncation from message adjacency again.

**Abort during compaction.** Today's `openCompactionTs` survives
`reset()` because compaction notices span iteration boundaries
(`message-translator.ts:139-141`). In v2, compaction is a block owned by
the turn (kind `notice` open/close or a dedicated block kind — decide at
schema writing); abort force-closes it with `interrupted` like any block.
The special-cased field deletes.

**Cancel racing turn completion.** The done frame from the cancelled turn
carries the old epoch; the assembler drops it; the consumer saw
`close(turn, interrupted)` synthesized at cancel. This replaces the
straggler special case in `sdk-session-event-coordinator.ts:107-117`.

**Detached command completes during a later turn.** The completion is an
update to a session-scoped run object (`RunSink.onClose`), ordered by seq
— it may land mid-turn, which is legal (session scope is not nested in
turn scope). If the producer decides to *tell the model*, that appears as
ordinary content in a later turn; the stream layer does not conflate the
two.

**Reconnect while a tool is open.** Snapshot lists the open scopes;
assembler opens sinks for them (start payloads are included in the
snapshot), then live frames continue. Consumer code cannot tell the
difference from a normal open.

**Turn ends with no output (provider failed before first token).** Legal:
`open(turn)` → `close(turn, error)`. Consumers get a turn with zero
sinks; nothing to repair. (Matches messages-contract-v1 failure case 2.)

**Approval pause mid-turn.** A tool awaiting user approval leaves its
block and turn open, possibly for minutes. Not idle — rebuilds stay
deferred, matching today's `isRunning` behavior. The approval request
itself is an `annotation(ns:"approval", state:"pending")` on the tool
block, resolved by a later annotation, so consumers render approval state
from the sink. The response path (user's decision back to the runtime) is
a request/reply concern, not a stream concern; the interaction
coordinator keeps it.

**Followup question ends the turn.** A turn that ends by asking the user
something closes normally (`completed`, with the question as its final
text or a dedicated outcome field — decide at schema writing). The
session *is* idle while awaiting the reply; rebuild-while-waiting is
today's behavior and stays.

**Two text blocks in one turn.** Legal in v2 (each has a blockId). Today's
folklore "at most one" becomes unnecessary; consumers that render one
bubble per block already handle it.

## Work plan

Phases ship independently; each leaves every surface working.

**Phase 0 — transition tables + validator against the *current* stream.**
Write the three tables for the de-facto v1 grammar (with its warts:
content_start-as-delta, missing blockIds, two turn-end spellings).
Implement `validateEventStream` and run it in the RuntimeEventAdapter
tests and on recorded fixtures. Deliverable: the warts become failing or
explicitly-waived assertions instead of folklore. Small; no behavior
change; do first because it is cheap verification we keep forever.

**Phase 1 — schema + producer.** Define the frame schema
(`@cline/shared`), the wart fixes (blockIds, structured error, single
turn-close, epoch/seq in envelope), and emit v2 frames from the runtime
adapter alongside v1 events (additive; existing consumers untouched).
Producer validator on. Trace generator derived from the tables;
property-test: every generated legal v1-input sequence yields legal v2
output.

**Phase 1 status: implemented.** `@cline/shared` carries
`stream-frames.ts` (the v2 frame schema and `validateFrameStream` with
its own violation codes), `agent-event-framer.ts` (the pure v1→v2
framer), and `v1-trace-generator.ts` (a seeded generator derived from
the v1 tables). `@cline/core` carries `runtime-frame-adapter.ts`, a
wrapper over `RuntimeEventAdapter` whose v1 output is asserted identical
to the plain adapter's (test-locked, `durationMs` normalized — it is
wall-clock per instance). The property loop — 200 seeds of legal v1
traces framed and validated — is green, as are the per-wart pins
(open+close for W2, force-close for W3, notices for recoverable errors,
one outcome spelling for P6). Schema decisions settled at writing
time: a v1 *run* is a v2 *turn*; v1 *iterations* become turn-scoped
notices (`iteration_started`/`iteration_finished` carrying iteration,
hadToolCalls, toolCallCount); finish reasons map
completed/max_iterations/mistake_limit → `completed`, `aborted` →
`interrupted`, `error` → the error outcome (synthesizing the StreamError
the missing error event would have carried); `bumpEpoch()` is the host's
conversation fence, called by the host (Phase 3 wiring), never by the
run; a session-scoped close frame is not emitted by the framer — it is
a host-level concern (also Phase 3). The first frame consumer (CLI
port) lands in Phase 2; until then the framer/validator are exercised by
tests, and the wrapper exists so the producer side of the contract is
pinned before any consumer ports.

**Phase 2 status: implemented (CLI port; ACP moved).** `@cline/core`
carries `stream-assembler.ts` — the consumer-side instance of the v2
tables: push-based consumer API (SessionConsumer/TurnConsumer/sinks),
delivery contract (seq order, close-last, children-before-turn-close),
the live set, repairs (stale-epoch drop, orphan drop, force-close)
reported via `onDiagnostic`, and the `onIdle` quiescence edge. Its tests
extend the property loop (100 seeds: zero diagnostics, one idle per
turn) and pin each repair. The CLI terminal renderer
(`apps/cli/src/utils/events.ts`) is the first frame consumer: the v1
switch and its module-level parser state are gone; `handleEvent` frames
via `AgentEventFramer` and drives `CliFrameRenderer` sinks. Fidelity is
proven two ways: the new differential harness (100 seeds × 2 verbosity
modes, byte-identical stdout/stderr, plus handcrafted edges —
ask_question, redacted reasoning, tool errors, status notices) and the
pre-existing `events.test.ts` behavioral suite, which now runs against
the frame path unchanged. The harness whitelists exactly one intended
divergence (P6 made visible: `done(reason:"error")` renders as an
error, not v1's fake "finished" banner). Framer amendments forced by
rendering fidelity: `NoticeBody.metadata` (compaction labels),
turn-close `iterations` (verbose run summary), an empty delta for
redacted-with-no-text reasoning (the `[redacted]` marker moment), and
id-less tool open/close pairing (type-legal v1 input). The old v1
renderer lives as `agent-renderer-v1.reference.ts`, the differential
baseline, deleted in Phase 5. JSON mode is byte-identical and
untouched. **ACP port moved to the next PR**: `session-updates.ts` is
a separate surface with its own wiring; delivering the CLI port +
harness first keeps this PR's risk surface small, and the assembler
API is now proven by a real consumer before the second port.

**Phase 3 (decomposed during execution — the VSCode translator port
was too large for one PR, and the demux layer turned out to be design
work rather than porting).**

**Phase 3a status: implemented (agent-path demux).** Sub-agent events
now route structurally, deleting the v1 timing heuristic's premise (P5):
- `@cline/shared`: `AgentEventFramer` accepts an injectable
  `FrameSequencer`, and a `SessionFramer` facade frames multiplexed
  agent paths (root `frameEvent`, `frameRoutedEvent(agentPath, event)`)
  under one session-wide (epoch, seq) — the design's "one counter
  across all scopes" invariant holds for interleaved streams. The
  validator is address-keyed (path/turn/block), so two agents minting
  their own `turn-1` stay independent.
- `@cline/core`: the assembler routes by agent path, resolves
  sub-agents through `TurnConsumer.onSubAgent` (now returning a full
  TurnConsumer — sub-agent streams carry their own blocks; the doc's
  minimal TurnObserver was upgraded), prunes silently on null (P5),
  and force-closes child streams (deepest first) before the spawning
  turn's close. `session-event-projector.ts` attributes
  `CoreSessionEvent`s by parentAgentId (child path) and teamAgentId
  (teammate path), flagging unattributable events instead of guessing.
- Remaining, sequenced: **3b** epoch fence into the producer +
  rebuild-scheduler on `onIdle` (small); **3c** VSCode translator
  sinks; **3d** history replay/reconnect (snapshot reconciliation).

**Phase 3b — host wiring.** Move the epoch fence from SdkController
into the producer envelope (the CLI's SessionFramer already carries
it); port `SdkSessionRebuildScheduler` to `onIdle`.

**Phase 3c — VSCode translator.** Port message-translator onto the
assembler. MessageTranslatorState's parser fields delete; ClineMessage
mapping remains as sink implementations; sub-agent suppression (P5's
heuristic) becomes `onSubAgent → null` plus a SubagentStatusRow
consumer.

**Phase 3d — history replay and reconnect.** Snapshot reconciliation
in the assembler (diff against the live set), live-after-history dedup
by (scopeId, seq).

**Phase 4 — desktop.** Sidecar forwards frames verbatim (the
`chat_text`/`chat_done` re-encoding in `sidecar/context.ts` deletes);
`use-chat-session.ts` becomes sinks + React state. Likely split into
two PRs (sidecar forwarding; webview sinks) by the same reasoning that
decomposed Phase 3.

**Phase 5 — ratchet.** CI check: no `switch`/`if` over raw
`AgentEvent.type` outside the assembler package and the (legacy) hub
projector; count must not increase. Hub projector and core-platform
regeneration are follow-on work, not part of this plan.

Ordering rationale: 0 and 1 are producer-side and reversible; 2 proves
the consumer API on the cheapest surface; 3 and 4 are the payoff and can
be paced independently.

**Phase 0 status: implemented.** `@cline/shared` now carries
`src/agents/stream-grammar.ts` (the v1 tables, `validateAgentEventStream`,
and the wart registry) with unit tests, and `@cline/core` carries
`src/runtime/orchestration/runtime-event-adapter.grammar.test.ts`, which
drives the real `RuntimeEventAdapter` through success, mid-tool-failure,
non-streaming, and multi-iteration runs and asserts zero violations with
exact wart counts. When Phase 1 fixes a wart, the corresponding
expectation flips from a wart count to zero — the grammar tests are the
migration's scoreboard.

## Verification strategy (how we know nothing broke)

The refactor's safety does not rely on review; it relies on these
mechanical gates, in order:

1. **Behavior freeze before behavior change.** Phase 0's validator plus
   the existing adapter/translator test suites (37 adapter tests, the
   message-translator suite, the messages-contract e2e tests) pin
   today's behavior. No phase may change producer behavior until these
   pass unchanged; they run in every PR of the stack.
2. **Dual-run, then delete.** From Phase 1 to Phase 4 the old path stays
   live and the new path is additive (v2 frames emitted alongside v1
   events; a ported consumer replaces an unported one at a time). The
   old path is deleted only in the phase after its replacement is green
   in CI. There is never a PR where a surface has neither path.
3. **Differential replay.** Recorded traces (existing test fixtures and
   a set captured from real runs) replay through old and new paths;
   outputs are compared for equality (CLI: rendered text; VSCode:
   ClineMessage arrays). Added in Phase 2, run in CI from then on.
4. **Grammar validation on both sides.** `validateAgentEventStream` runs
   against producer output in tests today, and Phase 1 adds it to the
   v2 emit path in dev builds — a producer regression becomes a thrown
   assertion, not a downstream rendering glitch.
5. **Wart-count ratchet.** The grammar tests pin exact wart counts.
   Counts may decrease (wart fixed) but never increase; an increase
   means the producer regressed structurally and CI fails.
6. **Ratchet on raw discrimination** (Phase 5): the count of
   `switch`/`if` over `AgentEvent.type` outside the assembler package
   may not increase, so no new private parser can appear mid-migration.
7. **Per-phase manual QA** via the debug harness (VSCode surfaces) and
   `bun run cli -i` (CLI) for the one thing automation can't check:
   that the UI feels the same.

## Stacked PR plan

One PR per phase, each stacked on the previous, each independently
revertable without reverting its ancestors' behavior changes:

| # | Branch | Content | Depends on |
|---|---|---|---|
| 1 | `dpc/event-stream-phase0` | Design doc + v1 tables, validator, wart registry, adapter grammar tests. No behavior change. | — |
| 2 | `dpc/event-stream-phase1` | v2 frame schema, structured StreamError, dual-emit in RuntimeEventAdapter, trace generator + property tests. | 1 |
| 3 | `dpc/event-stream-phase2` | Assembler (`@cline/core`), CLI terminal port, differential replay harness. (ACP port moved to PR 5, Phase 3b.) | 2 |
| 4 | `dpc/event-stream-demux` | Phase 3a: multiplexed framing (SessionFramer, shared sequencer), address-keyed validator, tree-aware assembler with `onSubAgent` pruning, session-event projector. | 3 |
| 5 | `dpc/event-stream-phase3b` | Phase 3b: epoch fence into the producer, ACP port, rebuild scheduler on `onIdle`. | 4 |
| 6 | `dpc/event-stream-phase3c` | Phase 3c: VSCode translator sinks; P5 heuristic becomes `onSubAgent → null`. | 5 |
| 7 | `dpc/event-stream-phase3d` | Phase 3d: history replay/reconnect, snapshot reconciliation. | 6 |
| 8 | `dpc/event-stream-phase4a` | Desktop sidecar forwards frames verbatim (v1 re-encoding deletes). | 7 |
| 9 | `dpc/event-stream-phase4b` | Desktop webview sinks (`use-chat-session`). | 8 |
| 10 | `dpc/event-stream-phase5` | CI ratchet + deletion of superseded v1 consumer paths and the v1 reference renderer. | 9 |

Review stays manageable because PR 1 is additive-only (this PR), PRs 2-3
are producer/plumbing with property tests doing the checking, and the
two big ports (4, 5) are mechanical sink implementations reviewed against
the delivery contract rather than re-reviewed logic.


