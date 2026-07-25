# DRV-NARRATION · Narration messages in the feed

Back to [README](../README.md). Phase 1 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

The senior engineer on the call talks while working. "I'm going to check the failing test first because the stack trace points there." Narration is what turns a tool log into a pair-programming session. It is the voice of the product before voice exists.

## Acceptance criteria

- A narration message style renders in the hub chat feed, visually distinct from user messages and assistant answers (quieter, inline, partner-attributed).
- Narration events come from the kernel narration policy (DRV-KERNEL) at decision-point density by default.
- Density is configurable (`decision-points | every-tool`), a config value read by the kernel.
- Narration events flow through the same hub broadcast stream as other drive events. The feed renders them in order with work events.
- Narration text is generated as part of the partner's normal turn output, not by a second model call per event (tiered-routing discipline. Tier 0 assembly where possible).

## Dependencies

- DRV-KERNEL (narration policy), DRV-EVENTS, DRV-ROOM-MVP (broadcast), DRV-TOGGLE.

## Surfaces touched

- `apps/cline-hub/src/webview/src/Chat.tsx` (feed rendering)
- `apps/cline-hub/src/webview/src/components/ai-elements/message.tsx` (variant, if needed)
- `sdk/packages/drive/src/narrationPolicy.ts`

## Agent tasks

- [ ] Define the narration event payload (text, refs to related work event ids) in shared schemas if DRV-EVENTS left it minimal.
  - Owner package: `@cline/shared`
  - Files likely: `sdk/packages/shared/src/drive/events.ts`
  - Verify: `bun -F @cline/shared test`
  - Done when: narration events can reference the work event they explain.
- [ ] Wire kernel narration output into the room broadcast on the session event path.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hub/collaboration/`, session event projector call site
  - Verify: `bun -F @cline/core test:unit`
  - Done when: a simulated turn emits narration events interleaved with work events.
- [ ] Render the narration style in the feed.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/Chat.tsx`, `components/ai-elements/message.tsx`
  - Verify: `bun -F @cline/cline-hub test`, live smoke via `bun -F @cline/cline-hub dev` during a real task
  - Done when: narration reads as a partner talking over their work, confirmed on the live surface.

## Risks

- Narration noise. Every-tool density drowns the feed. Mitigation. Decision-point default per the wireframes fork, with the density setting as the escape hatch. Ship the default, gather reactions.
- Narration lag behind the work it explains. Mitigation. Events carry related-work refs so the UI can group them even when order slips.
