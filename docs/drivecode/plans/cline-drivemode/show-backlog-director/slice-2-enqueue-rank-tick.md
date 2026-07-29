# Slice 2 · Enqueue + rank + present tick

Back to [overview.md](overview.md). Depends on: [slice-1](slice-1-present-trigger.md). Unlocks: [slice-3](slice-3-script-runner.md), [slice-4](slice-4-do-show-link.md), [slice-6](slice-6-producers.md), [slice-7](slice-7-router-wire.md).

## Goal

Show items enter `director.showBacklog` as `planned`/`ready` without immediately presenting; a hub **screen-manager tick** ranks via `rankShowBacklog` and presents the top item (reuse present/materialize internals).

## Tasks

| ID | Task | Depends on | Owner | Done when |
|---|---|---|---|---|
| 2.1 | Add hub commands `drive.show.enqueue` (and reply shape) + Zod payload = `ShowBacklogItem` (status forced to `planned` or allow `ready`) | — | `@cline/shared` hub names + `@cline/core` | Command in `HubCommandName`; handler upserts backlog; does **not** set `activeShowId` unless `presentNow: true` |
| 2.2 | Emit hub event `drive.show.planned` (or reuse `drive.room.changed` with reason) after enqueue | 2.1 | `@cline/shared` + core | Webview can observe backlog growth |
| 2.3 | Implement `runShowDirectorTick(roomId)` in core: call `rankShowBacklog` on live director items → pick top `planned`/`ready` → materialize → set active/sticky (extract shared helper from `handleShowPresent`) | 2.1 | `@cline/drive` + `@cline/core` | Unit test: two items, higher priority + spotlight bias wins |
| 2.4 | Hub command `drive.show.tick` + optional auto-tick hook after enqueue when `autoPresent: true` | 2.3 | `@cline/core` | Manual tick presents top item; StickyStagePane updates |
| 2.5 | Wire webview protocol + `drive-commands` proxy for enqueue/tick | 2.1, 2.4 | cline-hub server/webview | Dev panel can enqueue then tick |
| 2.6 | Seed helper: enqueue architecture template item with mermaidSource from `SHOW_TEMPLATE_KIT` / `getShowTemplate` | 2.1, 2.5 | hub or core | One-call smoke without hand-built Zod object |
| 2.7 | Tests: enqueue idempotency by id; tick no-op when backlog empty; tick does not wipe sticky unless replace | 2.3, 2.4 | `@cline/core` / `@cline/drive` | Focused unit suites green |

## Dependency notes

- **Must use** existing pure `rankShowBacklog` — do not reimplement scoring in the handler.
- Spotlight bias in rank reads `DriveRoomLiveState.spotlightParticipantId` (or converged sharer after slice S). Until S lands, pass live spotlight id into rank input.
- Do **not** require slice 3 for exit; first present can set `activeShowId` without a script.

## Non-goals

- DirectorScript advance.
- Creating Show items from promote (slice 4).
- LLM planner (slice 5).

## Files likely

- `sdk/packages/shared/src/hub.ts` (command/event names)
- `sdk/packages/core/src/hub/server/handlers/drive-handlers.ts` (or new `drive-show-handlers.ts`)
- `sdk/packages/drive/src/director/rankBacklogs.ts` (call sites)
- `apps/cline-hub/src/server/drive-commands.ts`
- `apps/cline-hub/src/webview-protocol.ts`
- `apps/cline-hub/src/webview/src/drive/*` (dev enqueue/tick)

## Acceptance

- [x] Enqueue two mermaid shows with different priorities → tick presents the higher-ranked one.
- [x] Spotlight owner bias (+100) changes winner when priorities tie (unit test).
- [x] Slice 1 sample present still works (direct present bypasses rank).

## Risks

- Tick thrash if auto-tick on every work event — gate auto-present; rate-limit in slice 5.
- Divergent spotlight vs sharer skews rank until slice S — document which id tick uses.
