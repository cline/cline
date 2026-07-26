# DRV-CALL-STRIP · Pinned call controls

Back to [README](../README.md). Phase 2 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

On a call, controls live in one predictable strip. Presence, mute, raise hand, mode, leave, and stage-share affordances. The user should never hunt through menus mid-call. The strip mounts in the Drive room chrome (primary) and remains available when Chat Join focuses the same room. The strip is also where debug-mode and privacy indicators live, so state is always visible.

## Acceptance criteria

- A pinned strip renders when Drive is on, containing the persona presence, mute button (placeholder action until phase 3, real room-state mutation immediately), interrupt (raise hand), the mode pill, and leave.
- Mute toggles `call_mute` room state even before audio exists, so phase 3 inherits working plumbing.
- Interrupt wires to DRV-INTERRUPT.
- A debug-mode indicator appears when privacy debug is enabled (DRV-PRIVACY).
- The strip is keyboard navigable.

## Dependencies

- DRV-STAGE (layout home), DRV-INTERRUPT, DRV-MODE-OVERLAY, DRV-ROOM-MVP (mute op).

## Surfaces touched

- `apps/cline-hub/src/webview/src/components/CallStrip.tsx` (new)
- `apps/cline-hub/src/webview/src/Chat.tsx`

## Agent tasks

- [ ] Build the strip component composing existing controls (persona chip, mode pill, toggle-adjacent leave) plus mute and raise-hand buttons.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/components/CallStrip.tsx`
  - Verify: `bun -F @cline/cline-hub test`
  - Done when: component tests cover render states (muted, hand raised, debug on).
- [ ] Wire mute to the `call_mute` op and render mute state from broadcasts.
  - Owner package: `@cline/cline-hub`
  - Files likely: `CallStrip.tsx`, hub client hook
  - Verify: `bun -F @cline/cline-hub test`, live smoke confirming the muted flag round-trips through the hub
  - Done when: two webview instances agree on mute state.
- [ ] Mount the strip in the split layout and smoke keyboard navigation.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/Chat.tsx`
  - Verify: live smoke via `bun -F @cline/cline-hub dev` with the `control-ui` skill
  - Done when: every strip control is reachable and operable by keyboard.

## Risks

- A mute button that does nothing audible until phase 3 can confuse. Mitigation. Muted state visibly gates partner narration TTS later, and in phase 2 the button tooltip states what mute governs.
