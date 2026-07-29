# DRV-ROOM-MVP · The smallest room and the joinCall façade

Back to [README](../README.md). Phase 1 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

"Join a call" needs a thing to join. The room is the domain primitive that makes the MVP honest about its future. One human plus one `pair_partner` agent today, more participants later, same object. The hub owns it as the single writer.

## Acceptance criteria

- A `Room` runtime exists in the hub with roster (`participants[]`), stage sharer pointer (`human | agent`), mode, and mute flags, using the DRV-EVENTS types. Shape is compatible with Drive-tab domain fields (`roomTranscript` / `agentStreams` projections, `addressSet` on send) even if transcript UI and address UI land in phase 2.
- Hub ops exist for `call_join`, `call_leave`, `call_mute`, `call_set_stage`, `call_set_mode`, each an idempotent state mutation that broadcasts a `CALL_STATE_UPDATE` event to subscribed clients.
- `joinCall()` façade creates or attaches the room and seats exactly one human (`host`) and one agent (`pair_partner`). Used by both the Drive tab and the Chat Join shortcut.
- Rooms persist across leave. Leave removes a participant, the room object remains attachable (drop-in semantics).
- Room state is hub-owned. Clients hold read-only projections fed by broadcasts, never a writable copy.
- Reconnect / hub-down / version-skew behaviors match [ops/hub-drive-ops.md](../ops/hub-drive-ops.md): snapshot + live events on resume; hard stop on major schema skew; explicit empty state when hub is not running.
- Unfocused rooms are view-only in MVP ([DEC-open-product-forks](../decisions/DEC-open-product-forks.md)); only the focused room runs agent turns.
- All ops validated at the hub server boundary. Internal room logic trusts typed inputs.
- Unit tests cover join, re-join idempotency, leave with persistence, mute broadcast, stage transfer, reconnect snapshot, and focus-room runtime cap.

## Dependencies

- DRV-EVENTS (types), DRV-KERNEL (mode values), DRV-PRIVACY (retention behavior).

## Surfaces touched

- `sdk/packages/core/src/hub/collaboration/` (new: `room.ts`, `roster.ts`, `ops.ts`)
- `sdk/packages/core/src/hub/server/handlers/` (op registration, following existing handler patterns like `session-event-projector.ts`)
- `sdk/packages/core/src/hub/client/` (client-side subscription helper)

## Agent tasks

- [ ] Read the existing hub server handler and client adapter patterns before writing anything.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hub/server/`, `src/hub/client/session-client.ts`, `connect.ts`
  - Verify: short written map of the command/reply and event-broadcast flow with file pointers
  - Done when: the new ops have a named registration point consistent with existing handlers.
- [ ] Implement the `Room` runtime and roster as pure state plus a thin hub adapter.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hub/collaboration/room.ts`, `roster.ts`, `room.test.ts`
  - Verify: `bun -F @cline/core test:unit`
  - Done when: pure-state tests pass without any server running.
- [ ] Register the five call ops on the hub server with boundary validation and broadcast wiring.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hub/collaboration/ops.ts`, server handler registration
  - Verify: `bun -F @cline/core test:unit`
  - Done when: an integration-style test drives join/leave/mute through the server path and observes broadcasts.
- [ ] Implement `joinCall()` façade and a client subscription helper.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hub/collaboration/join-call.ts`, `src/hub/client/`
  - Verify: `bun -F @cline/core test:unit`
  - Done when: calling `joinCall()` twice yields one room with a two-seat roster, asserted in tests.

## Risks

- Hub server handler conventions may constrain op shapes in ways this plan has not fully mapped. Mitigation. The read-first task is mandatory and the ops land as one small unit each.
- Idempotency edge cases around crash-and-rejoin. Mitigation. Join is `createOrAttach` by construction, and the re-join test pins it.
