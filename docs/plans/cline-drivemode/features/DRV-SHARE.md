# DRV-SHARE · Bidirectional stage share

Back to [README](../README.md). Phase 2 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

A pair call is not one-way. The agent shares structured work on the stage (DRV-STAGE). The user can also take the stage so the partner sees what the human is pointing at. Discord Live / Slack huddle share hierarchy. `stage.sharer` is `human | agent`. WebRTC pixels stay later; MVP user share can be structured.

## Acceptance criteria

- Room stage pointer includes `sharer: "human" | "agent"` (and participant id) via hub `call_set_stage` (extends DRV-ROOM-MVP).
- When sharer is agent, behavior matches DRV-STAGE (last-event-wins work cards).
- When sharer is human, stage shows the active user share payload (structured MVP). Editor selection, file, or terminal pin are acceptable first payloads.
- User can start and stop share from the call strip / Drive room controls. Agent stage resumes when user share ends (or host sets stage back).
- Stage remains a derived projection. Hub owns the sharer pointer; clients do not invent a second stage owner.
- No WebRTC or media SFU in this feature. Pixel capture is an explicit non-goal for MVP (open fork may choose a later pixel path).

## Dependencies

- DRV-STAGE, DRV-ROOM-MVP, DRV-EVENTS, DRV-CALL-STRIP (controls home). DRV-DRIVE-TAB for room chrome.

## Surfaces touched

- `sdk/packages/shared/src/drive/` (stage sharer fields if not already present)
- `sdk/packages/core/src/hub/collaboration/` (`call_set_stage` payload)
- `apps/cline-hub/src/webview/src/` (Stage + share controls)

## Agent tasks

- [ ] Extend stage-owner / sharer types and `call_set_stage` to carry `human | agent` + participant id.
  - Owner package: `@cline/shared`, `@cline/core`
  - Files likely: `sdk/packages/shared/src/drive/room.ts`, hub `ops.ts`
  - Verify: `bun -F @cline/shared test`, `bun -F @cline/core test:unit`
  - Done when: transfer human↔agent is covered by unit tests.
- [ ] Implement structured user share payload publish + Stage render branch for human sharer.
  - Owner package: `@cline/cline-hub`
  - Files likely: Stage component, share control
  - Verify: `bun -F @cline/cline-hub test`
  - Done when: component tests cover agent stage vs human structured share.
- [ ] Smoke bidirectional share on a live room. Agent works, user pins a selection, agent stage returns.
  - Owner package: `@cline/cline-hub`
  - Files likely: none (runtime)
  - Verify: `control-ui` on hub webview
  - Done when: sharer pointer and stage content follow the handoffs.

## Risks

- **Open fork (preference).** User share MVP. Pixel capture vs structured selection / file / terminal only until WebRTC. Default for implementation until overturned. Structured share only. Pixels wait for multi-user media design ([04-future-multi-user.md](../04-future-multi-user.md)).
- Confusing agent stage cards with user share chrome. Mitigation. Stage header always labels whose share is live.
