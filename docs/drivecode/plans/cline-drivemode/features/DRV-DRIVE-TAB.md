# DRV-DRIVE-TAB · Drive tab (channels + call rooms)

Back to [README](../README.md). Phase 1 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

Drive needs a home that feels like Discord voice inside Slack chrome, not only a Join control on Chat. One left-nav Drive activity lists text channels (optional later) and call rooms. Opening a room is the primary join path. Chat Join call remains a shortcut into the active room (DRV-TOGGLE).

Decision record. [DRIVE-TAB.md](../../../design/drive-wireframes/DRIVE-TAB.md).

## Acceptance criteria

- A Drive activity exists in the hub left nav (Slack-like single workspace chrome).
- The Drive view shows a channel/room list. Call rooms are first-class; text channels may be stubbed or omitted until a consumer exists.
- Selecting a call room attaches via `joinCall()` / room attach and shows the room surface (feed + roster shell).
- Nested roster under a live room row shows who is in the call (DRV-ROSTER).
- Chat Join call focuses or opens the active Drive room rather than owning a separate call chrome.
- Drive-tab membership and selected room survive webview reload by reading hub room state, not local-only UI state.
- No second server. Hub `:25463` remains the only writer and transport.

## Dependencies

- DRV-ROOM-MVP, DRV-EVENTS. DRV-TOGGLE for the Chat shortcut wiring.

## Surfaces touched

- `apps/cline-hub/src/webview/src/` (left nav + new Drive tab view)
- Hub client subscription already used by Chat (reuse, do not fork transport)

## Agent tasks

- [ ] Map hub left-nav / activity registration patterns and name the insertion point for a Drive activity.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/`
  - Verify: written pointer to nav registration and routing
  - Done when: the Drive activity mount site is named.
- [ ] Implement Drive tab shell. Room list + selected room surface bound to hub room broadcasts.
  - Owner package: `@cline/cline-hub`
  - Files likely: new Drive tab components under `apps/cline-hub/src/webview/src/drive/`
  - Verify: `bun -F @cline/cline-hub test` and `typecheck`
  - Done when: component tests cover empty list, one room selected, reload-reattach.
- [ ] Wire room select to `joinCall()` / attach and confirm Chat Join focuses the same room.
  - Owner package: `@cline/cline-hub`
  - Files likely: Drive tab view, `Chat.tsx` Join shortcut
  - Verify: live smoke via `bun -F @cline/cline-hub dev` with `control-ui`
  - Done when: join from tab and Join from Chat land on the same hub room id.

## Risks

- Building a second chat app inside the hub. Mitigation. Reuse session event feed and composer contracts; Drive tab owns IA and room chrome only.
- Text-channel scope creep. Mitigation. Stub or omit text channels until a feature consumes them. Call rooms are the MVP list.
