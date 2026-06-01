# Live debug-harness capture: SDK→webview message sequences (sdk-migration branch)

Captured via debug harness `web.evaluate` hook on the gRPC partial-message stream.
Format: [proto.type, proto.ask, proto.say, partial, text-prefix]
proto enums: type SAY=1/ASK→0-default; say: 2=api_req_started 4=text 5=reasoning
6=completion_result 7=user_feedback 10=command 12=tool ; ask: 4=completion_result

## Run A — Plan mode (ask_question / followup)
say:api_req_started {}            (iteration_start)
say:text "I'm in Plan…" (P)×N     (streaming)
say:api_req_started {tokensIn…}   (usage)   <-- bookkeeping appended AFTER text
say:text "I'm in Plan…"           (content_end, final)
say:tool {"tool":"ask_question"} (P)   <-- ORPHAN: never finalized (partial stays true)
ASK:followup {"question":"Ready…"}     (the real ask, lands last)

## Run B — Act mode (command auto-approved + attempt_completion)
say:user_feedback "In Act mode…"
say:tool {"tool":"ask_question"}       <-- leftover orphan from prior turn
say:api_req_started {}                 (iteration_start)
say:text "I'm still in Plan…" (P)×3
say:api_req_started {tokensIn:315}     (usage AFTER text)
say:text "I'm still in Plan…"          (final)
ASK:completion_result ""               <-- premature done-ask MID conversation
say:api_req_started {}  ×2
say:api_req_started {tokensIn:6617}
say:command "echo…" (P)
say:command "echo…\n<output>"          (final)
say:api_req_started {}
say:api_req_started {tokensIn:203}
say:completion_result "Ran echo…" (P)  (attempt_completion content_start)
say:completion_result "Ran echo…"      (content_end)
say:api_req_started {}                 (iteration_start — EXTRA)
say:text "Done." (P)                    <-- TEXT STREAMS AFTER completion_result
say:api_req_started {tokensIn:130}
say:text "Done."                        (final)
ASK:completion_result ""               (final done-ask; happens to land last → renders OK)

## Verdict
- Global UI state (thinking / buttons / done) is inferred from the TAIL of a flat
  append-ordered ClineMessage[] on both backend (message-translator manufactures
  "must be last" asks) and webview (MessagesArea.isWaitingForResponse,
  buttonConfig.getButtonConfigForMessages both key off array.at(-1) / last-non-inert).
- Bookkeeping (say:api_req_started usage) is appended AFTER content_end and AFTER
  approval asks → tail no longer means what the UI assumes → "stuck Thinking" / missing
  buttons. Max's getButtonConfigForMessages walks back over an "inert" skip-list to
  compensate, but that skip-list != isWaitingForResponse's allow-list, so the two
  consumers disagree.
- Orphan say:tool(partial=true) for ask_question is never finalized → a permanently
  partial row that defeats the tail heuristics.
- attempt_completion + text-after-completion + interleaved api_req_started means the
  ONLY thing keeping it un-stuck is the final ask:completion_result happening to land
  last. Lose that race (cancel/error/extra event) → stuck.

## TIMING-DEPENDENT root cause (the "last message missing / stuck" one)

Two INDEPENDENT gRPC streams carry the same conversation with NO cross-ordering:
- subscribeToPartialMessage: incremental append/update by ts (webview ExtensionStateContext ~L583)
- subscribeToState: WHOLESALE replace of clineMessages (ExtensionStateContext L430-435,
  "// HACK: Preserve clineMessages if currentTaskItem is the same" → uses incoming snapshot)

Per turn-end the backend fires, CONCURRENTLY and UN-AWAITED:
- bridge.pushPartialMessage() per message (webview-grpc-bridge L71-73, not awaited)
- bridge.pushStateUpdate() on done/error (L84, not awaited)
- sdk-session-event-coordinator.postStateToWebview() (L104-107, not awaited)
- SdkController.onSendComplete → postStateToWebview() (SdkController ~L260)

sendStateUpdate (subscribeToState.ts) and sendPartialMessageEvent are separate
subscription sets; nothing sequences them. Each postStateToWebview does
`await getStateToPostToWebview()` (reads live backend messageStateHandler array) then
`await sendStateUpdate`. Because un-ordered, a snapshot captured BEFORE the final
ask:completion_result (or while a tool/text row is still partial) can RESOLVE LAST and
clobber the webview's already-correct array → last message vanishes → tail reverts to
say:api_req_started/partial → isWaitingForResponse → STUCK "Thinking…".

LIVE TRACE confirming the race window (long completion run):
  …, say:text(final), STATE, ASK:completion_result, STATE, STATE, STATE
  → THREE full-state replacements trail the final ask. Rendered OK only because the
  backend array and webview array happened to converge on localhost. Under latency /
  model speed variance / extra trailing events they diverge.

cancelTask path (sdk-task-control-coordinator L24-58): appends ask:resume_task then
postStateToWebview, but events drained after sdkHost.abort() resolves append
say:api_req_started/say:text AFTER it; the !isRunning filter
(sdk-session-event-coordinator L66-70) only strips completion_result/resume_completed_task
ASKS, not SAYS → tail becomes a non-ask → stuck.

## Two coupled root causes
1. PATTERN-sensitive: global UI state inferred from array tail (translator "must be last"
   hacks + two divergent webview tail heuristics).
2. TIMING-sensitive: two unsynchronized channels + wholesale state replacement + no
   version guard + multiple concurrent un-awaited state pushes → freshest message clobbered.

## DETERMINISTIC REPRODUCTION (on camera, debug harness)

Setup: completed a task ("say DONE then attempt_completion"). Webview clineMessages =
8 msgs ending in ask:completion_result → UI shows green "Task Completed" + "Start New
Task", NO spinner. (screenshot-0002)

Injection: captured the real subscribeToState envelope, rebuilt it with clineMessages
truncated by ONE (dropped the trailing ask:completion_result → 8→7), re-dispatched via
window.postMessage in the SAME grpc_response envelope the state handler consumes.

Result (screenshot-0003): SAME conversation now shows "Thinking..." + Cancel button.
The completion UI vanished and the footer is stuck in the waiting state — the exact
"last message missing / stuck thinking" symptom.

Why: ExtensionStateContext L430-435 wholesale-REPLACES clineMessages when
currentTaskItem.id matches and incoming array is non-empty. The stale (shorter) snapshot
overwrote the correct array; tail reverted from ask:completion_result to
say:api_req_started → isWaitingForResponse=true → stuck.

In production this stale snapshot arrives naturally: multiple concurrent un-awaited
postStateToWebview() calls (bridge done/error push + session-event-coordinator push +
onSendComplete push) race the partial-message stream with no version guard; whichever
state snapshot resolves last wins, even if it predates the final ask.

CONFIRMED: the timing-dependent "last message missing / stuck" bug is the
two-channel race + wholesale state replacement without a monotonic/version guard.


## DETERMINISTIC REPRODUCTION #2 (pattern/tail, on camera)

Baseline (screenshot-0004): injected clineMessages ending in ask:command
("rm -rf /tmp/scratch") → UI shows "Cline wants to execute this command: ● Pending"
with Run Command / Reject buttons. Correct.

Injection: appended ONE trailing say:api_req_started (usage, cost:0.02) AFTER the
ask:command. No timing — just one extra message at the tail.

Result (screenshot-0005): SELF-CONTRADICTORY UI —
  - command row flips ● Pending → ● SKIPPED (wrong)
  - footer shows "Thinking..." (isWaitingForResponse saw raw at(-1)=api_req_started)
  - YET Run Command / Reject buttons STILL show (getButtonConfigForMessages walked back
    over the inert api_req_started via isInertStatusMessage to the ask:command)

So the two consumers DISAGREE on screen simultaneously: footer = "Thinking/Skipped",
action bar = "Run Command/Reject". Confusing + stuck. Pure position-of-one-message
sensitivity, zero timing.

Mechanism: getButtonConfigForMessages uses isInertStatusMessage SKIP-LIST;
isWaitingForResponse uses raw clineMessages.at(-1) + grouping ALLOW-LIST. Different rules
on the same array → mutual contradiction from a single trailing bookkeeping message.

## BOTH ROOT CAUSES NOW REPRODUCED ON CAMERA
- #1 pattern/tail: screenshot-0004 (ok) → 0005 (contradictory) via one trailing message.
- #2 timing/clobber: screenshot-0002 (ok) → 0003 (stuck Thinking) via one stale snapshot.

---

_The design built on this evidence now lives in `webview-message-state-design.md`._
