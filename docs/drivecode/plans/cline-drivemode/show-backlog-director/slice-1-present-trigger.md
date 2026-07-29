# Slice 1 · Present trigger

Back to [overview.md](overview.md). Depends on: landed `drive.show.present` + `StickyStagePane`. Unlocks: [slice-2](slice-2-enqueue-rank-tick.md).

## Goal

A product path (not only unit tests) can present a mermaid Show item and see it in Chat’s sticky pane during a live Join/Stage session.

## Why first

The hub present path is ~80% done but unreachable from UI. Without a trigger, enqueue/rank work cannot be smoked end-to-end.

## Tasks

| ID | Task | Depends on | Owner | Done when |
|---|---|---|---|---|
| 1.1 | Add webview affordance that posts `driveCommand` / `drive.show.present` with a fixture mermaid `ShowBacklogItem` (devtools panel or Drive settings “Present sample diagram”) | — | hub webview | **Done** — Settings Sample/dev button |
| 1.2 | Ensure `useDriveSession` maps `drive_show_presented` / `drive_room_changed` → `presentedShow` (verify; fix if gaps) | 1.1 | hub webview | **Done** — title plumbed on presented event |
| 1.3 | Hub handler regression: present without `uri` + `render_mermaid` still materializes | — | `@cline/core` | **Done** — drive-handlers test asserts uri + title |
| 1.4 | Live smoke doc step: Join → Stage on (or auto-stage if S done) → Present sample → sticky shows SVG | 1.1, 1.2, 1.3 | docs / testing.md | **Done** — checklist in testing.md |

## Non-goals

- Ranking, enqueue API, script beats, planner.
- Full Show backlog list UI.

## Files likely

- `apps/cline-hub/src/webview/src/drive/useDriveSession.ts`
- `apps/cline-hub/src/webview/src/drive/DriveSettingsPanel.tsx` or small `PresentShowDevPanel.tsx`
- `apps/cline-hub/src/webview/src/Chat.tsx` / `DriveRoomChrome.tsx` (mount)
- `sdk/packages/core/src/hub/server/handlers/drive-handlers.ts` (verify only)
- `docs/drivecode/plans/cline-drivemode/show-backlog-director/testing.md`

## Acceptance

- [ ] From hub Chat on a call with Stage open, one click presents a diagram into `StickyStagePane`.
- [ ] No LLM credential required for the sample present.
- [ ] `bun -F @cline/core test:unit` (drive-handlers) and hub unit tests for the new control pass.

## Risks

- Confusing sample present with production planner — label UI “Sample / dev” until slice 5.
