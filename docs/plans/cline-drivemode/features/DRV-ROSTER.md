# DRV-ROSTER · Agent roster as participants

Back to [README](../README.md). Phase 1 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

On a call, who is here and who is talking matters as much as the transcript. Agents are room participants, nested under the live call row the way Discord nests connected users under a voice channel. Speaking rings and mute badges map to agent TTS / tool narration activity and mute flags. The MVP still seats one human + one `pair_partner`, but the UI shows the roster shape so later seats do not rewrite chrome.

## Acceptance criteria

- Room UI renders `participants[]` from hub room state (human | agent), not a hard-coded single avatar.
- Live call rows nest connected participants under the room (Discord nested-roster pattern).
- Presence shows idle / listening / thinking / speaking (existing persona states) and mute badges from room mute flags.
- Clicking a participant opens [DRV-PARTICIPANT-SHEET](DRV-PARTICIPANT-SHEET.md) intents (**Transcript** | **Profile**). Transcript focuses that agent's stream when DRV-TRANSCRIPT lands and applies address-follows-focus; Profile does not change address. Until the sheet lands, click may still select the address chip target when DRV-ADDRESS is available.
- Single-agent roster cap from DRV-PARTNER-MVP still asserts in tests. Roster UI must not imply multi-agent without the team flag.
- Roster is a read-only projection of hub broadcasts. No client-owned writable participant list.
- Participant name and body text render from the projected `AgentProfile` appearance, not a hard-coded style ([DRV-AGENT-PROFILE](DRV-AGENT-PROFILE.md)). Inline rename lives on the roster row (double-click or `F2`) and calls a hub op; it never writes the participant.
- Each participant carries `seatSources[]` — `manual`, `pack:<id>`, or `spawn:<parentId>` — and the row can show why it is seated. This is the refcount that makes overlapping [RosterPacks](DRV-ROSTER-PACK.md) and dismiss-pack-versus-dismiss-member coherent.

## Dependencies

- DRV-ROOM-MVP, DRV-EVENTS, DRV-DRIVE-TAB (list home). DRV-PERSONA-CHIP for presence visuals. [DRV-AGENT-PROFILE](DRV-AGENT-PROFILE.md) for names and inks; [DRV-ROSTER-PACK](DRV-ROSTER-PACK.md) for the add-pack affordance in the roster header.

> **Glossary.** A **RosterPack** is a human-curated seating preset (Drive). A **Team** is Cline's runtime execution group with a lead, teammates, and a mailbox (`sdk/packages/core/src/extensions/tools/team/`). Drive identifiers never contain `Team`. See [06-platform-config.md](../06-platform-config.md#naming-rosterpack-not-teampack-not-team).

## Surfaces touched

- `apps/cline-hub/src/webview/src/drive/` (roster under call rows)
- `apps/cline-hub/src/webview/src/components/ai-elements/persona.tsx` (consumed)
- `sdk/packages/core/src/hub/collaboration/` (roster fields already from DRV-ROOM-MVP; UI only unless gaps)

## Agent tasks

- [ ] Render nested roster from `CALL_STATE_UPDATE` participant snapshots.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/drive/Roster.tsx`
  - Verify: `bun -F @cline/cline-hub test`
  - Done when: fixtures for host + pair_partner render with mute and speaking states.
- [ ] Wire speaking indicator to presence / narration activity events without inventing a second presence channel.
  - Owner package: `@cline/cline-hub`
  - Files likely: Roster + existing presence event consumers
  - Verify: `bun -F @cline/cline-hub test`
  - Done when: a narration or speaking presence event lights the ring in a component test.
- [ ] Smoke roster on the Drive tab with one partner joined.
  - Owner package: `@cline/cline-hub`
  - Files likely: none (runtime)
  - Verify: live hub webview via `control-ui`
  - Done when: join shows human + partner under the room; mute badge follows `call_mute`.

## Risks

- Treating the persona chip as the roster. Mitigation. Chip can remain a compact presence affordance; roster is the participant list of record.
- Over-building multi-agent UI before DRV-TEAM-OPT. Mitigation. Cap stays enforced hub-side; UI lists whatever the roster contains.
