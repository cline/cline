# 01 · Architecture

Back to [README](README.md).

## Shape

```
apps/cline-hub
  Drive tab (primary IA) ── channels + call rooms, roster, transcripts, stage
  Chat Join call (shortcut) ── focuses active Drive room
apps/cli (TUI parity)      apps/vscode (later surface)
        │  render typed events
        ▼
sdk/packages/core/src/hub  ── single writer of room state, ws://127.0.0.1:25463
        │  room ops (join/leave/mute/stage/address), broadcast events
        ▼
sdk/packages/drive (@cline/drive) ── Drive kernel: sub-mode machine, narration policy, interrupt policy
        │  wraps native Cline session/turn lifecycle via runtime hooks
        ▼
sdk/packages/shared ── versioned drive/room event schemas, participant/roster/address types
```

Domain projection the UI and hub share:

```
DriveTab > Workspace > TextChannels[] + CallRooms[]
Room: participants[] (each with seatSources[]), roomTranscript, agentStreams[], stage (sharer human|agent), addressSet
Config: AgentProfile[] (overlay on ConfiguredAgent), RosterPack[], facet catalog
```

## Decisions

### D1. Kernel package `@cline/drive`

Drive logic lives in a new SDK package, `sdk/packages/drive`. It is a pure layer over native Cline sessions. It owns the Drive state machine (active flag plus sub-mode), the narration policy (what becomes a narration event), and the interrupt policy (pause-after-tool vs hard cancel). It has no UI, no transport, and no persistence of its own. This follows Boundary Discipline. Business logic is pure and testable without the hub or a webview.

Dependency direction stays legal per `sdk/AGENTS.md`. `shared → llms → agents → core → apps`. The kernel depends on `@cline/shared` for schemas and exposes interfaces `@cline/core` consumes. It never reaches into apps.

### D2. Hub is the single writer, port 25463

The existing hub daemon (`sdk/packages/core/src/hub/`, `ws://127.0.0.1:25463`) is the signaling plane. Room state (roster, stage sharer, mute flags, mode, address delivery) is owned by the hub and mutated only through hub ops. Clients and agents publish facts and receive broadcasts. This applies Separate Before Serializing Shared State. There is exactly one writer for the shared room object, and everything else is a derived projection.

No second daemon. The cursor-drive MCP server on `:7891` is not ported. Nothing defaults to `:7891`. Its responsibilities collapse into hub ops and kernel calls. Bun only for repo tooling.

### D3. Room-first, Drive tab primary, joinCall as façade / Chat shortcut

The core primitive is a `Room` with `Participant` members (human or agent), even in the MVP. The **Drive tab** is the primary UX home for listing and opening rooms (DRV-DRIVE-TAB). `joinCall()` remains a thin façade over `room.createOrAttach()` that builds the smallest room, one human plus one `pair_partner` agent. Chat **Join call** (DRV-TOGGLE) calls the same façade and focuses the active Drive room. It is a shortcut, not a second product surface.

This is Redesign from First Principles applied forward. Multi-user arrives later by adding participants and roles, not by rewriting the primitive. See [04-future-multi-user.md](04-future-multi-user.md) and [DRIVE-TAB.md](../../design/drive-wireframes/DRIVE-TAB.md).

### D4. Screen share is events first; bidirectional sharer pointer

The agent stage is a derived, last-event-wins projection over versioned session events (edits, commands, test results, plan steps, decisions, presence). No pixels on the agent path in the MVP, and no CRDT. A versioned event union in `@cline/shared` (DRV-EVENTS) is the contract every surface renders from. Research grounding is in [02-research-streaming.md](02-research-streaming.md).

Stage ownership is bidirectional. `sharer: human | agent` (DRV-SHARE). Human share MVP is structured (selection / file / terminal pin). WebRTC / pixel capture stays later under the multi-user media plan. For Drive MVP only the signaling plane exists.

### D5. Hooks are the honest interception path

Drive influences prompts and turns through runtime hooks in `@cline/core` (`sdk/packages/core/src/hooks/`, event names in `sdk/packages/shared/src/hooks/events.ts`). Today `prompt_submit` observes but may not rewrite. DRV-HOOK-POLICY adds an explicit, documented mutation contract rather than a side channel. No Cursor chrome DOM hacks, no monkey-patching of app internals. Address set (DRV-ADDRESS) is enforced on the send / turn path the hub and kernel already own.

### D6. Surfaces render, never own state

The hub webview Drive tab (plus Chat as shortcut), `components/ai-elements/`, and the TUI (`apps/cli/src/tui/`) are thin renderers of the same event stream. The bundled ai-elements (persona, speech-input, transcription, voice-selector, code-block, terminal, test-results, plan, task) are already in the tree. The MVP is assembly work, not component work. This is Subtract Before You Add. We wire what exists before writing anything new. Roster, transcript focus, and address chips are projections over hub state, never writable client copies.

### D7. Configuration is a typed facet catalog in three lanes, hub-written

Every user-facing knob is one entry in a const catalog that declares its owner, scope, **lane**, privacy class, conflict rule, phase, default, and schema. Values are a mapped type over the catalog, so there is no settings bag and no caller re-validates. Thirty-four facets are inventoried in [06-platform-config.md](06-platform-config.md).

The lane is what extends D2 to configuration. `durable` lives in `.cline/drive/*.json` and is written only by the hub, atomically, with workspace-over-user merge and tombstones for cross-scope deletion. `live` is room state in hub memory, moved only by room ops. `ephemeral` is client chrome that is never broadcast. A durable facet may **seed** a live one at room creation and may never **overwrite** one mid-call, which is why `drive.defaults.subMode` and `room.live.subMode` are two entries sharing one value schema.

Drive **overlays** Cline's `ConfiguredAgent` rather than forking it. `AgentProfile` owns display name, two ink channels, seat role, and permission intent; `.cline/agents/*.yaml` keeps owning prompt, tools, skills, provider, and model on its existing two-tier search path. Roster presets are `RosterPack`, never `Team` — that word belongs to Cline's runtime execution group. Seated participants carry `seatSources[]`, which is what makes overlapping packs, idempotent re-add, and cascade dismiss fall out of the data instead of out of special cases.

## Alternatives considered

- **A Drive-owned agent registry holding prompts, tools, and models alongside colors.** Rejected. It forks `.cline/agents/`, drifts from it immediately, duplicates the loader and its search-path precedence, and puts prompt text into a file users may commit. Drive owns appearance in a call and nothing else.
- **One flat settings document with no lane.** Rejected. It makes "the user changed the sub-mode" and "the user changed the default sub-mode" the same write, which breaks D2 the first time someone edits config during a live call.
- **Port cursor-drive's extension plus MCP daemon wholesale.** Rejected. It duplicates the hub, adds a second server on `:7891`, and its VS Code UI assumptions do not match the hub webview. We port skills and policy logic (DRV-SKILL-PORT), not the transport.
- **Build the stage as a separate app or panel service.** Rejected. The stage is a reducer over events the Chat view already receives. A new service adds a writer and a failure mode for no experience gain.
- **CRDT-based shared state for the room.** Rejected for MVP. There is one writer (the hub) and no offline multi-master editing. A roster with versioned snapshots plus deltas is sufficient. Revisit only if remote multi-master editing ever lands.

## Package and path map

| Concern | Owner | Path |
|---|---|---|
| Event schemas, participant types | `@cline/shared` | `sdk/packages/shared/src/drive/` (new) |
| Facet defs, `AgentProfile`, `RosterPack` schemas, migrations | `@cline/shared` | `sdk/packages/shared/src/drive/facets/` (new) |
| Drive config search paths | `@cline/shared` | `sdk/packages/shared/src/storage/paths.ts` |
| Facet catalog, pure store, pack expansion, preset capping | `@cline/drive` | `sdk/packages/drive/src/facets/` (new) |
| Durable config IO, atomic write, config ops | `@cline/core` | `sdk/packages/core/src/hub/drive-config/` (new) |
| Drive kernel (modes, narration, interrupt) | `@cline/drive` | `sdk/packages/drive/` (new) |
| Room, roster, stage ops, broadcasts | `@cline/core` | `sdk/packages/core/src/hub/collaboration/` (new) |
| Runtime hook mutation contract | `@cline/core` | `sdk/packages/core/src/hooks/` |
| Steer queue | `@cline/core` | `sdk/packages/core/src/runtime/turn-queue/` |
| Drive tab IA (rooms, roster, transcripts, address, share) | `@cline/cline-hub` | `apps/cline-hub/src/webview/src/drive/` (new) |
| Chat Join shortcut, chip, narration, stage, strip | `@cline/cline-hub` | `apps/cline-hub/src/webview/src/` |
| TUI parity | `@cline/cli` | `apps/cli/src/tui/` |
