# DRV-TOGGLE · Chat Join call (shortcut into Drive room)

Back to [README](../README.md). Phase 1 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

Users already live in Chat. A Join call control there should drop them into the active Drive room without hunting the left nav. The **Drive tab** is the primary home for rooms (DRV-DRIVE-TAB). This feature is the shortcut façade made visible on Chat, not a second call product.

## Acceptance criteria

- A Join call / Drive control renders in the hub Chat view header.
- Activating it calls `joinCall()` (or attaches to the existing active room) and focuses the Drive room surface (Drive tab selected, or embedded room chrome consistent with DRV-DRIVE-TAB).
- Leaving from Chat or from the Drive room uses the same leave op. The room persists; re-joining reattaches.
- Joined state survives a webview reload by reading room membership from the hub, not local component state.
- Keyboard accessible and visibly stateful (idle / joining / in call).
- Does not invent a parallel room list. Room discovery stays on the Drive tab.

## Dependencies

- DRV-ROOM-MVP (join/leave ops), DRV-EVENTS, DRV-DRIVE-TAB (primary surface to focus).

## Surfaces touched

- `apps/cline-hub/src/webview/src/Chat.tsx`
- `apps/cline-hub/src/webview/src/components/` (small Join control if the header lacks one)
- Coordination with Drive tab routing under `apps/cline-hub/src/webview/src/drive/`

## Agent tasks

- [ ] Read `Chat.tsx` and the webview's hub client wiring to find where session state and header controls live.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/Chat.tsx`
  - Verify: written pointer to the header render site and the hub client hook
  - Done when: the insertion point is named.
- [ ] Implement Join call bound to `joinCall()` / attach, focusing the Drive room; leave uses the shared leave op. Joined state derived from `CALL_STATE_UPDATE` broadcasts.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/Chat.tsx`, Join control component
  - Verify: `bun -F @cline/cline-hub test` and `bun -F @cline/cline-hub typecheck`
  - Done when: component tests cover join, leave, reload-reattach, and focus of the same room id as the Drive tab.
- [ ] Smoke Join call on the running hub webview against a room also visible in the Drive tab.
  - Owner package: `@cline/cline-hub`
  - Files likely: none (runtime check)
  - Verify: `bun -F @cline/cline-hub dev`, Join from Chat and from Drive tab, confirm one room in hub logs. Use the `control-ui` skill.
  - Done when: both entry points round-trip the same room.

## Risks

- Webview state and hub state can disagree after reconnects. Mitigation. The hub is the source of truth. The control renders from broadcasts only.
- Chat Join growing into a full second IA. Mitigation. Acceptance criteria forbid a parallel room list; Drive tab owns discovery.
