# DRV-STAGE · The Call Stage

Back to [README](../README.md). Phase 2 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

This is the agent screen share made literal. Inside a Drive room (primary on the Drive tab; also reachable via Chat Join), the view splits. Conversation on the left, stage on the right. When the agent holds the stage, it always shows what the partner is doing right now. Current edit as a diff card, running command as a terminal card, test run as a results card. The user stops scrolling the feed to find the work. Bidirectional human share is DRV-SHARE on top of this reducer and pointer.

## Acceptance criteria

- Inside an active Drive room, the room view splits into conversation and stage regions (Call Stage layout). Drive tab is the primary mount; Chat shortcut may show the same split when focused on the room.
- The stage is a last-event-wins reducer over the same hub session events the feed consumes. No new event source, no duplicated state. Events-first. No WebRTC for the agent path.
- The stage renders with existing cards: `code-block.tsx` for edits, `terminal.tsx` for commands, `test-results.tsx` for test runs.
- A stage sharer pointer from room state decides whose work renders (agent pair_partner by default in MVP; human share via DRV-SHARE).
- Stage state is a pure function of the event stream. Reloading the webview replays to the same stage.
- Layout collapses gracefully at narrow widths (stage stacks under conversation).

## Dependencies

- DRV-PARTNER-MVP (phase 1 complete), DRV-EVENTS, DRV-ROOM-MVP (stage pointer), DRV-DRIVE-TAB (room chrome home).

## Surfaces touched

- `apps/cline-hub/src/webview/src/drive/` (preferred mount) and/or `Chat.tsx` when Join focuses the room
- `apps/cline-hub/src/webview/src/components/` (new `Stage.tsx`, `stageReducer.ts`)
- `apps/cline-hub/src/webview/src/components/ai-elements/{code-block,terminal,test-results}.tsx` (consumed, not modified)

## Agent tasks

- [ ] Write the stage reducer as a pure function with fixture-based tests. Event stream in, `StageState` out, last event wins per work category.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/components/stageReducer.ts`, `stageReducer.test.ts`
  - Verify: `bun -F @cline/cline-hub test`
  - Done when: fixtures for edit, command, and test sequences reduce to the expected stage, including replay determinism.
- [ ] Build the `Stage` component rendering the reducer output with the existing cards.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/components/Stage.tsx`
  - Verify: `bun -F @cline/cline-hub test` and `typecheck`
  - Done when: each stage kind renders its card in component tests.
- [ ] Split the room layout (Drive tab primary) with responsive collapse; Chat Join focuses the same layout.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/drive/`, optionally `Chat.tsx`
  - Verify: live smoke via `bun -F @cline/cline-hub dev` during a real task. Use the `control-ui` skill, capture a screenshot at wide and narrow widths.
  - Done when: the stage tracks live work and the narrow layout stacks.

## Risks

- Event granularity may be too coarse for a satisfying live stage (for example, one event per file edit rather than streaming diff chunks). Mitigation. Ship coarse first. The reducer contract does not change if events get finer later.
- Split layout fights existing Chat CSS. Mitigation. Prefer mounting in Drive tab room chrome; Chat only hosts the shortcut focus path. Phase 1 ships without the split.
