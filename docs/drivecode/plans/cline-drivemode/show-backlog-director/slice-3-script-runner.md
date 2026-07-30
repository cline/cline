# Slice 3 · DirectorScript runner

Back to [overview.md](overview.md). Depends on: [slice-2](slice-2-enqueue-rank-tick.md). Unlocks: [slice-5](slice-5-planner-policy.md) (scripted explanations).

## Goal

Attach an active `DirectorScript` to the room director; advance beats with `advanceScriptBeat` so sticky media can **hold** while `say`/caption changes.

## Tasks

| ID | Task | Depends on | Owner | Done when |
|---|---|---|---|---|
| 3.1 | Hub command `drive.script.attach` `{ roomId, script: DirectorScript }` → sets `director.activeScript`, seeds first beat via `buildDirectorStateFromBags` or explicit first-beat apply | slice 2 live director | `@cline/core` | Script persisted on live state; `activeBeatId` / `activeShowId` set |
| 3.2 | Hub command `drive.script.advance` → pure `advanceScriptBeat` → update live director; present show if `activeShowId` changed and item needs materialize | 3.1 | `@cline/drive` + core | Sticky URI holds on `hold` policy; caption updates |
| 3.3 | Emit `drive.script.beat` hub event with `{ beatId, say, showItemId, stickyShowIds }` | 3.2 | `@cline/shared` + core | Webview can show caption without polling |
| 3.4 | Webview: bind `say` to sticky pane caption (and optional caption strip); do not require TTS | 3.3 | hub webview | Caption text updates on advance |
| 3.5 | Advance triggers (minimal): explicit UI “Next beat” + optional `on_tool` hook from `call_record_work` when active script beat.advance === `on_tool` | 3.2 | core + webview | Fixture 2-beat script advances on button; unit test for on_tool |
| 3.6 | Honor `StickyPolicy` replace vs hold (and hold_until when beat id matches) in present path | 3.2 | core | Tests from `rankBacklogs.test.ts` behavior mirrored in hub integration test |

## Dependency notes

- Show items referenced by `showItemId` must already be in `showBacklog` (enqueue in slice 2) or attach payload may embed/upsert them.
- `auto_after_say` without TTS: treat as “advance on Next” or short timer — pick one in implementation and document; do not block on voice.

## Non-goals

- Narrator TTS (Phase 3).
- Per-agent bag merge UI (bags can be single-room script for MVP).

## Files likely

- `sdk/packages/drive/src/director/rankBacklogs.ts` (`advanceScriptBeat`)
- `sdk/packages/core/src/hub/server/handlers/drive-handlers.ts` or `drive-script-handlers.ts`
- `apps/cline-hub/src/webview/src/drive/StickyStagePane.tsx`
- `apps/cline-hub/src/webview/src/drive/useDriveSession.ts`

## Acceptance

- [x] Two-beat script: beat1 diagram + say A → advance → same URI (hold) + say B.
- [x] Replace beat tears down sticky to new show id.
- [x] `bun -F @cline/drive test` and core handler tests green.

## Risks

- Demo fixture `DirectorScript` is decorative today — do not confuse with hub runner; keep demo separate or later point demo at hub.
