# 05 · Workflows. What Drive must support

Back to [README](README.md). This is the canonical workflow catalog for cline-drivemode. It supersedes the seven-item "Workflows to define" list in [03-research-inventory.md](03-research-inventory.md), which stays as the surface inventory that produced it.

A workflow here is a sequence a human performs start to finish. Not a feature. A feature is a thing the product has. A workflow is a thing a person does with it. The [features index](README.md#features) says what we build. This file says what a person does once it exists, and it is the source the phase gates should smoke against.

## How to read an entry

Every entry carries the same fields.

- **Actors.** Human, pair partner, specialist, reviewer, or the system (hub, kernel, hooks).
- **Trigger.** What starts it.
- **Happy path.** Numbered, concrete.
- **Failure and interrupt.** What goes wrong and what the human does about it.
- **Surfaces.** Drive tab, room view, stage, transcript, call strip, composer, voice, TUI, hub ops.
- **Tier.** MVP, Phase 2, or Later. Defined below.
- **Features.** DRV IDs that already cover it, or `GAP` with the proposed owner.
- **Sources.** Cited prior art.

IDs are stable. A workflow keeps its `W-nn` for the life of the catalog. New entries take the next free number and are appended to the group they belong to, so numbers run out of sequence inside a group. That is intentional. Renumbering would break every reference in a feature file or a gate smoke script.

### Tier is a delivery tier, not a plan phase number

The tier names are the catalog's three delivery buckets. They are not the phase numbers in [TASK-GRAPH.md](TASK-GRAPH.md). A workflow tiered MVP can land in plan phase 0, 1, 2, or 3.

| Tier | Meaning |
|---|---|
| MVP | Required for a phase 0 through 3 gate. The Drive-tab MVP is not done without it. |
| Phase 2 | Deferred to plan phase 4. Parity and the flagged team option. |
| Later | Plan phase 5 and beyond, or unscheduled. |

### Citation convention

Prior art lives in two sibling repos that are not part of this checkout.

- `cursor-drive:<path>` is `../cursor-drive` relative to this repo, the VS Code extension.
- `claude-drive:<path>` is `../claude-drive`, the Claude Code CLI port.
- A bare path is inside this repo.

Both siblings are read-only prior art. Nothing in them is ported wholesale. [01-architecture.md](01-architecture.md) already rejects porting cursor-drive's `:7891` daemon, and that rejection binds every workflow below.

## Constraints every workflow inherits

Repeated because workflow design is exactly where these get quietly violated.

- The hub on `:25463` is the single writer of room state. Nothing defaults to `:7891` ([01-architecture.md](01-architecture.md) D2).
- Operators are not teams. The MVP roster is one human and one `pair_partner` ([03-research-inventory.md](03-research-inventory.md)).
- The Drive tab is primary. Chat **Join call** is a shortcut into the active room ([00-vision.md](00-vision.md)).
- Privacy-strict. No transcript or audio persistence without an explicit visible debug flag ([DRV-PRIVACY](features/DRV-PRIVACY.md)).
- The stage is events-first. Pixels on the agent path are an anti-pattern ([00-vision.md](00-vision.md)).
- WebRTC is later ([04-future-multi-user.md](04-future-multi-user.md)).
- No Cursor or VS Code chrome DOM hacks. cursor-drive's workarounds for Cursor's closed Composer do not transfer, and the ones it documents as unresolved are the clearest evidence of why (`cursor-drive:docs/design/ux/voice-user-journey-storyboard.md` friction F9 and F10, "no known stable API to programmatically write text into Cursor's chat input field"). Cline owns its own composer, so Drive gets the honest path cursor-drive never had.

---

## Group A. Session lifecycle

### W-01 · First run to a usable Drive

**Actors.** Human, system.
**Trigger.** Drive is installed or the hub is started for the first time in a workspace.

**Happy path.**
1. The human opens the hub and sees a Drive activity in the left nav.
2. Opening it shows the workspace with at least one call room, empty roster, no ceremony.
3. Nothing has to be configured for a text-only call. Voice, TTS, and captions are opt-in later.
4. The first join works without a wizard.

**Failure and interrupt.** The hub is not running, so the Drive tab renders a single actionable line naming the start command rather than an empty shell. A version-skew client sees a schema mismatch message, not a blank room.

**Surfaces.** Drive tab, hub ops.
**Tier.** MVP.
**Features.** [DRV-DRIVE-TAB](features/DRV-DRIVE-TAB.md), [DRV-ROOM-MVP](features/DRV-ROOM-MVP.md). `GAP` on the not-running and version-skew states.
**Sources.** cursor-drive's install arc is the cautionary one. Its own storyboard rates "no first-run guide" as friction F1 and lists three separate manual setup steps before the product works, including a manual `.cursor/mcp.json` registration and a separate plugin install (`cursor-drive:docs/design/ux/voice-user-journey-storyboard.md`, Phase 1). The MVP promise here is the opposite. "Instant join. No ceremony, no lobby, no setup wizard" ([00-vision.md](00-vision.md)). claude-drive states the same thing as a standing prohibition rather than a goal. Its anti-list forbids a welcome modal outright, alongside a sidebar, confidence percentages, and unsolicited digests (`claude-drive:docs/dynamic-agent/user-experience.md`). It does allow itself exactly one exception, a single first-prompt line acknowledging that a conversation is being tracked, once per machine, and then silence forever after. That is the honest middle between a wizard and a product that never explains itself, and it is what W-01 should copy.

### W-02 · Open the Drive tab and join a room

**Actors.** Human, pair partner, hub.
**Trigger.** The human clicks a call room in the Drive tab.

**Happy path.**
1. The human opens the Drive tab and picks a call room.
2. `joinCall()` resolves to `room.createOrAttach()` and the hub seats the human.
3. The pair partner is seated as `pair_partner` and appears in the nested roster under the room row.
4. The persona chip shows presence. The mode pill shows the current sub-mode.
5. The room feed is live. The human can send immediately.

**Failure and interrupt.** Double-join is a safe no-op. A room that already has a partner attaches rather than seating a second one. If the roster cap is hit with the team flag off, the join still succeeds and the cap is reported, never silently exceeded.

**Surfaces.** Drive tab, room view, roster, persona chip, mode pill.
**Tier.** MVP.
**Features.** [DRV-ROOM-MVP](features/DRV-ROOM-MVP.md), [DRV-DRIVE-TAB](features/DRV-DRIVE-TAB.md), [DRV-ROSTER](features/DRV-ROSTER.md), [DRV-PERSONA-CHIP](features/DRV-PERSONA-CHIP.md).
**Sources.** [00-vision.md](00-vision.md), [DRIVE-TAB.md](../../design/drive-wireframes/DRIVE-TAB.md) for the nested-roster IA borrowed from Discord voice channels.

### W-03 · Join from Chat instead of the tab

**Actors.** Human, hub.
**Trigger.** The human is mid-conversation in Chat and clicks **Join call**.

**Happy path.**
1. The Chat header **Join call** control calls the same `joinCall()` façade.
2. The active Drive room opens or focuses. No second room is created.
3. The Chat conversation and the room feed agree about what has happened.

**Failure and interrupt.** Clicking Join call when already in the room focuses rather than rejoining. If the shortcut and the tab disagree about which room is active, the hub's pointer wins.

**Surfaces.** Chat header, Drive tab, room view.
**Tier.** MVP.
**Features.** [DRV-TOGGLE](features/DRV-TOGGLE.md).
**Sources.** [01-architecture.md](01-architecture.md) D3, "It is a shortcut, not a second product surface."

### W-04 · Leave the call without losing anything

**Actors.** Human, hub.
**Trigger.** The human clicks leave, closes the tab, or walks away.

**Happy path.**
1. `call_leave` removes the human from the roster.
2. The room, its event history, and any in-flight work persist.
3. Re-joining reattaches and the feed shows what happened while away.

**Failure and interrupt.** Double-leave is a no-op. Leaving mid-turn does not cancel the turn. The partner keeps working and narrates into the room for the human to read on return.

**Surfaces.** Call strip, room view, hub ops.
**Tier.** MVP.
**Features.** [DRV-LEAVE-END](features/DRV-LEAVE-END.md).
**Sources.** [DRV-LEAVE-END](features/DRV-LEAVE-END.md), "Leaving is a state mutation. The room and its work persist" ([00-vision.md](00-vision.md)).

### W-05 · End the session and get a handoff explanation

**Actors.** Human, pair partner, kernel.
**Trigger.** The human ends the session rather than leaving it.

**Happy path.**
1. End pauses any in-flight turn using the interrupt policy's pause-after-tool semantics.
2. The kernel assembles a handoff explanation from the room's typed work events. Files touched, commands run, plan state, open items.
3. The explanation renders as a final narration message.
4. The room closes.

**Failure and interrupt.** Ending during a long tool shows "finishing current step" first. Double-end is a no-op. With a thin event history the summary degrades to a plain factual list rather than inventing one.

**Surfaces.** Call strip, room feed, kernel.
**Tier.** MVP.
**Features.** [DRV-LEAVE-END](features/DRV-LEAVE-END.md), [DRV-NARRATION](features/DRV-NARRATION.md), [DRV-INTERRUPT](features/DRV-INTERRUPT.md).
**Sources.** [DRV-LEAVE-END](features/DRV-LEAVE-END.md). The Tier 0 assembly rule comes from `cursor-drive:.cursor/rules/tiered-model-routing.mdc`, "If a decision can be made without a model, it must be."

### W-06 · Come back and catch up

**Actors.** Human, hub.
**Trigger.** The human re-joins a room they left, or starts a new session against an existing room.

**Happy path.**
1. Re-join reattaches to the room.
2. The feed replays what happened while away, and the stage rebuilds from the event log rather than from a snapshot the client happened to keep.
3. A short "since you left" orientation names the current plan cursor and anything waiting on the human.

**Failure and interrupt.** A reload mid-task must rebuild the same stage deterministically. That determinism is already the phase 2 gate condition. A capped history means very old events are gone, so the orientation states the cap rather than pretending to be complete.

**Surfaces.** Room feed, stage, now/next strip.
**Tier.** MVP for replay. `GAP` for the orientation line.
**Features.** [DRV-STAGE](features/DRV-STAGE.md), [DRV-NOWNEXT](features/DRV-NOWNEXT.md), [DRV-TRANSCRIPT](features/DRV-TRANSCRIPT.md). `GAP`: the catch-up summary is a distinct kernel output from the end-of-session handoff and belongs in [DRV-LEAVE-END](features/DRV-LEAVE-END.md) as a second consumer of `handoff.ts`.
**Sources.** claude-drive ships the equivalent as a session-resume line. "Welcome back. Last active: drive-mode-port-handling, 13 hours ago" (`claude-drive:docs/dynamic-agent/user-journey.md`, the 30-day arc). Phase 2 gate replay requirement is in [TASK-GRAPH.md](TASK-GRAPH.md).

### W-07 · Switch between rooms during a working day

**Actors.** Human, hub.
**Trigger.** The human moves from one piece of work to another.

**Happy path.**
1. The Drive tab lists the workspace's call rooms.
2. Selecting another room focuses it. The previous room persists with its roster and history.
3. The chip and mode pill re-render for the newly focused room.
4. Returning to the first room resumes where it was.

**Failure and interrupt.** Sending to the wrong room is the failure mode this workflow exists to prevent. The composer must state which room it will send to before the send, not after.

**Surfaces.** Drive tab room list, room view, composer.
**Tier.** MVP for the IA. Later for anything that decides the room for you.
**Features.** [DRV-DRIVE-TAB](features/DRV-DRIVE-TAB.md). `GAP` on multi-room focus semantics. The tab is specified as channels plus call rooms, but no feature owns what happens to the second room's turn loop while it is unfocused.
**Sources.** claude-drive's Curator is the deepest prior art on this exact problem and it is worth reading before choosing a default. Its locked decision D2 is a "sticky default plus drift intervention" hybrid rather than either always-ask or always-guess (`claude-drive:CLAUDE.md`, locked decisions). Explicit switching is a wake-worded command, `"hey drive, switch to Roler"` (`claude-drive:docs/dynamic-agent/user-experience.md` §6). **Do not port auto-routing.** claude-drive stages it behind evidence gates for good reason, and Drivecode's room is an explicit human choice, not an inferred one.

---

## Group B. The work loop

### W-08 · Hand the partner a task and watch it land

**Actors.** Human, pair partner, hub, stage.
**Trigger.** The human sends a message in a joined room.

**Happy path.**
1. The human types or speaks a task.
2. The hub validates and delivers per the address set.
3. The partner acknowledges, states its intent, and starts work.
4. Typed work events flow. Each edit, command, and test run projects onto the stage.
5. The partner narrates decisions, not keystrokes.
6. The turn ends with an outcome-first summary.

**Failure and interrupt.** A tool fails and the partner reports the failure on the stage rather than swallowing it. A turn that would touch three or more files confirms first.

**Surfaces.** Composer, room feed, stage, narration.
**Tier.** MVP.
**Features.** [DRV-PARTNER-MVP](features/DRV-PARTNER-MVP.md), [DRV-NARRATION](features/DRV-NARRATION.md), [DRV-STAGE](features/DRV-STAGE.md), [DRV-EVENTS](features/DRV-EVENTS.md).
**Sources.** Narration density and the confirm-at-three-files rule come from cursor-drive's mode rules (`cursor-drive:.cursor/rules/drive-modes.mdc`, "Drive-Agent. execute; confirm before changing ≥3 files"). Outcome-first response shape is `cursor-drive:.cursor/skills/drive-concise/SKILL.md`.
**Pattern worth stealing.** Step 3 should be a separate cheap turn, not the opening of the expensive one. claude-drive splits acknowledgment from answer, returning an immediate ack plus a turn id while the real work runs, then delivering the answer against that id (`claude-drive:src/voiceResponder.ts`). The ack falls back to a template when the model call fails, so the human always hears something. That structure is what makes a slow turn feel responsive, and it costs one Tier 1 call. Worth adopting for typed turns too, not just voice.

### W-09 · Change sub-mode mid-call

**Actors.** Human, kernel.
**Trigger.** The human says or clicks a mode change. "Let's plan this first." "Go ahead."

**Happy path.**
1. Mode intent is detected from the utterance by a Tier 0 regex table, or set explicitly on the mode pill.
2. The kernel sets the sub-mode. The pill re-renders.
3. Behavior changes without restarting the session or the room. Plan asks one question at a time. Agent executes. Ask makes no edits. Debug takes one hypothesis at a time.
4. The human agrees on a plan and flips to agent without losing the conversation.

**Failure and interrupt.** An ambiguous phrase falls through to a no-op rather than guessing. Mode changes mid-turn take effect at the next turn boundary, not mid-tool.

**Surfaces.** Mode pill, composer, kernel.
**Tier.** MVP.
**Features.** [DRV-MODE-OVERLAY](features/DRV-MODE-OVERLAY.md), [DRV-KERNEL](features/DRV-KERNEL.md), [DRV-SKILL-PORT](features/DRV-SKILL-PORT.md).
**Sources.** The phrase table is portable almost verbatim from `cursor-drive:.cursor/rules/drive-modes.mdc`. cursor-drive's own invariant is that Drive sub-modes map one to one onto the host's native modes (`cursor-drive:.cursor/rules/vision-invariants.mdc`, item 3), which for Cline means plan and act, with ask and debug as overlays. That is exactly what [DRV-MODE-OVERLAY](features/DRV-MODE-OVERLAY.md) already assumes.
**Recommendation.** Copy two cursor-drive defaults, not just the table. Semantic mode switching is off by default there (`modeSwitching.semanticEnabled: false`), and a switch can require confirmation before it takes effect. A regex table that silently changes what the partner is allowed to do is a trust bug. Ship the table on, semantics off, and announce the switch.

### W-10 · Steer mid-turn without cancelling

**Actors.** Human, pair partner, core turn queue.
**Trigger.** The human thinks of something while the partner is working.

**Happy path.**
1. The human types or speaks while a turn runs.
2. The message queues as a steer instead of blocking or erroring.
3. A queued chip appears above the composer. The human can retract it before it is consumed.
4. At the next tool boundary the partner consumes the steer through the mutating hook path and acknowledges it in narration.
5. Two steers arrive in the order sent.

**Failure and interrupt.** A steer that arrives during one very long tool waits, and the queued chip shows pending state so the wait is visible. If the human actually meant stop, that is W-11, not this.

**Surfaces.** Composer, queued chip, narration, hooks.
**Tier.** MVP.
**Features.** [DRV-STEER-QUEUE](features/DRV-STEER-QUEUE.md), [DRV-HOOK-POLICY](features/DRV-HOOK-POLICY.md).
**Sources.** [DRV-STEER-QUEUE](features/DRV-STEER-QUEUE.md) already names `pending-prompt-service.ts` as the reuse target. The "additive versus contradictory" split is the interesting open question and claude-drive has a shipped classifier for it. See W-12.

### W-11 · Raise a hand and redirect

**Actors.** Human, pair partner, kernel interrupt policy.
**Trigger.** The human wants the partner to stop.

**Happy path.**
1. The human raises a hand from the call strip or a composer shortcut.
2. The UI immediately shows "finishing current step". The running tool completes. No new tool starts.
3. The partner acknowledges the hand.
4. The human speaks. The kernel classifies what follows as stop, clarify, redirect, or fresh start.
5. The partner resumes, replans, or stops accordingly.

**Failure and interrupt.** A hard-cancel escape stays one press away and maps to Cline's existing cancel channel. If the current tool is a long build, the pause feels slow. That is the known risk and the mitigation is the immediate acknowledgment plus the escape.

**Surfaces.** Call strip, composer shortcut, kernel, turn loop.
**Tier.** MVP.
**Features.** [DRV-INTERRUPT](features/DRV-INTERRUPT.md), [DRV-KERNEL](features/DRV-KERNEL.md).
**Sources.** [DRV-INTERRUPT](features/DRV-INTERRUPT.md). The four-way classification matches claude-drive's shipped `interruptPolicy.ts`, described as a "pure barge-in classifier (stop/clarify/redirect/fresh)" (`claude-drive:CLAUDE.md`, voice key files). That module is pure and has no VS Code or CLI dependency, so it is the single best port candidate in either sibling repo.

### W-12 · Barge in and revise instead of restarting

**Actors.** Human, pair partner, voice loop.
**Trigger.** The human talks over the partner while it is speaking or answering.

**Happy path.**
1. Speech from the human preempts TTS immediately.
2. The utterance is classified against the in-flight answer.
3. If it refines, the answer is revised in place and keeps the context already built.
4. If it contradicts, the turn is redirected.
5. The human never has to repeat the parts that were already understood.

**Failure and interrupt.** With TTS off there is nothing to barge into, so the same intent arrives as a steer (W-10) or a hand raise (W-11). Misclassifying a refinement as a contradiction throws away work, so the default leans toward revise.

**Surfaces.** Voice, TTS, kernel interrupt policy, narration.
**Tier.** MVP. It rides phase 3 voice but the policy is phase 0 kernel work.
**Features.** [DRV-INTERRUPT](features/DRV-INTERRUPT.md), [DRV-MIC](features/DRV-MIC.md), [DRV-TTS](features/DRV-TTS.md). `GAP`: revise-not-restart is not currently an acceptance criterion anywhere. It should be one on [DRV-KERNEL](features/DRV-KERNEL.md) alongside the interrupt policy.
**Sources.** claude-drive ships this as P3 of its voice loop. "Talking over an in-flight answer stops the speech and *revises* the answer based on what you said, rather than starting from scratch" (`claude-drive:docs/VOICE.md`). The classifier is `claude-drive:src/interruptPolicy.ts`, four outcomes, with an empty interrupt degrading to `stop` and a missing gist degrading to `fresh`. The client sends an interrupt context of turn id, elapsed milliseconds, and characters spoken so far, which is what lets the revise prompt say "you were mid-answer". Copy the shape, not the transport. `claude-drive:docs/VOICE.md` documents `POST /voice/stop` and `POST /voice/listen`, but those routes are not in its server today. The barge stop is client-side and the interrupt rides `POST /voice/utterance`. Take the classifier and the interrupt context, and let the hub own the signal.

### W-13 · Follow the plan cursor

**Actors.** Human, pair partner.
**Trigger.** A multi-step task is underway.

**Happy path.**
1. The partner publishes plan steps as typed events.
2. The now/next strip shows the current step and the one after it.
3. The human can see where they are without reading the whole feed.
4. Finishing a step advances the cursor.

**Failure and interrupt.** A replan rewrites the cursor rather than appending, and says so. A task with no plan shows no strip rather than a fake one-step plan.

**Surfaces.** Now/next strip, stage, room feed.
**Tier.** MVP.
**Features.** [DRV-NOWNEXT](features/DRV-NOWNEXT.md), [DRV-EVENTS](features/DRV-EVENTS.md).
**Sources.** [03-research-inventory.md](03-research-inventory.md) maps this to the already-bundled `ai-elements/{plan,task}.tsx`.

### W-14 · Read the room versus read one agent

**Actors.** Human.
**Trigger.** The human wants to know either what was decided or what a specific agent actually did.

**Happy path.**
1. The room transcript is the everyone-visible thread. Decisions, narration, human messages.
2. Clicking a roster row focuses that agent's stream. Tools, outputs, its own narration.
3. Going back to the room preserves scroll and context.

**Failure and interrupt.** With one agent in the roster the two views must not feel like duplicated chrome. The room view stays primary and the per-agent view is a drill-down.

**Surfaces.** Room transcript, agent stream, roster.
**Tier.** MVP.
**Features.** [DRV-TRANSCRIPT](features/DRV-TRANSCRIPT.md), [DRV-ROSTER](features/DRV-ROSTER.md).
**Sources.** [DRIVE-TAB.md](../../design/drive-wireframes/DRIVE-TAB.md) maps this to Discord's channel-versus-DM split. The open fork, true private log versus filtered view of room events, is still open there.

---

## Group C. Stage and share

### W-15 · Watch the partner work on the stage

**Actors.** Pair partner, human.
**Trigger.** The partner starts a tool.

**Happy path.**
1. A tool start emits a typed event.
2. The stage reducer applies last-event-wins and renders the current work. File and diff for an edit, output for a command, results for a test run.
3. The human watches without owning the keyboard.
4. The tool ends and the stage returns to idle or to the next event.

**Failure and interrupt.** A reload mid-task rebuilds the same stage from the event log. Events the client cannot render at its schema version degrade to a typed placeholder, not a crash.

**Surfaces.** Stage, event stream.
**Tier.** MVP.
**Features.** [DRV-STAGE](features/DRV-STAGE.md), [DRV-EVENTS](features/DRV-EVENTS.md).
**Sources.** [01-architecture.md](01-architecture.md) D4. cursor-drive's Agent Screen is the same idea one generation earlier, an activity feed of operator work with files touched and decisions made, and it explicitly stays view-only. "Remote control path for S-AS (remains view-only per invariants)" (`cursor-drive:docs/architecture/adr/ADR-0022-mob-programming-cockpit.md`, Deferred).

### W-16 · Take the stage and explain something

**Actors.** Human, pair partner.
**Trigger.** Typing a spec is slower than showing the thing.

**Happy path.**
1. The human takes the stage. The sharer pointer flips to `human`.
2. The human pins a selection, a file, or a terminal as the share payload.
3. The human talks through it. Captions feed the transcript, which the partner reads as context.
4. The human hands the stage back.
5. The partner implements and cites the walkthrough.

**Failure and interrupt.** Contention over the stage is resolved by the pointer, not by racing. Structured share is the MVP. Pixel capture is not on the MVP path.

**Surfaces.** Stage, share control, captions, transcript.
**Tier.** MVP for structured share. Later for pixels.
**Features.** [DRV-SHARE](features/DRV-SHARE.md), [DRV-CAPTIONS](features/DRV-CAPTIONS.md), [DRV-STAGE](features/DRV-STAGE.md).
**Sources.** [DRIVE-TAB.md](../../design/drive-wireframes/DRIVE-TAB.md) product implication 5. The pixels-later boundary is [04-future-multi-user.md](04-future-multi-user.md) phase 3.

### W-17 · See what the partner decided, not just what it typed

**Actors.** Pair partner, human.
**Trigger.** The partner reaches a fork.

**Happy path.**
1. The partner names the fork, the options, and the one it took, as a decision event.
2. The decision renders distinctly in the feed and is retrievable later.
3. The human can disagree, and the disagreement becomes a steer or a redirect.

**Failure and interrupt.** Narrating every tool call buries the decisions. Decision-point density is the default and the wireframes still hold it open as a preference fork.

**Surfaces.** Narration, room feed, stage.
**Tier.** MVP.
**Features.** [DRV-NARRATION](features/DRV-NARRATION.md), [DRV-EVENTS](features/DRV-EVENTS.md).
**Sources.** Decision events already exist as a first-class MCP tool in both siblings, `agent_screen_decision` (`cursor-drive:docs/architecture/adr/ADR-0016-drive-terminology-and-hierarchy.md` rename table; `claude-drive:.claude/CLAUDE.md` MCP tool table). Narration density fork is in [`drive-wireframes/README.md`](../../design/drive-wireframes/README.md).
**Pattern worth stealing.** claude-drive's `/why` prints the decision, the stage, the confidence, and the reasoning, and never the prompt text that produced it. A decision record can be fully auditable without retaining a word of what the human said. That resolves the apparent tension between W-17 and W-26, so a decision event should carry a reference and a rationale, not a transcript excerpt.

---

## Group D. Addressing and roster

### W-18 · Address one, many, or everyone

**Actors.** Human, hub.
**Trigger.** More than one agent could plausibly receive the message.

**Happy path.**
1. The human sets the address set with a roster chip, an `@name`, or a hotkey.
2. The composer shows who will receive the next send.
3. The hub validates and delivers only to the addressed participants.
4. Unaddressed agents see the thread but do not take a turn.

**Failure and interrupt.** Sticky addressing is fewer clicks and more misfires. Whichever default ships, the composer must show the current address set before the send.

**Surfaces.** Composer, roster chips, hub send path.
**Tier.** MVP for the mechanism even at a roster of one, because retrofitting addressing onto a broadcast send path is the expensive version.
**Features.** [DRV-ADDRESS](features/DRV-ADDRESS.md), [DRV-ROSTER](features/DRV-ROSTER.md).
**Sources.** [00-vision.md](00-vision.md), "Addressing is a first-class send parameter." Enforcement sits on the send and turn path the hub and kernel already own ([01-architecture.md](01-architecture.md) D5), not in UI affordances.

### W-19 · Inspect a participant

**Actors.** Human.
**Trigger.** The human wants to know what a specific participant is, is doing, and is allowed to do — without necessarily changing transcript focus.

**Happy path.**
1. Clicking a roster row offers **Transcript** or **Profile** ([DRV-PARTICIPANT-SHEET](features/DRV-PARTICIPANT-SHEET.md)). Choosing Profile does not change the address set.
2. The profile sheet opens with a classifier strip (kind, live state, role, permission, stale).
3. For an agent it shows Overview (appearance), Capabilities (from `.driveagent/`), Access, and Files when the home exists.
4. Knowledge and recruitability blurbs appear when the portfolio graph is authored.

**Failure and interrupt.** A dismissed participant's stream stays readable until the room closes rather than vanishing mid-read. Locked definition sections show why, not a dead click.

**Surfaces.** Roster, participant sheet, agent stream, call strip.
**Tier.** MVP for chooser + classifier + Overview. Phase 2 for full home/graph sections.
**Features.** [DRV-PARTICIPANT-SHEET](features/DRV-PARTICIPANT-SHEET.md), [DRV-ROSTER](features/DRV-ROSTER.md), [DRV-TRANSCRIPT](features/DRV-TRANSCRIPT.md), [DRV-DRIVEAGENT-HOME](features/DRV-DRIVEAGENT-HOME.md).
**Sources.** Role and preset fields are specified in [04-future-multi-user.md](04-future-multi-user.md). Preset semantics come from `cursor-drive:.cursor/rules/operator-hierarchy.mdc`. Profile vs DM split is Discord/Slack IA folded into [DRIVE-TAB.md](../../design/drive-wireframes/DRIVE-TAB.md). [PRD 6](prd/prd-driveagent-portfolio.md).

### W-35 · Make an agent yours

**Actors.** Human, hub.
**Trigger.** The partner's default name or its indistinguishable text is getting in the way, usually within the first few sessions.

**Happy path.**
1. The human double-clicks the partner's name in the roster, or opens Drive settings and picks the agent.
2. They type a new display name.
3. They pick a name ink and, optionally, a separate body ink, with a live two-line preview.
4. The hub writes the durable profile and reprojects appearance onto the seated participant in the same operation.
5. Roster, byline, address chip, call strip, and transcript all repaint on the next broadcast. No reseat, no reload.
6. Reset to defaults restores the hashed name ink and the muted body ink, per field or for the whole profile.

**Failure and interrupt.** A chosen ink that cannot meet the contrast floor against the message well is clamped by the resolver rather than rejected at input, and the editor says what it did. Renaming does not change identity, so addressing, pack membership, and events keep working through the rename. Editing the underlying `ConfiguredAgent` YAML does not change a live seat's prompt mid-turn; the roster marks it stale with a reseat affordance.

**Surfaces.** Roster row, Drive settings panel, transcript, call strip.
**Tier.** MVP. This is the phase 1 delight cut of the platform config surface.
**Features.** [DRV-AGENT-PROFILE](features/DRV-AGENT-PROFILE.md), [DRV-PLATFORM-CONFIG](features/DRV-PLATFORM-CONFIG.md), [DRV-ROSTER](features/DRV-ROSTER.md).
**Sources.** [06-platform-config.md](06-platform-config.md), the `AgentProfile` overlay and the derived-appearance rule. Ink tokens over hex follow the host theme's OKLCH authoring in `apps/cline-hub/src/webview/src/index.css` and the accent restraint in [CLINE-BRAND-TOKENS.md](../../design/drive-wireframes/CLINE-BRAND-TOKENS.md). Naming an agent as a first-class act is prior art from `claude-drive:src/voiceAgents.ts`.

### W-37 · Open transcript versus profile from the roster

**Actors.** Human, hub.
**Trigger.** The human clicks a nested roster member under a live call (Drive-tab Discord IA).

**Happy path.**
1. The chooser offers Transcript and Profile.
2. Transcript focuses that agent's stream and sets address-follows-focus to that agent (main-chat demo invariant).
3. Profile opens the sheet without stealing focus or changing address.
4. From Profile, “To: this agent” can set address without closing the sheet.

**Failure and interrupt.** If DRV-TRANSCRIPT is not live yet, Transcript still selects the participant and address chip, and shows a one-line “stream lands in phase 2” rather than a blank pane.

**Surfaces.** Drive tab roster, participant sheet, transcript, composer chips.
**Tier.** MVP for the chooser and address rule. Phase 2 for full stream focus.
**Features.** [DRV-PARTICIPANT-SHEET](features/DRV-PARTICIPANT-SHEET.md), [DRV-ROSTER](features/DRV-ROSTER.md), [DRV-TRANSCRIPT](features/DRV-TRANSCRIPT.md), [DRV-ADDRESS](features/DRV-ADDRESS.md).
**Sources.** Wireframe `drive-tab-discord-slack.html` address-follows-focus; [DRIVE-TAB.md](../../design/drive-wireframes/DRIVE-TAB.md); [PRD 6](prd/prd-driveagent-portfolio.md).

### W-38 · Recruit an agent for a need and seat them

**Actors.** Human, hub, candidate agents.
**Trigger.** The human does not know which slug to add, or wants “someone good at X.”

**Happy path.**
1. From Add → Recruit (or `/recruit <need>`), the human enters a need or picks capability chips.
2. Ranked results show score reasons (matched capabilities/cases).
3. Optional pack suggestions appear when member graphs cluster on the need.
4. Choosing an agent seats via hub ops; choosing a pack uses `room_add_roster_pack`.
5. SeatCap / teamOpt still apply; gated members are reported, not silently dropped without reason.

**Failure and interrupt.** Empty index (no homes) returns one actionable line pointing at `.driveagent/`. Fuzzy need with no matches suggests editing catalogs rather than inventing agents.

**Surfaces.** Drive tab Add menu, recruit picker, roster, hub ops.
**Tier.** Phase 2 (after graph authoring). Lexical only until semantic P4.
**Features.** [DRV-RECRUIT](features/DRV-RECRUIT.md), [DRV-AGENT-GRAPH](features/DRV-AGENT-GRAPH.md), [DRV-ROSTER-PACK](features/DRV-ROSTER-PACK.md), [DRV-ROOM-MVP](features/DRV-ROOM-MVP.md).
**Sources.** [ARD-0003](ard/ARD-0003-recruit-and-roster-pack.md); harrison-site skills/projects filter pattern; [PRD 6](prd/prd-driveagent-portfolio.md).

### W-39 · Accept or reject proposed agent knowledge

**Actors.** Human, system (optional proposer).
**Trigger.** After a call, or on explicit “remember this,” the system proposes portfolio edges.

**Happy path.**
1. Proposals list node/edge drafts with evidence pointers (artifact paths, skill ids, event ids) — not raw transcripts.
2. The human accepts, rejects, or mutes each item (Constellation pattern).
3. Accept writes canonical YAML under `.driveagent/<slug>/knowledge/`, then compile refreshes `.derived/graph.json`.
4. Reject/mute leave disk unchanged aside from an optional mute list.

**Failure and interrupt.** A proposal that embeds utterance text fails validation and never reaches the accept queue ([ARD-0004](ard/ARD-0004-gated-learn-privacy.md)). Hub down means proposals stay ephemeral and are dropped on leave unless the human exported them.

**Surfaces.** Participant sheet Knowledge tab, post-call prompt, home files.
**Tier.** Phase 2 mechanism optional behind flag; full UX with DRV-AGENT-GRAPH.
**Features.** [DRV-AGENT-GRAPH](features/DRV-AGENT-GRAPH.md), [DRV-DRIVEAGENT-HOME](features/DRV-DRIVEAGENT-HOME.md), [DRV-PRIVACY](features/DRV-PRIVACY.md).
**Sources.** [ARD-0004](ard/ARD-0004-gated-learn-privacy.md); BRIEF lifecycle privacy; harrison-site Constellation confirm/reject/mute.

---

## Group E. Voice

### W-20 · Arm the mic and speak a task

**Actors.** Human, voice pipeline, partner.
**Trigger.** The human wants to talk instead of type.

**Happy path.**
1. The mic control is mute and unmute for a live call, not a per-utterance hold.
2. The human speaks. Speech becomes text in the composer.
3. Submitting sends into the same pipeline a typed message uses.
4. The partner replies, and TTS speaks the narration if it is on.

**Failure and interrupt.** Mute is enforced hub-side, not just in the UI. That is already a phase 3 gate item and it is what makes moderation carry into multi-user unchanged. No mic permission produces one actionable line, and the call stays fully usable by text.

**Surfaces.** Composer mic, call strip, hub mute enforcement.
**Tier.** MVP. Plan phase 3.
**Features.** [DRV-MIC](features/DRV-MIC.md), [DRV-TTS](features/DRV-TTS.md).
**Sources.** Mute-not-hold is a cursor-drive invariant. "Mic button is mute/unmute for continuous listening" (`cursor-drive:.cursor/rules/vision-invariants.mdc`, item 5). Its ADR-0012 was amended to make Drive-owned continuous STT primary and the host's own dictation a fallback, which is the same call Drivecode should make since the hub webview can own the mic outright. Note that cursor-drive's older journey and PRD text still describes hold-to-speak, so read the ADR over the PRD. Unmuting also stops in-flight TTS in that implementation, which is the cheap version of W-12 and worth keeping. Hub-side mute enforcement is the [TASK-GRAPH.md](TASK-GRAPH.md) phase 3 gate and [04-future-multi-user.md](04-future-multi-user.md).

### W-21 · Wake and sleep hands-free

**Actors.** Human, voice pipeline.
**Trigger.** The human wants to keep working with hands off the keyboard.

**Happy path.**
1. Always-listening is opt-in and off by default.
2. While asleep, ambient speech is ignored. Saying the wake phrase arms the loop.
3. While armed, speech becomes a turn.
4. Saying the sleep phrase puts it back to sleep.

**Failure and interrupt.** Ambient conversation must not become a turn. That is the whole point of the gate. A false wake is recoverable by an immediate sleep phrase or a hand raise.

**Surfaces.** Voice, call strip state, chip.
**Tier.** Later. Nothing in phases 0 through 4 needs it, and shipping it before the mute-based loop is proven inverts the risk order.
**Features.** `GAP`. Propose it as an explicitly deferred section of [DRV-MIC](features/DRV-MIC.md) rather than a new feature file, so the MVP does not grow a wake-word dependency.
**Sources.** claude-drive ships it as voice P2 with substring matching over short clips and no dedicated wake-word engine, called out as "a deliberate dependency-free tradeoff" (`claude-drive:docs/VOICE.md`, Wake / sleep words). Its detection is client-side in the HUD, not a daemon route, which is the shape to copy. cursor-drive's wake word is not a live audio gate at all. It is a phrase check on an already-submitted transcript (`cursor-drive:docs/design/ux/voice-mic-vs-wake-word-model.md`), which is why its own storyboard rates continuous capture as critical unsolved friction F9. It also has a sleep word that deactivates Drive the same way. Cline can do the real version because it owns its webview. It still should not be MVP.
**Warning.** cursor-drive's code default wake phrase and its documented one disagree. Whatever Drivecode picks, put the default in one place and have the UI read it, or the same drift arrives here.

### W-22 · Correct what was heard

**Actors.** Human.
**Trigger.** The transcript is wrong.

**Happy path.**
1. Captions render live during the turn.
2. The human edits the caption or the composer text before sending.
3. The corrected text is what enters the pipeline.

**Failure and interrupt.** A correction after send becomes a steer (W-10). No caption residue is left on disk after the session, which is a phase 3 gate item.

**Surfaces.** Captions, composer.
**Tier.** MVP. Plan phase 3.
**Features.** [DRV-CAPTIONS](features/DRV-CAPTIONS.md), [DRV-PRIVACY](features/DRV-PRIVACY.md).
**Sources.** [TASK-GRAPH.md](TASK-GRAPH.md) phase 3 gate, "speak a task, correct a caption, hear narration, mute mid-sentence".

### W-23 · Make it quiet

**Actors.** Human.
**Trigger.** TTS is in the way. A meeting, a shared office, a long output.

**Happy path.**
1. One control suppresses partner speech for the session without leaving the call.
2. Narration keeps rendering in the feed.
3. Turning it back on resumes speaking from the next narration, not from the backlog.

**Failure and interrupt.** Quieting must never also mute the human's mic, and muting the mic must never also stop TTS. They are two independent controls.

**Surfaces.** Call strip, voice.
**Tier.** MVP. Plan phase 3.
**Features.** [DRV-TTS](features/DRV-TTS.md). `GAP` on the independence assertion between mic mute and TTS suppression.
**Sources.** claude-drive exposes this as a wake-worded session command, `"hey drive, quiet mode"` setting `voice.ttsEnabled=false` for the session (`claude-drive:docs/dynamic-agent/user-experience.md` §6).

### W-34 · Confirm what Drive heard before it acts

**Actors.** Human, hooks, kernel.
**Trigger.** A spoken utterance reaches the send path and does not read like a clean instruction.

**Happy path.**
1. Filler and disfluency are stripped. Tier 0, regex, no model call.
2. If the result still reads like dictation, an optional cheap rewrite is offered.
3. The human picks the cleaned version, the original, or edits it.
4. The chosen text is what the partner receives, and it is visible before the turn starts.

**Failure and interrupt.** This is the single most flow-breaking thing cursor-drive shipped. An approval popup on every voice turn destroys hands-free use, which its own storyboard rates as friction F15. Default the rewrite off, or auto-approve when voice is on, and never make it a modal.

**Surfaces.** Composer, hooks, kernel.
**Tier.** MVP for the Tier 0 cleanup. Later for any model-backed rewrite.
**Features.** [DRV-HOOK-POLICY](features/DRV-HOOK-POLICY.md) owns the honest mutation contract, which is exactly the right home. `GAP`: nothing currently says what may rewrite a prompt, only that rewriting must be explicit, typed, and logged. Name the allowed rewriters in [DRV-HOOK-POLICY](features/DRV-HOOK-POLICY.md).
**Sources.** cursor-drive's pipeline order is filler cleaning, glossary expansion, sanitizing, then optimizer, then gates, then memory injection, then routing (`cursor-drive:docs/design/ux/drive-mode-user-journey.md` §4 and `cursor-drive:docs/design/architecture/prompt-pipeline-design.md`). claude-drive keeps the same order (`claude-drive:CLAUDE.md`, prompt pipeline). Drivecode should keep the hygiene stages and drop the approval modal. The known failure of over-aggressive filler cleaning, removing semantically meaningful words, is cursor-drive failure mode X9.

---

## Group F. Safety, policy, privacy

### W-24 · Approve or deny a high-impact action

**Actors.** Pair partner, human, approval gate.
**Trigger.** The partner is about to do something high-impact.

**Happy path.**
1. The gate intercepts before the action.
2. The human sees what will happen, to what, and why the gate fired.
3. Approve proceeds. Deny blocks with an actionable reason, and the partner replans rather than retrying.

**Failure and interrupt.** A denied action must not silently retry. A gate that fires repeatedly against the same participant is itself a signal, not just noise. Both siblings throttle on that signal at the same thresholds, three blocks or five warns, which is a ready-made default rather than a number to invent.

**Surfaces.** Room feed, call strip, kernel policy.
**Tier.** MVP.
**Features.** `GAP`. This is the largest single gap in the current feature set. No DRV feature owns approval gates. [DRV-HOOK-POLICY](features/DRV-HOOK-POLICY.md) owns the interception mechanism and [DRV-PRIVACY](features/DRV-PRIVACY.md) owns data handling, but neither owns "the human approves a dangerous action". Propose `DRV-GATES`, phase 0 or 1, owning the policy table and the approve/deny surface.
**Sources.** Both siblings treat this as non-negotiable. "High-impact actions (pr_create, code_change) require explicit approval gates. Do not bypass policy checks; denied actions must block with actionable reasons" (`cursor-drive:.cursor/rules/policy-pack.mdc`). cursor-drive's ADR-0020 adds the escalation-rate idea, flagging "operators that repeatedly trigger approval gates (suggests the operator is fighting the guardrails)" (`cursor-drive:docs/architecture/adr/ADR-0020-agent-steering-control-plane.md`, Phase 2). claude-drive ships `approvalGates.ts` plus `approvalQueue.ts` with per-operator throttling (`claude-drive:CLAUDE.md`).

### W-25 · Hit a policy block and understand why

**Actors.** Human, policy layer.
**Trigger.** A command or prompt matches a blocked pattern.

**Happy path.**
1. Evaluation is Tier 0. Regex, no model call.
2. The block names the matched policy and the reason.
3. The human either rephrases or, for a warn-level rule, confirms explicitly.

**Failure and interrupt.** User-defined policies may restrict but never weaken a built-in block. A false positive is a policy bug and should be reportable from the block message.

**Surfaces.** Composer, room feed, config.
**Tier.** Phase 2 for user-editable policies. MVP for the built-in blocks that W-24 needs.
**Features.** `GAP`, same proposed `DRV-GATES` owner as W-24.
**Sources.** `cursor-drive:docs/architecture/adr/ADR-0020-agent-steering-control-plane.md` decides YAML-driven policy at Tier 0 with the rule that "user policies cannot weaken built-in blocks". Tier 0 default is `cursor-drive:.cursor/rules/tiered-model-routing.mdc`.

### W-26 · Verify the session left nothing behind

**Actors.** Human, system.
**Trigger.** The session ends, or the human wants to check the privacy claim.

**Happy path.**
1. Strict mode is the default. No raw audio retention, no transcript persistence.
2. After the session there are no audio or transcript artifacts on disk.
3. Enabling debug persistence is explicit and visible while it is on.

**Failure and interrupt.** A crash must not leave a partial transcript. Event history is capped, and the cap is stated rather than implied.

**Surfaces.** Config, disk, privacy checklist.
**Tier.** MVP.
**Features.** [DRV-PRIVACY](features/DRV-PRIVACY.md).
**Sources.** [TASK-GRAPH.md](TASK-GRAPH.md) phase 3 gate, "No audio or transcript artifacts on disk after the session." claude-drive's registry-level version of the same invariant is stronger and worth copying. Its thread registry stores "only metadata (`cwd`, `claude_session_id`, `prompt_length`, sha256 `prompt_hash`)" and the prompt-free property is asserted by a test, not just documented (`claude-drive:CLAUDE.md`, privacy invariant).

---

## Group G. Beyond one partner

### W-27 · The partner asks for a specialist

**Actors.** Pair partner, human, specialist.
**Trigger.** The partner hits work outside its lane. "Let me get the test expert to look at this flake."

**Happy path.**
1. The partner emits a proposal event naming the bounded job.
2. The human approves before anything is seated. This is a high-impact action gate.
3. The specialist is seated in the roster with a preset that cannot exceed the partner's.
4. It does the bounded job. Its work renders on the stage only while it holds the stage pointer.
5. It reports and leaves.

**Failure and interrupt.** With the flag off, none of this exists and the single-partner roster cap test still passes. Dismissing the partner cascades to its specialists.

**Surfaces.** Roster, call strip, stage, kernel spawn policy.
**Tier.** Phase 2.
**Features.** [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md).
**Sources.** [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md). The preset-capping rule is `cursor-drive:.cursor/rules/operator-hierarchy.mdc`, "Children cannot exceed parent preset" and "Cascade dismiss". claude-drive's locked D4 reserves subagents strictly for one-shot forks, which is the same shape as a bounded job (`claude-drive:CLAUDE.md`).

### W-28 · Review isolated agent work before it touches your branch

**Actors.** Human as reviewer, specialist, system.
**Trigger.** More than one agent is producing changes, or the human wants an audit step before changes land.

**Happy path.**
1. Each agent works in an isolated git worktree on a deterministic branch.
2. Its changes surface as a proposal with a status, not as edits to the human's tree.
3. The human reviews changed files and any conflict indication against their own HEAD.
4. Approve puts it in a serialized apply queue. Reject closes it.
5. Apply is single-flight. A merge conflict aborts cleanly and reports, and does not deadlock the queue.

**Failure and interrupt.** Two agents editing the same file is the exact problem this prevents. Without isolation the failure is silent, which is why this is a workflow and not a nice-to-have once the team flag is on.

**Surfaces.** Stage or a dedicated review view, roster, git.
**Tier.** Phase 2, gated with [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md).
**Features.** `GAP`. Nothing in the plan owns worktree isolation or a proposal lifecycle. Propose `DRV-ISOLATION` as a phase 4 sibling of [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md), explicitly out of MVP scope. Do not build it while the roster is one partner. **Recommendation.** Note it as a known prerequisite of turning the team flag on, so the flag cannot ship without it.
**Sources.** cursor-drive built exactly this and the ADR is accepted, so the design cost is already paid. Branch naming `drive/op/<operatorId>`, path `.drive/worktrees/<operatorId>/`, proposal lifecycle `pending_review → approved → applying → applied` with `conflict / failed_apply` and `rejected` branches, single-flight FIFO apply (`cursor-drive:docs/architecture/adr/ADR-0022-mob-programming-cockpit.md`). claude-drive carries the same `worktreeManager.ts` concept (`claude-drive:AGENTS.md`).

### W-29 · Dismiss an agent and clean up

**Actors.** Human, hub.
**Trigger.** An agent is done or is going wrong.

**Happy path.**
1. Dismiss removes the participant from the roster.
2. Any running task is cancelled.
3. Children are dismissed with it.
4. Its stream stays readable for the rest of the session.

**Failure and interrupt.** A dismiss that leaves an orphaned worktree or a running task is a leak. Both siblings wire cancellation through the dismiss path for this reason.

**Surfaces.** Roster, call strip, hub ops.
**Tier.** Phase 2.
**Features.** [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md). `GAP` on cancellation semantics, which belong in [DRV-ROOM-MVP](features/DRV-ROOM-MVP.md) ops even at a roster of one.
**Sources.** "AbortController is wired through operator lifecycle. `dismiss()` cancels running tasks" (`claude-drive:CLAUDE.md`). Cascade dismiss is `cursor-drive:.cursor/rules/operator-hierarchy.mdc`. cursor-drive also releases the worktree on the completion event rather than on dismiss, and logs a release failure without failing the dismiss, which is the right ordering.

### W-33 · Fire off a side question without losing your place

**Actors.** Human, pair partner, one-shot fork.
**Trigger.** A question comes up that would derail the current turn. "While you finish that, go find out whether we already have a retry helper."

**Happy path.**
1. The human names the side question. The current turn is not interrupted.
2. A read-only one-shot fork takes the question. It is not seated in the roster and it does not get the stage.
3. The partner keeps working. The human keeps watching the stage.
4. The fork's answer arrives at a boundary, batched, not mid-turn.

**Failure and interrupt.** The word that triggers this must not fire on ordinary speech. cursor-drive's failure mode X11 is exactly that, its tangent keyword false-positives on "on a tangent, I was thinking". Require an explicit control or an unambiguous phrase. Also decide the delivery moment. Interrupting a turn to deliver a side answer defeats the purpose.

**Surfaces.** Composer, room feed, narration.
**Tier.** Phase 2.
**Features.** `GAP`. This is deliberately **not** [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md). A fork is one-shot and roster-invisible. A specialist is a seated participant. Conflating them is how the roster grows without anyone deciding it should. Note the distinction in [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md) so the flag stays about seats.
**Sources.** The distinction is claude-drive's locked D4, subagents reserved strictly for one-shot forks, kept separate from persistent threads under D3 (`claude-drive:CLAUDE.md`, locked decisions). cursor-drive built the ergonomic as a tangent keyword that spawns in the background while the foreground operator continues (`cursor-drive:docs/design/ux/drive-mode-user-journey.md` §5, and failure mode X11 in `cursor-drive:docs/design/ux/voice-user-journey-storyboard.md`). Its delivery rule is the part worth copying. Background results are batched and delivered at an idle moment, never mid-turn.

### W-36 · Add a whole pack to the call

**Actors.** Human, hub, kernel.
**Trigger.** The work has a shape the human has assembled before. "Add the cybersecurity team to the call."

**Happy path.**
1. Ahead of time, in Drive settings, the human curates a **RosterPack**: a name, a description, and an ordered list of agent profiles.
2. In the call, they use the roster header **Add**, the `/pack cybersecurity` slash command, or the picker hotkey.
3. The kernel expands the pack against the profile registry and the loaded `ConfiguredAgent`s and returns seat proposals.
4. The hub caps presets, seats what it can, tags each seated participant with a `pack:<id>` seat source, and broadcasts once.
5. The roster shows the new participants, and each row can show why it is there.
6. Removing the pack drops that source. Participants claimed by another pack or seated manually stay.

**Failure and interrupt.** A member with no matching agent file is reported by name and the rest still seat; refusing the whole pack over one missing file is the behaviour that makes people stop using packs. A member already seated gains a source rather than a duplicate seat, so adding twice is a no-op. With the team flag off the seat cap is one, so a multi-member pack seats its first member and says the rest are gated — packs are a configuration feature and must not smuggle multi-agent past its own gate. Addressing a pack that has no seated members is rejected, never widened to everyone.

**Surfaces.** Drive settings pack library, roster header, composer slash command, call strip.
**Tier.** Split. MVP for authoring, the add action, and single-member seating. Phase 2 for seating more than one, which waits on [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md) and the `DRV-ISOLATION` gap below.
**Features.** [DRV-ROSTER-PACK](features/DRV-ROSTER-PACK.md), [DRV-PLATFORM-CONFIG](features/DRV-PLATFORM-CONFIG.md), [DRV-ROSTER](features/DRV-ROSTER.md), [DRV-ADDRESS](features/DRV-ADDRESS.md), gated by [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md).
**Sources.** [06-platform-config.md](06-platform-config.md), the `RosterPack` model and the `seatSources` refcount. The spoken phrase says "team" and the type never does — Cline's runtime `Team` is a different construct at `sdk/packages/core/src/extensions/tools/team/`. Preset capping and cascade dismiss are `cursor-drive:.cursor/rules/operator-hierarchy.mdc`; the named-pool ergonomic is cursor-drive's operator registry.

---

## Group H. Parity, recovery, handoff

### W-30 · Run the same call from the terminal

**Actors.** Human, hub.
**Trigger.** The human is in the TUI, not the hub webview.

**Happy path.**
1. Join, leave, roster, and a text projection of the stage all work from the TUI.
2. Presence, mode, and narration agree with the webview for the same room.
3. Switching surfaces mid-session loses nothing.

**Failure and interrupt.** Not everything survives as text. Diffs do, rendered UI does not, and the TUI should say so rather than render a degraded imitation.

**Surfaces.** TUI, hub ops.
**Tier.** Phase 2.
**Features.** [DRV-CLI-PARITY](features/DRV-CLI-PARITY.md).
**Sources.** [DRV-CLI-PARITY](features/DRV-CLI-PARITY.md) and [TASK-GRAPH.md](TASK-GRAPH.md) phase 4 gate. claude-drive's TUI is the working proof that a room-shaped session renders in a terminal (`claude-drive:CLAUDE.md`, `agentOutput.ts` and `tui.tsx`).

### W-31 · Recover when the hub is not there

**Actors.** Human, system.
**Trigger.** The hub is down, restarting, or on a different port than the client expects.

**Happy path.**
1. The client detects the hub is unreachable and says so in one line with the action to take.
2. Room state is not lost, because the client never owned it.
3. Reconnect reattaches and replays.

**Failure and interrupt.** A stale port or discovery file is a classic and both siblings have been bitten by it. The recovery instruction must be concrete, not "check your configuration".

**Surfaces.** Drive tab, room view, TUI, hub discovery.
**Tier.** MVP.
**Features.** `GAP`. Reconnect and degraded-state UX has no owner. It belongs in [DRV-ROOM-MVP](features/DRV-ROOM-MVP.md) as an acceptance criterion rather than a new feature.
**Sources.** cursor-drive's storyboard lists port conflict as failure mode X1, mitigated only by "warning toast only", and notes the user "may not notice" (`cursor-drive:docs/design/ux/voice-user-journey-storyboard.md`). claude-drive documents the stale port file explicitly. "If a previous server crashed, this stale file may cause `node out/cli.js port` to report an incorrect URL" (`claude-drive:AGENTS.md`). Learn from both. This is a real, repeated, cheap-to-fix failure.

### W-32 · Hand the work to the next session or the next person

**Actors.** Human, pair partner, kernel.
**Trigger.** The work is not finished and someone else, or a later self, has to pick it up.

**Happy path.**
1. The human asks for a handoff, or ends the session (W-05).
2. The kernel assembles files touched, commands run, plan state, decisions, and open items.
3. The output is readable without the room. It is a document, not a scroll of events.

**Failure and interrupt.** A handoff that only summarizes the last turn is worse than none. It must be assembled from the whole room history, capped as the privacy rules require.

**Surfaces.** Room feed, kernel, exportable text.
**Tier.** MVP.
**Features.** [DRV-LEAVE-END](features/DRV-LEAVE-END.md).
**Sources.** [03-research-inventory.md](03-research-inventory.md) already names "handoff explain" as a required workflow. cursor-drive has a whole guide for the human-to-human case (`cursor-drive:docs/guides/handoff.md`).

---

## Group I. SDLC and requirements leadership

Senior engineering leadership on the call. Drive is not only “write the code faster.” For humans with less product, architecture, or delivery experience, the pair partner must be able to run an effective SDLC loop: frame the problem, gather requirements, force decisions, map coverage, freeze a phase entry gate, and teach *why* while doing. These workflows are the productization of [LEADERSHIP-BRIEF.md](LEADERSHIP-BRIEF.md). Feature owner: [DRV-SDLC-GUIDE](features/DRV-SDLC-GUIDE.md).

### W-40 · Start a discovery call (frame the problem)

**Actors.** Human, pair partner.
**Trigger.** The human is about to build something underspecified, or says phrases like “help me figure out what to build,” “let’s gather requirements,” “I don’t know where to start.”

**Happy path.**
1. The partner does **not** jump into tools. It restates the problem in one or two sentences and asks what “done” would look like for the next slice.
2. Stage shows a **Problem** card and an **Open questions** card.
3. The partner lists binding constraints it already knows (hub single-writer, privacy-strict, Bun only, RosterPack≠Team, events-first) only when they affect the problem — not as a lecture.
4. The human confirms or corrects the problem statement before any implementation turn starts.

**Failure and interrupt.** If the human says “just build X,” the partner acknowledges and switches to W-08 without guilt. If the human cannot name a user, the partner proposes a default persona and marks it assumed. Raising a hand cancels discovery and returns to the prior mode.

**Surfaces.** Room feed, stage, composer/voice, narration.
**Tier.** MVP.
**Features.** [DRV-SDLC-GUIDE](features/DRV-SDLC-GUIDE.md), [DRV-NARRATION](features/DRV-NARRATION.md), [DRV-STAGE](features/DRV-STAGE.md), [DRV-SKILL-PORT](features/DRV-SKILL-PORT.md).
**Sources.** [LEADERSHIP-BRIEF.md](LEADERSHIP-BRIEF.md); vision “Senior-engineer tone” and “teaches while doing” ([00-vision.md](00-vision.md)); BRIEF-style problem framing from prior art in the Driveagent PRD stack.

### W-41 · Gather and structure requirements

**Actors.** Human, pair partner.
**Trigger.** Discovery has a problem statement (W-40), or the human asks to “write requirements,” “MoSCoW this,” or “what are the non-goals?”

**Happy path.**
1. The partner interviews for users, must-haves, nice-to-haves, and explicit non-goals.
2. Stage accumulates **Requirement** cards tagged Must / Should / Could / Won’t.
3. At least one **Won’t** / non-goal is written down (scope control is the point).
4. Constraints that are product rules (privacy, single-writer, naming) appear as constraint cards, not buried in chat.
5. The partner reads back the MoSCoW set and asks what would falsify the Must list.

**Failure and interrupt.** Infinite interview is a failure. Cap clarifying questions; prefer a provisional Must list marked “assumed.” If requirements conflict, the partner surfaces the conflict as an open question rather than silently picking.

**Surfaces.** Stage, room feed, optional export into handoff text.
**Tier.** MVP for the loop and stage cards. Phase 2 for recruitable tech-lead agent homes that specialize in this.
**Features.** [DRV-SDLC-GUIDE](features/DRV-SDLC-GUIDE.md), [DRV-STAGE](features/DRV-STAGE.md), [DRV-NARRATION](features/DRV-NARRATION.md).
**Sources.** [prd/prd-success-metrics.md](prd/prd-success-metrics.md) MoSCoW usage; [LEADERSHIP-BRIEF.md](LEADERSHIP-BRIEF.md) requirements priorities.

### W-42 · Facilitate an architecture or product decision

**Actors.** Human, pair partner.
**Trigger.** A fork appears (“should we…?”, “home vs facets,” “monorepo vs separate repo”), or the human asks “help me decide.”

**Happy path.**
1. The partner names the decision in one line and refuses a false binary when a third option exists.
2. Stage shows ≥2 **Option** cards with consequences (positive / negative / verification).
3. The partner gives a **Recommendation** with rationale tied to constraints, then asks the human to accept, amend, or defer.
4. On accept, a **Decision** card is pinned (session-tier). Durable ARD/DEC files are written only when the human asks to record them in the repo (and gates apply if the write is high-impact).
5. The partner states what is now *not* open, so implementers do not re-litigate it mid-PR.

**Failure and interrupt.** “It depends” without a default is a failure for MVP guidance. Every facilitation ends with a recommended default plus an escape hatch. If the human defers, the open question stays on stage and blocks only the slices that truly require it (see W-44).

**Surfaces.** Stage, feed, optional repo write via gated tools.
**Tier.** MVP for facilitation + stage cards. Phase 2 for one-click “write DEC/ARD from stage.”
**Features.** [DRV-SDLC-GUIDE](features/DRV-SDLC-GUIDE.md), [DRV-STAGE](features/DRV-STAGE.md), [DRV-GATES](features/DRV-GATES.md) when recording to disk, [DRV-ADR](features/DRV-ADR.md) as the doc pattern.
**Sources.** [ard/ARD-0000-status-board.md](ard/ARD-0000-status-board.md); [decisions/](decisions/); arena-style optioning from `drivecode-sdk/decisions.tsv`.

### W-43 · Map workflows and find coverage gaps

**Actors.** Human, pair partner.
**Trigger.** The human asks “what can a user do?”, “are we missing workflows?”, or “map this to Drive workflows.”

**Happy path.**
1. The partner lists user sequences as workflow-shaped rows (trigger → happy path → failure), not as feature brainstorms.
2. Stage shows a **Coverage** card: workflow ↔ owner feature, or UNMAPPED/GAP.
3. Gaps are ranked by cost of finding them late (same spirit as this catalog’s gap list).
4. The partner proposes the smallest owner (new DRV feature vs AC on an existing one) rather than a new subsystem by default.

**Failure and interrupt.** A map with no failure paths is rejected by the partner as incomplete. If the catalog already has entries, the partner cites IDs (W-nn) instead of inventing duplicates.

**Surfaces.** Stage, feed, optional link to `05-workflows.md` when editing the plan set.
**Tier.** MVP for in-room mapping. Phase 2 for writing back into the plan catalog under gates.
**Features.** [DRV-SDLC-GUIDE](features/DRV-SDLC-GUIDE.md), [DRV-STAGE](features/DRV-STAGE.md), [MATRIX-workflow-coverage.md](MATRIX-workflow-coverage.md) as the durable twin.
**Sources.** This file’s catalog method; Subtract Before You Add.

### W-44 · Freeze a phase entry gate before building

**Actors.** Human, pair partner.
**Trigger.** The human is ready to implement, or asks “can we start coding?”, “what’s the entry checklist?”, “are we ready for phase 0?”

**Happy path.**
1. The partner refuses to start schema/implementation work while a load-bearing fork is still unmarked (SoT, package boundary, privacy invariant, etc.).
2. Stage shows a **Phase entry checklist** of decisions and invariants — not dates.
3. Each unchecked item is either decided now (W-42), explicitly deferred with a non-blocking rationale, or marked blocking.
4. On green, the partner states the first verifiable implementation slice and the verify command / smoke that will prove it.
5. Handoff/export can copy the checklist for the next session (W-32).

**Failure and interrupt.** “We’ll figure it out in the PR” on a one-way door is challenged once, then the human can override. Calendar estimates are declined; the partner rewrites them as dependency order.

**Surfaces.** Stage, feed, handoff.
**Tier.** MVP.
**Features.** [DRV-SDLC-GUIDE](features/DRV-SDLC-GUIDE.md), [CHECKLIST-phase0-entry.md](CHECKLIST-phase0-entry.md) as the template example, [DRV-LEAVE-END](features/DRV-LEAVE-END.md).
**Sources.** [TASK-GRAPH.md](TASK-GRAPH.md) gates; [CHECKLIST-phase0-entry.md](CHECKLIST-phase0-entry.md).

### W-45 · Teach while doing (mentor mid-implementation)

**Actors.** Human, pair partner.
**Trigger.** Default senior posture during W-08+, or the human asks “why are we doing it this way?”, “explain like I’m new,” “what should I learn from this?”

**Happy path.**
1. Before a non-obvious edit, the partner narrates the decision in one short beat (not a keystroke tour).
2. After a meaningful tool batch, the partner ties the result back to a requirement, constraint, or decision card on stage.
3. When the human makes a junior mistake the partner has seen (second daemon, prompts in facets, silent memory, Team vs RosterPack), it corrects with the invariant name and a concrete fix — not shame.
4. The human can ask for ELI5; the partner switches register without changing the plan.
5. Teaching never blocks interrupt or steer (W-10, W-11).

**Failure and interrupt.** Wall-of-text teaching is a failure. Quiet mode / “skip the lesson” suppresses mentoring narration for the session. If stage cards do not exist yet, the partner teaches from constraints alone and offers W-40.

**Surfaces.** Narration, stage, feed, voice/TTS later.
**Tier.** MVP (text narration). Phase 3 inherits voice.
**Features.** [DRV-SDLC-GUIDE](features/DRV-SDLC-GUIDE.md), [DRV-NARRATION](features/DRV-NARRATION.md), [DRV-SKILL-PORT](features/DRV-SKILL-PORT.md), [DRV-PARTNER-MVP](features/DRV-PARTNER-MVP.md).
**Sources.** [00-vision.md](00-vision.md) “Senior-engineer tone”; cursor-drive `drive-persona` teaching posture; this repo’s review ELI5 practice ([docs/reviews/](../../reviews/) when present).

---

## Coverage and gaps

Forty-five workflows. W-37 through W-39 cover participant sheet, recruit, and gated knowledge accept. W-40 through W-45 cover SDLC / requirements leadership. Several entries split across tiers (W-07, W-16, W-19, W-25, W-34, W-36, W-37, W-38, W-39, W-41, W-42, W-43). A split workflow lands its mechanism early and its full behaviour later, so it appears in two gates.

| Group | Workflows |
|---|---|
| A. Session lifecycle | W-01 through W-07 |
| B. The work loop | W-08 through W-14 |
| C. Stage and share | W-15, W-16, W-17 |
| D. Addressing and roster | W-18, W-19, W-35, W-37, W-38, W-39 |
| E. Voice | W-20 through W-23, W-34 |
| F. Safety, policy, privacy | W-24, W-25, W-26 |
| G. Beyond one partner | W-27, W-28, W-29, W-33, W-36 |
| H. Parity, recovery, handoff | W-30, W-31, W-32 |
| I. SDLC and requirements leadership | W-40 through W-45 |

### Gaps ranked by cost of finding them late

1. **Approval gates (W-24, W-25).** Owner is now [DRV-GATES](features/DRV-GATES.md). Remaining work is taxonomy wiring + feed-card UI, not finding an owner.
2. **Hub-unreachable and reconnect UX (W-31).** ACs landed on [DRV-ROOM-MVP](features/DRV-ROOM-MVP.md) / [ops/hub-drive-ops.md](ops/hub-drive-ops.md); implement and smoke.
3. **Worktree isolation and proposal review (W-28).** Owner [DRV-ISOLATION](features/DRV-ISOLATION.md); hard dependency of [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md).
4. **Revise-not-restart (W-12).** AC added on [DRV-KERNEL](features/DRV-KERNEL.md) via leadership DEC; implement tests.
5. **Multi-room focus semantics (W-07).** Closed as Recommended in [DEC-open-product-forks](decisions/DEC-open-product-forks.md) (`focus-room`, unfocused view-only); implement.
6. **Catch-up on re-join (W-06).** Orientation line owned per DEC; implement as second consumer of handoff/stage projection.
7. **Mic mute and TTS suppression independence (W-23).** One line of acceptance criteria on [DRV-TTS](features/DRV-TTS.md) and [DRV-MIC](features/DRV-MIC.md).
8. **Dismiss cancellation semantics (W-29).** Belongs in room ops even at a roster of one.
9. **Nothing names what may rewrite a prompt (W-34).** [DRV-HOOK-POLICY](features/DRV-HOOK-POLICY.md) + facet `#28`; enumerate allowlist.
10. **One-shot fork versus seated specialist (W-33).** Still deferred; say the boundary in [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md) so the flag stays about roster seats.
11. **SDLC guidance stage schemas (W-40–W-45).** New owner [DRV-SDLC-GUIDE](features/DRV-SDLC-GUIDE.md); without event shapes, teaching stays chat-only and is not smokeable on the stage.

### Things the siblings do that Drivecode should deliberately not do

- **Auto-routing prompts to a thread or room.** claude-drive stages it behind explicit evidence gates and keeps P1 manual-only. Drivecode's room is a human's explicit choice. Adopt the room-switch ergonomics, not the inference.
- **A second daemon.** cursor-drive's `:7891` MCP server is the transport Drivecode explicitly declined ([01-architecture.md](01-architecture.md) D2).
- **Chrome DOM interception.** cursor-drive's hardest unsolved frictions, F9 and F10, exist because it cannot own its own input surface. Cline can. Do not import the workarounds.
- **Pixel capture on the agent stage.** Named an anti-pattern in [00-vision.md](00-vision.md).
- **A confirmation modal on the way into a voice turn.** cursor-drive's prompt-optimizer approval is its own rated friction F15. Hygiene stages should be silent (W-34).
- **A bare keyword that spawns work.** cursor-drive's tangent trigger false-positives on ordinary speech, its failure mode X11. Take the ergonomic, not the trigger (W-33).
- **Mandatory process theater before join.** SDLC guidance (Group I) is on-demand. Instant join stays sacred (W-01).
## Spoken and typed triggers

[DRV-SKILL-PORT](features/DRV-SKILL-PORT.md) requires each ported skill to carry a documented trigger phrase set. Both siblings already have one, and the overlap is the safe starting point. Everything below is Tier 0 matching. No model call decides any of it.

| Intent | Phrases | Workflow |
|---|---|---|
| Plan | "let's plan", "help me plan", "think through", "clarify" | W-09 |
| Act | "go ahead", "implement", "build it", "do it", "execute" | W-09 |
| Ask | "what is", "explain", "show me", "just ask" | W-09 |
| Debug | "debug", "diagnose", "find the bug", "what's wrong" | W-09 |
| Stop | "stop", "wait", "hold on" | W-11 |
| Quiet | "quiet mode", "stop talking" | W-23 |
| Wake / sleep | configured phrase, off by default | W-21 |
| Switch room | explicit control preferred over a phrase | W-07 |
| Add a pack | `/pack <slug>`; spoken "add the cybersecurity team" matches a pack's display name, never a type name | W-36 |
| Recruit | `/recruit <need>`; Add → Recruit | W-38 |
| Roster click | chooser Transcript \| Profile; address-follows-focus only on Transcript | W-37 |
| Discovery | "let's gather requirements", "help me figure out what to build", "I don't know where to start" | W-40 |
| Requirements | "write requirements", "MoSCoW this", "what are the non-goals" | W-41 |
| Decide | "help me decide", "what are the options", "should we…" | W-42 |
| Coverage map | "map the workflows", "what are we missing", "coverage gaps" | W-43 |
| Phase gate | "are we ready to build", "phase entry checklist", "can we start coding" | W-44 |
| Teach / ELI5 | "why are we doing this", "explain like I'm new", "what should I learn", "skip the lesson" | W-45 |

The mode rows are `cursor-drive:.cursor/rules/drive-modes.mdc` verbatim and are already mirrored into this repo's plugin rules. The stop and quiet rows are claude-drive's wake-worded session commands (`claude-drive:docs/dynamic-agent/user-experience.md` §6). Three rows are deliberately not bare phrases. Switching rooms, seating a participant, and adding a pack are explicit acts, per W-07, W-33, and W-36. Group I phrases start guidance loops; they must not auto-fire on ordinary coding talk — Tier 0 match with clear intent words, and “just build X” always escapes to W-08.

## Highest-signal prior art

Read these before designing any workflow above.

| Source | Why |
|---|---|
| `claude-drive:docs/VOICE.md` | The only shipped, end-to-end voice loop across both siblings. Wake, sleep, two-tier responder, barge-in revise. Read it against the code. Three routes it documents do not exist, and the tier-2 responder it describes as tool-backed runs text-only in `voiceResponder.ts`. |
| `claude-drive:docs/dynamic-agent/user-experience.md` | Mechanic-by-mechanic voice UX. Listen window, override grammar, adaptive quieting. |
| `claude-drive:docs/dynamic-agent/user-journey.md` | The three-time-scale test, and the AP-1 invariant that silence is the correct default. |
| `cursor-drive:docs/design/ux/voice-user-journey-storyboard.md` | Twenty-five named frictions and thirteen failure modes from a real voice build. The best failure-path source either repo has. |
| `cursor-drive:docs/architecture/adr/ADR-0022-mob-programming-cockpit.md` | Accepted design for worktree isolation and the proposal lifecycle. |
| `cursor-drive:docs/architecture/adr/ADR-0020-agent-steering-control-plane.md` | Policy configuration and runtime steering at Tier 0. |
| `cursor-drive:docs/architecture/adr/ADR-0016-drive-terminology-and-hierarchy.md` | Why Drive, operator, and agent are three different words. Drivecode inherits the distinction as participants and roles. |
| `cursor-drive:.cursor/rules/operator-hierarchy.mdc` | Preset cascade and cascade dismiss, in rule form. |
| `cursor-drive:.cursor/rules/drive-modes.mdc` | The mode-intent phrase table, portable nearly verbatim. |
| `cursor-drive:.cursor/rules/policy-pack.mdc` | Privacy defaults and the approval-gate requirement. |
| `cursor-drive:.cursor/rules/vision-invariants.mdc` | Mute-not-hold, wake word optional, sub-modes map one to one. |
| `cursor-drive:docs/design/ux/drive-tab-vision-and-voice-flow.md` | The mic-versus-wake-word gate model, and the tabbed Drive panel IA. |
| `cursor-drive:docs/design/ux/drive-mode-user-journey.md` | The original pipeline order and the tangent-spawn flow. |
| `cursor-drive:docs/design/ux/voice-mic-vs-wake-word-model.md` | Why the wake word is a transcript check and not an audio gate. Read before promising hands-free. |
| `claude-drive:src/interruptPolicy.ts` | The four-way barge classifier, pure and dependency-free. The single best port candidate in either repo. |
| `claude-drive:CLAUDE.md` | Locked curator decisions D1 through D10, the single-writer rule, and the privacy invariant asserted by tests. |
| [`docs/design/drive-wireframes/DRIVE-TAB.md`](../../design/drive-wireframes/DRIVE-TAB.md) | This repo's own IA decision; product forks closed in [DEC-open-product-forks](decisions/DEC-open-product-forks.md). |
| [LEADERSHIP-BRIEF.md](LEADERSHIP-BRIEF.md) | SE/PM planning wave that Group I productizes as live call workflows. |

## Principles behind this catalog's choices

- **Experience First.** Entries are sequences a person performs, and every one names its failure path. A workflow with no failure path is a feature description wearing a costume. Group I exists so less-experienced humans get senior SDLC guidance as a first-class call experience, not as a side doc.
- **Model the Domain.** The catalog is a table with one shape, not a pile of prose essays, so gaps are visible by scanning a column rather than by reading.
- **Subtract Before You Add.** Most workflows map to DRV features that already exist. New feature files are proposed only when no honest owner exists (`DRV-GATES`, `DRV-ISOLATION`, `DRV-SDLC-GUIDE`).
- **Redesign from First Principles.** Wake word, auto-routing, and pixel share are all things the siblings built or planned. Each is evaluated on whether it earns a place in a room-first product, and two of the three are declined for the MVP. Mandatory process theater before join is likewise declined — guidance is on-demand.
- **Sequence Work into Verifiable Units.** Every tier maps to a plan phase whose gate can smoke the workflow end to end, which is the point of writing them down. W-44 makes that gate visible inside the call.
- **Never Block on the Human.** Open forks carry a chosen default plus an escape hatch. Sticky addressing, narration density, pause-versus-cancel, per-agent stream shape, and “just build X” during discovery all ship with a decision rather than a question.
