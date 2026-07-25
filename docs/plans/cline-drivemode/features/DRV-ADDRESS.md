# DRV-ADDRESS · Address set (one / many / everyone)

Back to [README](../README.md). Phase 2 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

On a call with agents in the roster, the next message needs an explicit audience. Click or hotkey sets one agent, many agents, or everyone before send. Slack-style recipient chips, not buried @mentions only. The hub enforces delivery from `addressSet`. UI never silently widens the audience.

## Acceptance criteria

- Composer (Drive room and Chat shortcut into the room) shows an address chip row. Defaults to `everyone` in a single-partner room.
- User can set address to one participant, several, or everyone via click on roster entries and via documented hotkeys.
- Outbound send carries `addressSet: "everyone" | { agentIds: string[] }` (or equivalent typed shape in DRV-EVENTS) on the conversation event.
- Hub validates and delivers only to addressed participants. Agents not in the set do not receive the prompt as their turn input.
- Clearing chips restores `everyone`. Illegal empty set is rejected at the boundary.
- A pack mode exists: `{ mode: "pack", packId }` addresses a `RosterPack` whose `addressable` flag is true, resolving at send time to currently-seated participants whose `seatSources` contain that pack ([DRV-ROSTER-PACK](DRV-ROSTER-PACK.md)). Resolution happens at send, not at chip creation, so a member who left is simply not addressed. An empty resolution is rejected like any other empty set — never silently widened to everyone.
- Privacy. Address metadata is fine; payloads still omit raw audio (DRV-PRIVACY).

## Dependencies

- DRV-EVENTS (schema field), DRV-ROOM-MVP / hub send path, DRV-ROSTER (click targets), DRV-DRIVE-TAB (composer home). DRV-STEER-QUEUE should honor the same address set when steering. [DRV-ROSTER-PACK](DRV-ROSTER-PACK.md) for the pack address mode; [DRV-PLATFORM-CONFIG](DRV-PLATFORM-CONFIG.md) owns `address.defaultSet` and `address.stickiness` as durable facets.

## Surfaces touched

- `sdk/packages/shared/src/drive/events.ts` (address field on conversation events)
- `sdk/packages/core/src/hub/` (delivery enforcement)
- `apps/cline-hub/src/webview/src/drive/` and composer wiring

## Agent tasks

- [ ] Extend conversation event schema with `addressSet` and parse tests.
  - Owner package: `@cline/shared`
  - Files likely: `sdk/packages/shared/src/drive/events.ts`, tests
  - Verify: `bun -F @cline/shared test`
  - Done when: everyone and agent-id set round-trip; empty set rejected.
- [ ] Enforce delivery in hub / kernel turn routing from `addressSet`.
  - Owner package: `@cline/core` / `@cline/drive`
  - Files likely: hub collaboration ops, kernel prompt routing
  - Verify: `bun -F @cline/core test:unit`, `bun -F @cline/drive test`
  - Done when: unit tests show non-addressed agent does not receive the turn.
- [ ] Build address chips + roster click + hotkeys in the Drive composer.
  - Owner package: `@cline/cline-hub`
  - Files likely: Drive composer chrome
  - Verify: `bun -F @cline/cline-hub test`, live smoke with `control-ui`
  - Done when: one / many / everyone round-trip through a send and appear on the event.

## Risks

- Hotkey collisions with existing hub shortcuts. Mitigation. Document chosen keys in this file when implemented; prefer chords that do not steal composer text input.
- Multi-agent addressing before DRV-TEAM-OPT seats exist. Mitigation. Schema and UI support many; MVP roster still caps agents unless the team flag is on.
