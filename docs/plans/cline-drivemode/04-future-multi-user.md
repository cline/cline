# 04 · Future. Multi-user Drive (Discord-in-IDE)

Back to [README](README.md). This is a desired-state design, not an MVP work item. Nothing here is built until the join-call MVP is proven. Everything in the MVP must be compatible with it.

## Desired state

A persistent, drop-in room attached to a repo or workspace. Humans and agents join and leave freely. One stage shows whoever is doing the work (`sharer: human | agent`). Conversation, presence, and work state flow as events. Voice is optional and arrives last. The feel is a Discord server for your codebase, not a scheduled meeting.

The MVP Drive tab already ships this IA for one workspace and one partner (see [DRIVE-TAB.md](../../design/drive-wireframes/DRIVE-TAB.md)). Multi-user extends seats, remote bridging, and media. It does not replace the tab.

## Domain model (locked)

- **Room** is the primitive. It owns a roster, a stage pointer, and event history. `joinCall()` in the MVP is a façade over `room.createOrAttach()` with the smallest roster.
- **Participant** is `human | agent`.
- **Human roles.** `host`, `co_driver`, `reviewer`, `observer`. The host spawns and dismisses agents, grants the stage, and mutes.
- **Agent roles.** `pair_partner`, `specialist`. Agent capability presets reuse the operator permission model (readonly/standard/full), and a specialist never exceeds the preset of whoever spawned it.
- **Stage** is a derived projection, never authoritative state. A last-event-wins reducer over work events plus a stage-owner pointer. Fixed render slots per the Meet virtual-stream pattern, so N agents never demand N surfaces.
- **Tracks.** `control` (room ops), `conversation` (chat and voice transcripts), `work` (edits, commands, tests, plan), `presence` (join/leave/speaking/typing), `media` (optional, phase 3 only). Tracks are separate event streams so control survives media failure.

## Phasing

- **Phase 1. Events only, local.** Everything in the MVP task graph. One machine, one hub, no remote participants. All five track types exist except media.
- **Phase 2. Remote events.** A remote participant's client bridges to the host's hub (Webex cascade pattern) over a tunnel or LAN. Same event schemas, now crossing a machine boundary. Auth and invitation become boundary concerns of the hub server. Still no media plane.
- **Phase 3. Optional WebRTC voice.** Only when two humans must hear each other. Buy the SFU. Amazon Chime SDK or LiveKit. Do not build one. Agents join voice as bot participants consuming transcripts and publishing TTS, per the Teams media-bot precedent.

## Package placement

| Concern | Package |
|---|---|
| Room, participant, track, and event schemas | `@cline/shared` (`src/drive/`) |
| Drive kernel (modes, narration, interrupt) | `@cline/drive` |
| Room runtime, roster, broadcasts, remote bridging | `@cline/core` (`src/hub/collaboration/`) |
| Call surfaces | `apps/cline-hub`, `apps/vscode`, `apps/cli` |

## What the MVP must not foreclose

- Event schemas are versioned from day one (DRV-EVENTS). Remote phase 2 consumers can negotiate versions.
- Participant and role fields exist in the roster even when the roster is always two entries.
- Mute is enforced hub-side, so server-enforced moderation carries into multi-user unchanged.
- The stage reducer takes an event stream as input, not a session object, so a remote stream is a drop-in.

## What the MVP deliberately skips

- Lobby, admission, invitations, and any auth beyond localhost.
- More than one agent in the roster by default (DRV-TEAM-OPT is the flagged exception).
- Any media track, codec, or capture code path.
