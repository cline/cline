# cline-drivemode · Plan index

**Drive** is the product; **drive coding** is the practice it names, the way "vibe coding" names one. The user opens the **Drive tab**, joins a call room, and pair-programs with a senior-engineer agent that holds the **Spotlight**. Chat Join call is a shortcut into the active room. This folder is the complete plan set. Plans only, no implementation here. Terminology is fixed in [00-vision.md](00-vision.md#naming).

UX north star decision. [DRIVE-TAB.md](../../design/drive-wireframes/DRIVE-TAB.md) and [drive-tab-discord-slack.html](../../design/drive-wireframes/drive-tab-discord-slack.html).

Repo-level continuation brief. [HANDOFF-drivecode.md](../HANDOFF-drivecode.md).

**Session handoff.** [HANDOFF.md](HANDOFF.md) — start here if you are picking this work up cold.

## Documents

| File | What it holds |
|---|---|
| [00-vision.md](00-vision.md) | Drive-tab north star and staged delivery (tab + room, stage/share/address, voice) |
| [01-architecture.md](01-architecture.md) | Kernel `@cline/drive`, hub `:25463` as single writer, room-first model, Drive tab primary, events-first stage, decisions D1 through D7 |
| [02-research-streaming.md](02-research-streaming.md) | Call-architecture research synthesis (Discord, Zoom, Meet, Teams, Webex, Huddles, Twitch) with adopted anti-patterns |
| [03-research-inventory.md](03-research-inventory.md) | Cline surface inventory, hub and hook gaps, workflows and skills to define |
| [04-future-multi-user.md](04-future-multi-user.md) | Discord-in-IDE desired state, room/participant/track model, phased media strategy |
| [05-workflows.md](05-workflows.md) | Canonical workflow catalog. 45 sequences a human performs (incl. Group I SDLC leadership), cited to cursor-drive and claude-drive prior art, tiered and mapped to DRV features or gaps |
| [06-platform-config.md](06-platform-config.md) | Platform configuration surface. `AgentProfile` and `RosterPack` domain model, 34-facet inventory with owner/scope/lane/privacy/phase, ownership matrix, phasing, open forks |
| [LEADERSHIP-BRIEF.md](LEADERSHIP-BRIEF.md) | SE lead / PM brief for the planning wave (defaults, MoSCoW, risks) |
| [SYSTEMS-ANALYSIS.md](SYSTEMS-ANALYSIS.md) | End-to-end systems analysis (context, flows, NFRs, as-is/to-be, recommendations) |
| [CHECKLIST-phase0-entry.md](CHECKLIST-phase0-entry.md) | Gate before schema freeze |
| [MATRIX-workflow-coverage.md](MATRIX-workflow-coverage.md) | Workflow ↔ feature coverage matrix |
| [decisions/](decisions/) | Leadership DECs (agent SoT, package location, product forks) |
| [ops/hub-drive-ops.md](ops/hub-drive-ops.md) | Hub op catalog and failure modes |
| [schemas/README.md](schemas/README.md) | Phase 0 schema index |
| [prd/](prd/) | Product requirements. PRD 6 Driveagent portfolio / knowledge graph / recruit; success metrics |
| [ard/](ard/) | Architecture decision records for Driveagent home, graph, recruit, gated learn (+ status board) |
| [examples/driveagent-pair-partner/](examples/driveagent-pair-partner/) | Example `.driveagent` home + BRIEF + sample graph |
| [TASK-GRAPH.md](TASK-GRAPH.md) | Phases 0 through 5 with verifiable gates |
| [AGENT-RUNBOOK.md](AGENT-RUNBOOK.md) | How agents pick tasks, spawn, verify, and report |

## SDK layer

The harness layer beneath this plan is designed in [../drivecode-sdk/](../drivecode-sdk/). It resolves `drivecode-sdk` as the same package as the `@cline/drive` kernel specified in [DRV-KERNEL](features/DRV-KERNEL.md) rather than a second one, and adds a host port, a capability descriptor, and a conformance kit to it.

Two things there amend this folder: the pure room reducer and stage projection move from `@cline/core` to `@cline/drive` so the webview can import them instead of growing a second copy ([01-architecture.md](01-architecture.md) package map), and [DRV-KERNEL](features/DRV-KERNEL.md) gains the port and the kit. Decisions D1 through D7 are unchanged.

## Features

MVP is phases 0 through 3. Future is phases 4 and 5.

| ID | Feature | Phase | Scope |
|---|---|---|---|
| [DRV-ADR](features/DRV-ADR.md) | Architecture decision record | 0 | MVP |
| [DRV-EVENTS](features/DRV-EVENTS.md) | Versioned room and drive event schemas | 0 | MVP |
| [DRV-KERNEL](features/DRV-KERNEL.md) | `@cline/drive` kernel package | 0 | MVP |
| [DRV-HOOK-POLICY](features/DRV-HOOK-POLICY.md) | Runtime hooks with honest override | 0 | MVP |
| [DRV-PRIVACY](features/DRV-PRIVACY.md) | Privacy-strict defaults | 0 | MVP |
| [DRV-PLATFORM-CONFIG](features/DRV-PLATFORM-CONFIG.md) | Facet catalog and durable config store | 0 | MVP |
| [DRV-ROOM-MVP](features/DRV-ROOM-MVP.md) | Smallest room and joinCall façade | 1 | MVP |
| [DRV-DRIVE-TAB](features/DRV-DRIVE-TAB.md) | Drive tab sidebar (channels + call rooms) | 1 | MVP |
| [DRV-ROSTER](features/DRV-ROSTER.md) | Agent roster as participants | 1 | MVP |
| [DRV-AGENT-PROFILE](features/DRV-AGENT-PROFILE.md) | Agent display name and two ink channels | 1 | MVP |
| [DRV-PARTICIPANT-SHEET](features/DRV-PARTICIPANT-SHEET.md) | Roster click: Transcript vs Profile sheet | 1 | MVP |
| [DRV-DRIVEAGENT-HOME](features/DRV-DRIVEAGENT-HOME.md) | `.driveagent/<slug>/` agent home + compile | 1 | MVP |
| [DRV-TOGGLE](features/DRV-TOGGLE.md) | Chat Join call shortcut into Drive room | 1 | MVP |
| [DRV-PERSONA-CHIP](features/DRV-PERSONA-CHIP.md) | Partner presence chip | 1 | MVP |
| [DRV-NARRATION](features/DRV-NARRATION.md) | Narration messages in the feed | 1 | MVP |
| [DRV-MODE-OVERLAY](features/DRV-MODE-OVERLAY.md) | Ask/debug overlays on the mode pill | 1 | MVP |
| [DRV-LEAVE-END](features/DRV-LEAVE-END.md) | Leave the call, end the session | 1 | MVP |
| [DRV-PARTNER-MVP](features/DRV-PARTNER-MVP.md) | One pair partner, end to end (phase gate) | 1 | MVP |
| [DRV-GATES](features/DRV-GATES.md) | High-impact approval + policy blocks | 1 | MVP |
| [DRV-STAGE](features/DRV-STAGE.md) | The Call Stage (agent work projection) | 2 | MVP |
| [DRV-SHARE](features/DRV-SHARE.md) | Bidirectional stage share (human \| agent) | 2 | MVP |
| [DRV-TRANSCRIPT](features/DRV-TRANSCRIPT.md) | Room transcript vs per-agent focus | 2 | MVP |
| [DRV-ADDRESS](features/DRV-ADDRESS.md) | Address set (one / many / everyone / pack) | 2 | MVP |
| [DRV-ROSTER-PACK](features/DRV-ROSTER-PACK.md) | Curated roster presets, added in one action | 2 | MVP |
| [DRV-AGENT-GRAPH](features/DRV-AGENT-GRAPH.md) | Per-agent portfolio knowledge graph | 2 | MVP |
| [DRV-RECRUIT](features/DRV-RECRUIT.md) | Rank agents / suggest packs for a need | 2 | MVP |
| [DRV-CALL-STRIP](features/DRV-CALL-STRIP.md) | Pinned call controls | 2 | MVP |
| [DRV-NOWNEXT](features/DRV-NOWNEXT.md) | Now/next plan cursor strip | 2 | MVP |
| [DRV-STEER-QUEUE](features/DRV-STEER-QUEUE.md) | Steering while the partner works | 2 | MVP |
| [DRV-INTERRUPT](features/DRV-INTERRUPT.md) | Raise hand | 2 | MVP |
| [DRV-SKILL-PORT](features/DRV-SKILL-PORT.md) | Port persona and mode skills | 2 | MVP |
| [DRV-SDLC-GUIDE](features/DRV-SDLC-GUIDE.md) | Senior SDLC / requirements leadership on the call | 1 | MVP |
| [DRV-MIC](features/DRV-MIC.md) | Mic input and mute | 3 | MVP |
| [DRV-TTS](features/DRV-TTS.md) | Partner voice out | 3 | MVP |
| [DRV-CAPTIONS](features/DRV-CAPTIONS.md) | Live captions | 3 | MVP |
| [DRV-CLI-PARITY](features/DRV-CLI-PARITY.md) | Drive in the TUI | 4 | Future |
| [DRV-ISOLATION](features/DRV-ISOLATION.md) | Worktree isolation for multi-agent seats | 4 | Future |
| [DRV-TEAM-OPT](features/DRV-TEAM-OPT.md) | Optional specialist agents (flagged) | 4 | Future |

Multi-user itself (rooms with several humans, remote events, optional WebRTC) is phase 5 design review territory, held in [04-future-multi-user.md](04-future-multi-user.md).

## How agents pick tasks

Short version. Lowest phase with a red gate, then a feature whose dependencies are done, then its checklist top to bottom, verify command per task. Full protocol, environment conventions, and hard constraints are in [AGENT-RUNBOOK.md](AGENT-RUNBOOK.md).

## Principles behind the plan's decisions

Each principle below drove a concrete choice you can see in the files.

- **Experience First.** The Drive tab is the product home because call feel and roster IA beat Chat-header-only entry. Chat Join stays as a shortcut. Phase order still ships a complete feel per phase.
- **Model the Domain.** `DriveTab > Workspace > CallRooms > Room(participants, transcripts, stage, addressSet)` is the typed shape schemas and UI project. Addressing is a send parameter, not an afterthought mention.
- **Redesign from First Principles.** Drive tab was folded into vision, architecture D3, and phase 1 rather than bolted onto a Chat-toggle-only story.
- **Sequence Work into Verifiable Units.** Every checklist task ends in a named verify command, every phase ends in a gate, and read-and-map tasks precede write tasks so risky assumptions fail first.
- **Foundational Thinking.** Schemas (DRV-EVENTS) and the kernel (DRV-KERNEL) are phase 0 because every later phase consumes them. The event union is the data shape that makes the stage, the TUI, and remote clients cheap.
- **Subtract Before You Add.** The plan wires bundled ai-elements instead of writing components, collapses cursor-drive's `:7891` daemon into existing hub ops instead of porting it, and reserves the media track with zero members instead of speculating schema.
- **Boundary Discipline.** Validation lives at hub ops, the kernel is pure with no transport, and surfaces render typed events without re-validating. Ask-mode enforcement sits at the tool-policy layer, not in UI affordances.
- **Separate Before Serializing Shared State.** The hub is the single writer of room state, clients hold read-only projections, and the stage is a derived reducer, so no lock or CRDT is needed anywhere in the MVP.
- **Never Block on the Human.** Preference forks (stream model, user share, accent, focus policy, pause vs cancel) ship with leadership defaults in [decisions/DEC-open-product-forks.md](decisions/DEC-open-product-forks.md) rather than blocking implementation. ARDs stay on the [status board](ard/ARD-0000-status-board.md) until formally Accepted.

## Constraints (binding on all work)

- Bun only. No npm, yarn, or pnpm anywhere in this repo.
- No Cursor or VS Code chrome DOM hacks.
- No second MCP daemon. Nothing defaults to `:7891`. The hub on `:25463` is the only server.
- Privacy-strict defaults. No audio or transcript persistence without an explicit, visible debug flag.
- No timeframes in plans or status docs.
- Drive tab is primary UX. Chat Join call is a shortcut into the active Drive room.
- **`Team` is Cline's word.** It means the runtime execution group in `sdk/packages/core/src/extensions/tools/team/`. Drive's human-curated seating preset is a **`RosterPack`**, and no Drive identifier contains `Team`. UI copy says *pack*. See [06-platform-config.md](06-platform-config.md#naming-rosterpack-not-teampack-not-team).
- Drive **overlays** appearance on the seated agent. Prompts, tools, skills, provider, and model ids are authored under `.driveagent/<slug>/` (or migration-imported from `.cline/agents/*.yaml`) and **compile** into the host runtime. They are never stored in Drive facets / `AgentProfile`. See [DEC-agent-source-of-truth](decisions/DEC-agent-source-of-truth.md).

## Implementation guidance (poteto-mode non-negotiables for implementers)

- Run the **how** skill over each unfamiliar subsystem (hub server internals, turn loop, hook engine) before changing it.
- Use the **interrogate** skill for adversarial review if a design decision here turns out to be contested in practice.
- Run `/deslop` over every diff before commit and the **unslop** skill over any prose surface.
- Keep a decision trail via the **show-me-your-work** skill for phase-scale work.
- Use Cursor's built-in **babysit** skill after opening each PR.
- Runtime verification uses **control-ui** (hub webview) and **control-cli** (TUI), as named per task.
