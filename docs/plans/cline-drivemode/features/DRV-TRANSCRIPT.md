# DRV-TRANSCRIPT · Room transcript vs per-agent focus

Back to [README](../README.md). Phase 2 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

A call has a shared thread everyone can see, and each agent also has a stream you can focus when you want that partner's detail. Channel vs DM, room thread vs per-agent transcript. Without both, addressing many agents collapses into noise or forces a single flat feed.

## Acceptance criteria

- Room view supports two focus modes. `roomTranscript` (everyone-visible) and `agentStreams[agentId]` (per-agent focus).
- Switching focus does not fork hub state. Focus is a client projection over the same event stream (or a dedicated stream if the open fork chooses private logs).
- Room transcript shows messages and narrations scoped to the room address (everyone / multi).
- Per-agent focus shows that agent's narrations, tool work cards, and directed messages.
- Focus selection is reachable from the roster (DRV-ROSTER) and restores after reload via URL or hub-projected UI prefs that carry no private transcript payload (DRV-PRIVACY).
- No raw transcript persistence on disk unless privacy debug is on.

## Dependencies

- DRV-DRIVE-TAB, DRV-ROSTER, DRV-EVENTS, DRV-PARTNER-MVP. DRV-ADDRESS for send-path scoping.

## Surfaces touched

- `apps/cline-hub/src/webview/src/drive/` (transcript panes)
- `sdk/packages/shared/src/drive/` if event tagging needs `addressSet` / `agentId` fields (coordinate with DRV-EVENTS / DRV-ADDRESS)

## Agent tasks

- [ ] Decide projection model against the open fork (private agent log vs filtered room events) and document the pick in this file's Risks resolution note.
  - Owner package: plan docs + `@cline/shared`
  - Files likely: this feature doc; optionally `sdk/packages/shared/src/drive/events.ts`
  - Verify: written decision with one sentence rationale
  - Done when: implementers have one model, not two.
- [ ] Implement focus switcher and filtered feed rendering from hub events.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/drive/TranscriptFocus.tsx`
  - Verify: `bun -F @cline/cline-hub test`
  - Done when: fixtures prove room vs agent filters for the same event list.
- [ ] Smoke focus switch during a live narrated task.
  - Owner package: `@cline/cline-hub`
  - Files likely: none (runtime)
  - Verify: `control-ui` on hub webview
  - Done when: room thread and partner focus both show coherent content without reload.

## Risks

- **Open fork (preference).** True private agent log vs filtered view of the same room events. Prototype assumes a dedicated stream. Default for implementation until overturned. Filtered view of tagged room events (cheaper, one writer). Revisit only if private agent scratchpads become a product need.
- Dual feeds drifting. Mitigation. One event source; focus is a filter or a tagged projection, never a second writer.
