# TASK-GRAPH · Phases and gates

Back to [README](README.md). Phases are ordered by dependency and option value, never by dates. A phase is done when its gate passes, and no later phase starts on a foundation whose gate is red. The Drive-tab MVP (phases 0 through 3) lands entirely before any multi-user media work.

Primary UX. Drive tab (channels + call rooms). Chat Join call is a shortcut into the active room. Constraints unchanged. Hub `:25463` single writer, no second MCP on `:7891` by default, Bun only, events-first agent stage, WebRTC later.

Gate smokes should exercise the workflows in [05-workflows.md](05-workflows.md), which tiers each sequence MVP (phases 0 through 3), Phase 2 (phase 4), or Later, and names the gaps no feature owns yet.

Planning entry gate before this graph. [CHECKLIST-phase0-entry.md](CHECKLIST-phase0-entry.md). Leadership defaults. [LEADERSHIP-BRIEF.md](LEADERSHIP-BRIEF.md).

## Phase 0 · Foundations

Scaffold that every later phase builds on. Schemas and the kernel land first so downstream code becomes obvious.

Features: [DRV-ADR](features/DRV-ADR.md), [DRV-EVENTS](features/DRV-EVENTS.md), [DRV-KERNEL](features/DRV-KERNEL.md), [DRV-HOOK-POLICY](features/DRV-HOOK-POLICY.md), [DRV-PRIVACY](features/DRV-PRIVACY.md), [DRV-PLATFORM-CONFIG](features/DRV-PLATFORM-CONFIG.md)

Also in this phase (schemas + compile stubs, not full UI): home/graph types per [schemas/README.md](schemas/README.md), [DRV-DRIVEAGENT-HOME](features/DRV-DRIVEAGENT-HOME.md) compile fixture, [DRV-GATES](features/DRV-GATES.md) taxonomy enums (UI later). E2E map: [SYSTEMS-ANALYSIS.md](SYSTEMS-ANALYSIS.md).

**Gate.** From `sdk/`: `bun install --frozen-lockfile && bun run build:sdk && bun run types` green with the new `@cline/drive` package included. `bun -F @cline/shared test`, `bun -F @cline/drive test`, and `bun -F @cline/core test:unit` pass, including the hook rewrite test, the schema privacy assertion, no-prompt-in-facet assertion, kernel policy tests (including revise-not-restart), and example home compile fixture. ADR/DEC board linked ([ard/ARD-0000-status-board.md](ard/ARD-0000-status-board.md)). Event types include room / participant shapes that can grow `addressSet` and stage `sharer` without a rewrite. Host port + capability descriptor + fail-closed fakeHost conformance stub exist. The facet catalog parses, merges workspace over user, honours tombstones, refuses an unknown `schemaVersion` major, and writes atomically — with two entries and no settings UI ([06-platform-config.md](06-platform-config.md)).

## Phase 1 · Drive tab + join the room

Primary chrome is the Drive tab. One call room, nested roster shell, join from the tab. Chat Join call is a shortcut into that room. Feed-level persona, narration, mode overlays, leave/end still apply. Participant sheet chooser lands; Profile shows classifier + Overview (full home editor can deepen in phase 2).

Features: [DRV-ROOM-MVP](features/DRV-ROOM-MVP.md), [DRV-DRIVE-TAB](features/DRV-DRIVE-TAB.md), [DRV-ROSTER](features/DRV-ROSTER.md), [DRV-AGENT-PROFILE](features/DRV-AGENT-PROFILE.md), [DRV-PARTICIPANT-SHEET](features/DRV-PARTICIPANT-SHEET.md), [DRV-DRIVEAGENT-HOME](features/DRV-DRIVEAGENT-HOME.md), [DRV-TOGGLE](features/DRV-TOGGLE.md), [DRV-PERSONA-CHIP](features/DRV-PERSONA-CHIP.md), [DRV-NARRATION](features/DRV-NARRATION.md), [DRV-MODE-OVERLAY](features/DRV-MODE-OVERLAY.md), [DRV-LEAVE-END](features/DRV-LEAVE-END.md), [DRV-PARTNER-MVP](features/DRV-PARTNER-MVP.md), [DRV-GATES](features/DRV-GATES.md) (emit + feed card MVP), [DRV-SDLC-GUIDE](features/DRV-SDLC-GUIDE.md) (discovery + teach-while-doing; stage cards deepen in phase 2)

**Gate.** `bun -F @cline/core test:unit` and `bun -F @cline/cline-hub test` green. The phase 1 smoke script (`smoke-phase1.md`, written under DRV-PARTNER-MVP) completes live on the hub webview: open Drive tab, join room, narrated real task, mode change, leave, re-join via Chat Join shortcut, end with handoff. Roster shows human + partner. Single-agent roster cap asserted. No process listening on `:7891`. Renaming the partner and setting both ink channels repaints roster and transcript on the next broadcast with no reseat, and no Drive-persisted file contains a prompt field. Roster click offers Transcript | Profile. Hub-down and reconnect empty states exist per [ops/hub-drive-ops.md](ops/hub-drive-ops.md). Unfocused rooms are view-only. A short discovery ask (W-40) produces Problem + Open questions in the feed without tool thrash (stage cards deepen in phase 2); “just build X” escapes to the work loop. Success metrics M1–M8 recorded ([prd/prd-success-metrics.md](prd/prd-success-metrics.md)).

## Phase 2 · Stage, share, transcript, address, portfolio depth

Screen share becomes literal inside the room view. Bidirectional stage share, room vs per-agent transcript focus, address set, call strip, now/next, steering, interruption. Persona port lands here. Roster packs, lexical recruit, and graph profile depth land here.

Features: [DRV-STAGE](features/DRV-STAGE.md), [DRV-SHARE](features/DRV-SHARE.md), [DRV-TRANSCRIPT](features/DRV-TRANSCRIPT.md), [DRV-ADDRESS](features/DRV-ADDRESS.md), [DRV-ROSTER-PACK](features/DRV-ROSTER-PACK.md), [DRV-CALL-STRIP](features/DRV-CALL-STRIP.md), [DRV-NOWNEXT](features/DRV-NOWNEXT.md), [DRV-STEER-QUEUE](features/DRV-STEER-QUEUE.md), [DRV-INTERRUPT](features/DRV-INTERRUPT.md), [DRV-SKILL-PORT](features/DRV-SKILL-PORT.md), [DRV-AGENT-GRAPH](features/DRV-AGENT-GRAPH.md), [DRV-RECRUIT](features/DRV-RECRUIT.md), [DRV-SDLC-GUIDE](features/DRV-SDLC-GUIDE.md) (requirements/decision/coverage/checklist stage cards)

**Gate.** Unit suites green (`bun -F @cline/cline-hub test`, `bun -F @cline/core test:unit`, `bun -F @cline/drive test`, `bun -F @cline/shared test`). Live smoke on a multi-tool task: stage tracks current edit/command/test; user takes stage with a structured share then returns it; address one vs everyone; room vs agent transcript focus (filtered projection); a steer queued mid-turn is acknowledged without cancel; raise-hand pauses after the current tool and resumes after a redirect. Stage replay determinism verified by reloading the webview mid-task. A single-member RosterPack adds and removes cleanly with the team flag off, the roster cap test stays green, and the `/Team|team_/` guard fails on a planted Drive identifier. Recruit returns ranked fixtures; seating goes through hub ops only. An SDLC guidance pass (W-41→W-42→W-44) leaves MoSCoW + decision + phase-entry checklist cards on stage. Metrics M9–M11 and M15–M16 recorded.

## Phase 3 · Voice (+ gated learn UI)

Mic in, TTS out, captions. Voice lands on a proven call, and privacy assertions gate it. Gated learn accept queue may ship here if graph propose path is ready.

Features: [DRV-MIC](features/DRV-MIC.md), [DRV-TTS](features/DRV-TTS.md), [DRV-CAPTIONS](features/DRV-CAPTIONS.md) (+ learn resolve UI under DRV-AGENT-GRAPH / ARD-0004)

**Gate.** `bun -F @cline/cline-hub test` and `bun -F @cline/core test:unit` green, including the hub-side mute enforcement test and caption residue test. Live smoke: speak a task, correct a caption, hear narration, mute mid-sentence (mic mute ⊥ TTS quiet). Privacy checklist from DRV-PRIVACY signed off for all three features. No audio or transcript artifacts on disk after the session.

## Phase 4 · Parity and the team option

The same call in the terminal, and the flagged first step beyond one partner. Isolation is mandatory when the flag is on.

Features: [DRV-CLI-PARITY](features/DRV-CLI-PARITY.md), [DRV-ISOLATION](features/DRV-ISOLATION.md), [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md)

**Gate.** `bun -F @cline/cli test:unit` green. Interactive TUI smoke shows the same room as the hub webview (presence, mode, narration agree). With the team flag off, the phase 1 roster-cap test still passes and the single-partner experience is unchanged. With the flag on, isolation is available and one specialist completes a bounded job with preset capping and cascade dismiss; without isolation, second-agent seat fails closed. Address set and roster remain coherent with more than one agent. A multi-member RosterPack seats under the flag: overlapping members hold one seat with two sources, removing one pack leaves the member seated, and dismissing a spawned specialist cascades without evicting a pack-claimed peer.

## Phase 5 · Multi-user (design gate only)

No build work in this plan. The desired state, phasing, and buy-not-build media decision live in [04-future-multi-user.md](04-future-multi-user.md).

**Gate.** Design review of the multi-user doc against everything the MVP shipped. Confirm the MVP foreclosed nothing: event versioning in place, roles present in the roster, mute enforced hub-side, stage reducer stream-agnostic, Drive tab IA already multi-room shaped. Remote events and any SFU purchase get their own plan after this review.

## Dependency sketch

```
Phase 0: ADR ─ EVENTS ─ KERNEL(+port) ─ HOOK-POLICY ─ PRIVACY ─ PLATFORM-CONFIG ─ home/graph schemas ─ GATES(taxonomy)
                 │         │          │                        │                      │
Phase 1:      ROOM-MVP ── DRIVE-TAB ─ ROSTER ─ AGENT-PROFILE ─ PARTICIPANT-SHEET ─ DRIVEAGENT-HOME(load)
                 │                       │         TOGGLE ─ PERSONA ─ NARRATION ─ MODE ─ LEAVE ─→ PARTNER-MVP
                 │                       │         GATES(feed card MVP) ─ SDLC-GUIDE(discovery + teach)
Phase 2:      STAGE ─ SHARE ─ TRANSCRIPT ─ ADDRESS ─ ROSTER-PACK ─ CALL-STRIP ─ NOWNEXT ─ STEER ─ INTERRUPT ─ SKILL-PORT
                 │                       AGENT-GRAPH ─ RECRUIT ─ SDLC-GUIDE(stage cards)
Phase 3:      MIC ─ TTS ─ CAPTIONS (+ gated learn UI)
Phase 4:      CLI-PARITY ─ ISOLATION ─ TEAM-OPT
Phase 5:      multi-user design review
```
