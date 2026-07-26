# DRV-LEAVE-END · Leave the call, end the session

Back to [README](../README.md). Phase 1 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

Leaving must feel safe. The user steps away, the room and work persist, and coming back is one toggle. Ending is different and explicit. The partner wraps up with a handoff explanation of what was done, what is in flight, and what to check next. Nobody should ever wonder what the agent did while they were gone.

## Acceptance criteria

- Leave is the `call_leave` op. The room persists with its event history (capped per DRV-PRIVACY). Re-join reattaches and the feed shows what happened since.
- End is a distinct action that asks the kernel for a handoff explanation, renders it as a final narration message, then closes the room.
- End with work in flight pauses the turn first (interrupt policy pause-after-tool), then explains.
- Both actions are idempotent. Double-leave and double-end are safe no-ops.

## Dependencies

- DRV-ROOM-MVP (ops and persistence), DRV-NARRATION (handoff rendering), DRV-INTERRUPT (pause semantics for end, can stub with hard-stop until phase 2).

## Surfaces touched

- `sdk/packages/core/src/hub/collaboration/` (leave/end ops)
- `sdk/packages/drive/src/` (handoff explanation assembly)
- `apps/cline-hub/src/webview/src/` (leave and end controls near the toggle)

## Agent tasks

- [ ] Implement `call_end` as an op distinct from `call_leave`, with idempotency tests for both.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hub/collaboration/ops.ts`, `room.test.ts`
  - Verify: `bun -F @cline/core test:unit`
  - Done when: double-invocation tests pass and end tears down the roster while leave does not.
- [ ] Implement handoff explanation assembly in the kernel. Structured summary from the room's work events (files touched, commands run, plan state, open items).
  - Owner package: `@cline/drive`
  - Files likely: `sdk/packages/drive/src/handoff.ts`, tests
  - Verify: `bun -F @cline/drive test`
  - Done when: given a synthetic event history, the summary names files, outcomes, and open items.
- [ ] Add leave and end controls to the hub UI and smoke the full loop. Join, do work, leave, re-join, end.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/Chat.tsx`
  - Verify: `bun -F @cline/cline-hub test`, then live smoke with `bun -F @cline/cline-hub dev`
  - Done when: the loop is observed live and the handoff message renders on end.

## Risks

- Handoff quality depends on event richness in phase 1. Mitigation. The summary is assembled from typed events (Tier 0), so it degrades to a plain factual list rather than hallucinating.
