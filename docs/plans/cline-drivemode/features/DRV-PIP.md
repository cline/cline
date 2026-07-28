# DRV-PIP · PiP Partner companion widget

Back to [README](../README.md). Phase 2 in [TASK-GRAPH](../TASK-GRAPH.md). Product requirements: [PRD 7](../prd/prd-pip-partner.md). Decision: [ARD-0006](../ard/ARD-0006-pip-partner-companion.md).

## Problem / user value

Users leave the Drive tab for Chat (or other hub pages) while a call is still live. Without a companion widget they lose glanceable presence, mute, raise-hand, and the current narration line. PiP is that companion. It is **not** a replacement for Drive tab or Spotlight.

## Acceptance criteria

- When the local human is in an active room and has not opted out of the companion, a PiP widget renders inside the hub webview.
- Widget shows partner name, presence (speaking / muted / hand), Drive sub-mode, and one live caption/narration line.
- Mute, raise hand, and leave call the same hub ops as [DRV-CALL-STRIP](DRV-CALL-STRIP.md) / [DRV-INTERRUPT](DRV-INTERRUPT.md) / [DRV-LEAVE-END](DRV-LEAVE-END.md). State matches the call strip.
- Expand focuses the Drive tab active room. If stage is on, the stage remains part of that room view ([DRV-STAGE](DRV-STAGE.md)).
- Hiding PiP without leave does not leave the room. Leave remains explicit.
- PiP does not render when not in a call.
- No editor DOM injection. Hub webview only for this feature’s MVP.
- No second room writer and no parallel stage inside the widget.

## Dependencies

- DRV-ROOM-MVP, DRV-EVENTS, DRV-DRIVE-TAB, DRV-TOGGLE, DRV-PERSONA-CHIP, DRV-NARRATION, DRV-CALL-STRIP, DRV-LEAVE-END, DRV-INTERRUPT.
- DRV-STAGE preferred before Expand-to-stage smoke (Expand may land on room without stage until stage lands).

## Surfaces touched

- `apps/cline-hub/src/webview/src/` — PiP shell, drag bounds, show/hide preference
- Shared room projection / call strip ops (no duplicate protocol)
- Wireframe reference: `docs/design/drive-wireframes/index.html` variant C

## Agent tasks

- [ ] Map call-strip control handlers and room membership projection used by Chat Join / Drive tab.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/drive/`, `Chat.tsx`, Drive tab view
  - Verify: written pointer to the shared mute / hand / leave entry points
  - Done when: PiP can call the same functions as the strip without a second client path.
- [ ] Implement hub webview PiP shell: presence, caption line, mute, hand, expand, leave, hide-without-leave.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/drive/PipPartner.tsx` (or equivalent), app shell mount
  - Verify: `bun -F @cline/cline-hub test` and `bun -F @cline/cline-hub typecheck`
  - Done when: unit tests cover in-call show, not-in-call hide, mute/hand parity with strip, expand focuses room id, hide≠leave.
- [ ] Live smoke: join from Drive tab, navigate to Chat, use PiP mute/hand/expand/leave.
  - Owner package: `@cline/cline-hub`
  - Files likely: none (runtime check)
  - Verify: hub webview via `control-ui`; one room in hub logs
  - Done when: PiP and Drive tab agree on membership and control state.

## Risks

- PiP becoming a second IA. Mitigation. Acceptance criteria forbid room list, stage, and address UI inside the widget; Expand is mandatory.
- VS Code users expecting float-over-editor. Mitigation. Document host limit; dock-in-panel is a later host adapter, not this feature’s MVP.
- Caption retention. Mitigation. Live projection only; DRV-PRIVACY unchanged.
