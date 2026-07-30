# Slice 4 · Do ↔ Show linkage

Back to [overview.md](overview.md). Depends on: [slice-2](slice-2-enqueue-rank-tick.md) + landed chat forks. Soft-depends: [slice-3](slice-3-script-runner.md) for linked scripts (optional). Unlocks: [slice-5](slice-5-planner-policy.md).

## Goal

Do backlog can be seeded without a prior claim; promote **creates** Show items (not only status flips); fork tick has real work to claim.

## Tasks

| ID | Task | Depends on | Owner | Done when |
|---|---|---|---|---|
| 4.1 | Hub command `drive.do.enqueue` upserts `DoBacklogItem` onto `director.doBacklog` | — | shared + core | Queued items visible on `drive.room.get` / room.changed ✓ |
| 4.2 | Ensure `runChatForkDirectorTick` / `tickChatForks` claims newly enqueued Do items (already implemented — add integration test with enqueue→tick→claim) | 4.1 | `@cline/core` | Test proves claim without pre-seeded claim ✓ |
| 4.3 | Extend `PromotePacket` / `applyPromotePacket`: when `showItemIds` or `linkedShowTemplateIds` present, **create** `ShowBacklogItem`s from templates if missing, status `ready` | 4.1, slice 2 enqueue shapes | `@cline/drive` + core | Promote after worker adds show rows to backlog ✓ |
| 4.4 | After promote creates shows, optional `runShowDirectorTick` (flag) | 4.3, slice 2 tick | core | Sticky can update from promote path ✓ |
| 4.5 | `DoBacklogItem.linked` / Show `linkedDoItemId` round-trip in fixtures | 4.3 | shared tests | Schema + promote test asserts link ✓ |
| 4.6 | Webview Workers audit: show created ids on promote summary | 4.3 | hub webview | Audit panel lists new show ids ✓ |

## Dependency notes

- Slice 2 required so created shows can be ranked/presented consistently.
- Slice 3 optional: promote may attach `linkedScriptId` later; not required for exit.
- Path-disjoint fork legality unchanged ([DRV-CHAT-FORK](../features/DRV-CHAT-FORK.md)).

## Non-goals

- Worktree isolation (DRV-ISOLATION).
- Planner choosing which Do/Show to enqueue (slice 5).

## Files likely

- `sdk/packages/shared/src/drive/chatFork.ts`
- `sdk/packages/drive/src/director/chatForkPolicy.ts`
- `sdk/packages/core/src/hub/server/handlers/drive-fork-handlers.ts`
- `sdk/packages/core/src/hub/server/handlers/drive-fork-tick.ts`
- New or extended do-enqueue in drive-handlers
- `apps/cline-hub/src/webview/src/drive/ChatForkAuditPanel.tsx`

## Acceptance

- [x] Enqueue Do → tick → claim → (simulate) promote with template ids → showBacklog contains new ready items.
- [x] Tick with empty Do backlog remains no-op (no errors).
- [x] Existing promote status-flip behavior preserved for pre-existing ids.

## Risks

- Promote creating shows with empty `produce.args` — require template defaults + allow override in packet.
