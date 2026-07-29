# DRV-PERSONA-CHIP · Partner presence chip

Back to [README](../README.md). Phase 1 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

A call has a face. The persona chip makes the partner feel present. Idle, listening, thinking, speaking, and asleep states give the user an ambient read on what the partner is doing without parsing the feed. This is the single highest fun-per-line feature in phase 1.

## Acceptance criteria

- The bundled Rive persona (`persona.tsx`) renders in the Chat header when Drive is on, absent when off.
- Persona state derives from presence events (thinking during a turn, speaking while narration or TTS plays, listening when mic is live in phase 3, idle otherwise).
- State transitions are driven by `DriveEvent` presence messages, not by polling component internals.
- The chip shows the partner's name. Naming stays a small config value, not a new system.

## Dependencies

- DRV-TOGGLE (mount condition), DRV-EVENTS (presence events), DRV-ROOM-MVP.

## Surfaces touched

- `apps/cline-hub/src/webview/src/components/ai-elements/persona.tsx` (wire, not rewrite)
- `apps/cline-hub/src/webview/src/Chat.tsx`

## Agent tasks

- [ ] Read `persona.tsx` to inventory its states and props.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/components/ai-elements/persona.tsx`
  - Verify: written mapping of persona states to presence event types
  - Done when: every persona state has a driving event or is explicitly unused.
- [ ] Emit presence events from the kernel/room on turn start, turn end, and narration playback.
  - Owner package: `@cline/drive` and `@cline/core`
  - Files likely: `sdk/packages/drive/src/`, `sdk/packages/core/src/hub/collaboration/`
  - Verify: `bun -F @cline/drive test` and `bun -F @cline/core test:unit`
  - Done when: presence events appear in the broadcast stream during a simulated turn.
- [ ] Mount the persona chip in the header, driven by the presence stream.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/Chat.tsx`
  - Verify: `bun -F @cline/cline-hub test`, then live smoke with `bun -F @cline/cline-hub dev` watching states change during a real turn
  - Done when: the chip animates through thinking and idle during a live session.

## Risks

- Rive asset behavior in the hub webview bundle is unverified. Mitigation. The read task confirms the asset loads before any event wiring, and a static fallback (status dot) is acceptable for the gate.
