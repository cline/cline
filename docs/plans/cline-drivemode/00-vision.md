# 00 · Vision. The Drive-tab north star

Back to [README](README.md).

## Naming

| Term | Means | Not |
|---|---|---|
| **Drive** / **Drive mode** | The product. A call room where a human and one or more agents pair-program. This is the user-facing name — `cline-drivecode` is the repo, never the product name. | "Drivecode mode", "Drive tab mode" |
| **drive coding** | The *practice*, the way "vibe coding" names a practice. You drive-code when you steer an agent that is doing the work in front of you, on a call, in real time — narrating, sharing, and interrupting rather than prompting and waiting. Use this in prose and docs. | "driving code", "drivecoding" |
| **Spotlight** | The shared surface that shows whoever is currently sharing — agent work cards or a human pin. Every surface says "in the spotlight". | "Stage" (see below) |

**Spotlight vs stage.** The user-facing name is **Spotlight**, because the question
it answers is *who is in the spotlight right now*. The hub wire protocol still calls
this `stage` (`StageState`, `call_set_stage`, `roomSnapshot.stage`). That split is
deliberate for now: renaming the wire is a breaking change across `@cline/shared`,
the hub handlers, and every client. Surfaces render "Spotlight"; the protocol says
`stage`.

## The experience

Drive lives as a **sidebar tab of channels and call rooms**, like Discord voice inside Slack chrome. The user opens the Drive tab, picks or joins a call room, and pair-programs with a senior engineer who is sharing work on the stage. Agents appear in the room roster. The user addresses one, many, or everyone. They can focus the room thread or a single agent's stream. The stage can show agent work or a user share.

Chat **Join call** remains a shortcut that opens or focuses the active Drive room. It is not the only entry and not the product's home.

The partner narrates decisions, not keystrokes. The user watches the shared stage, steers with chat or voice, raises a hand to interrupt, and leaves whenever they want. The call persists like a Discord channel. It is a drop-in room, not a scheduled meeting. Fun matters as much as utility. Presence, warmth, and pacing are product features.

When the human has less product or architecture experience, the same call can shift into **senior engineering leadership**: frame the problem, gather requirements, facilitate decisions, map workflow coverage, freeze a phase entry gate, and teach *why* while implementing ([05-workflows.md](05-workflows.md) Group I, [DRV-SDLC-GUIDE](features/DRV-SDLC-GUIDE.md)). That guidance is on-demand. Instant join stays sacred — there is no process lobby.

Decision record and throwaway prototype. [DRIVE-TAB.md](../../design/drive-wireframes/DRIVE-TAB.md), [drive-tab-discord-slack.html](../../design/drive-wireframes/drive-tab-discord-slack.html).

## Domain shape (locked)

```
DriveTab
  Workspace
    TextChannels[]          # async chat (optional later)
    CallRooms[]             # live pair rooms
      Room
        participants[]      # human | agent; each carries seatSources[]
        roomTranscript      # everyone-visible
        agentStreams[]      # per-agent private / focused transcript
        stage               # sharer: human | agent
        addressSet          # recipients for next send
Config (durable, off to the side of the room)
  AgentProfile[]            # display name + two ink channels, overlaying ConfiguredAgent
  RosterPack[]              # curated seating presets; expand to participants
```

Addressing is a first-class send parameter. Hotkeys or chips set `everyone | {agentIds…} | {pack}` before the message hits the hub.

Configuration is a peer of the room, not a subsection of it. Its domain model, the thirty-four-facet inventory, and the ownership rules are in [06-platform-config.md](06-platform-config.md).

## What "shares screen" means

The screen is structured work state, not pixels. The partner publishes typed events for edits, commands, test runs, plan progress, and decisions. The UI renders them with the card components Cline already bundles. This is cheaper, searchable, privacy-clean, and honest about what an agent actually does. Pixel capture is an explicit anti-pattern for the MVP agent stage (see [02-research-streaming.md](02-research-streaming.md)). User share may start as structured selection share; WebRTC pixels stay later ([04-future-multi-user.md](04-future-multi-user.md)).

## The staged wireframe (locked recommendation)

Primary chrome is the Drive tab. Call Stage and voice still stage in phases. Wireframes. [docs/design/drive-wireframes/](../../design/drive-wireframes/).

- **Phase 1 is Drive tab + room join.** One Drive activity in hub left nav. Call rooms with nested roster shell. Join from the tab. Chat Join call is a shortcut into the active room. Persona, narration, and mode overlays apply to the room feed. Earlier Chat-only variant A behaviors still ship as feed/composer pieces, not as the home surface.
- **Phase 2 is the stage and room depth.** Split conversation + stage inside the room view. Bidirectional stage share (`sharer: human | agent`). Room vs per-agent transcript focus. Address set. Call strip, now/next, steer, interrupt.
- **Phase 3 is voice.** Mic, light TTS on narration, live captions. Voice comes after text plus stage because the stage is the product's core loop.

Variant C (PiP Partner) stays rejected. It trades the screen-share core for a novelty overlay and has no VS Code path.

## Who this is for

One developer and one pair partner in the MVP roster. The UI still shows the roster shape so multi-agent and multi-human do not require a chrome rewrite. Teams of agents and multiple humans are a future state ([04-future-multi-user.md](04-future-multi-user.md)). Nothing in the MVP may block that future, and nothing in the MVP builds the multi-human media plane.

## Product qualities we hold

- **Drive tab first.** The home for rooms, roster, and stage is the Drive activity. Chat Join is a shortcut.
- **Instant join.** No ceremony, no lobby, no setup wizard. Open the room and you are in.
- **Senior-engineer tone.** The partner explains why, offers options at forks, and teaches while doing. Ported from the cursor-drive persona work (DRV-SKILL-PORT) and productized as SDLC leadership workflows (DRV-SDLC-GUIDE, W-40–W-45).
- **Leadership on demand.** Requirements gathering, decision facilitation, coverage mapping, and phase-entry freezes are first-class call sequences for less-experienced builders — never a mandatory wizard before join.
- **Addressable partners.** One / many / everyone / a pack before send (DRV-ADDRESS).
- **Yours.** Rename your partner and pick its name and body colors. Curate a named pack and drop it into a call in one action. Configuration is a product surface with declared owners, not a settings dump ([06-platform-config.md](06-platform-config.md)).
- **Interruptible.** Raising a hand pauses the partner after the current tool completes. The user never fights the agent for control.
- **Private by default.** No transcript or audio persistence. Events carry metadata, not raw media (DRV-PRIVACY).
- **Leave without loss.** Leaving is a state mutation. The room and its work persist. Ending the session produces a handoff explanation.

## Non-goals for the MVP

- Multi-human calls, WebRTC, or any media server.
- Multiple concurrent agents on the stage by default (DRV-TEAM-OPT is the flagged exception).
- Pixel screen capture as the agent stage path.
- A second daemon. The hub on `:25463` is the only server. Nothing defaults to `:7891`.
- A second prompt/tool registry inside Drive call facets or `AgentProfile`. Agent definitions are authored under `.driveagent/<slug>/` and **compile** into the host runtime (see [DEC-agent-source-of-truth](decisions/DEC-agent-source-of-truth.md) and [ARD-0001](ard/ARD-0001-driveagent-home.md)). Drive overlays appearance only; there is exactly one runtime path.
