# History Flow Performance Improvements

This is a working checklist for improving slowness when:

1. Opening History.
2. Opening a task from History.

The current suspected high-level cause is a combination of cold SDK/core host startup, full-history scans, legacy task migration, large message loading, and expensive UI/state updates. We should tackle these incrementally and measure after each change.

## 1. Add timing instrumentation first

Status: implemented initial `[HistoryPerf]` logging in the webview and backend.

Before changing behavior, add focused timing logs around the hot path so each improvement can be verified.

Suggested spans:

- `HistoryView` mount to `getTaskHistory` response.
- `HistoryView` mount to `getTotalTasksSize` response.
- `SdkController.getTaskHistory` total time.
- `SdkTaskHistory.listHistory` total time.
- `VscodeSessionHost.create` time.
- `ClineCore.create` / hub connection wait time if separable.
- `host.listHistory` time.
- legacy `readTaskHistory` + merge/sort time.
- `showTaskWithId` total time.
- task lookup time.
- legacy migration time.
- `readMessages` time.
- `sdkMessagesToClineMessages` time.
- webview message push loop time.
- `postStateToWebview` time.

Goal: confirm which bottleneck dominates for the affected user.

Initial instrumentation locations:

- `webview-ui/src/components/history/HistoryView.tsx`
- `src/core/controller/task/getTotalTasksSize.ts`
- `src/sdk/SdkController.ts`
- `src/sdk/sdk-task-control-coordinator.ts`
- `src/sdk/sdk-task-history.ts`
- `src/sdk/vscode-session-host.ts`

## 2. Avoid unbounded history listing in `showTaskWithId`

Status: implemented targeted `findHistoryItem(taskId)` lookup for task opening. It now tries SDK `host.get(taskId)` first and falls back to legacy `taskHistory.json` lookup by ID, avoiding the previous default full `listHistory()` call in `SdkController.showTaskWithId`.

Current issue:

- `SdkController.showTaskWithId(taskId)` calls `this.taskHistory.listHistory()` with default options.
- `SdkTaskHistory.listHistory()` defaults to a very large limit and may hydrate records.
- Opening one task should not require listing thousands of sessions.

Potential fixes:

- Add a targeted `findHistoryItem(taskId)` path that does not scan/hydrate all history.
- At minimum, call `listHistory({ hydrate: false })` where lookup is unavoidable.
- Prefer SDK host `get(taskId)` plus legacy fallback lookup by ID.

Expected impact: faster task opening, especially with 1000+ old sessions.

## 3. Reuse a history/session host instead of creating temporary hosts repeatedly

Current issue:

- `SdkTaskHistory.withHistoryHost()` creates a temporary `VscodeSessionHost` when there is no active session.
- A single History open or task click can trigger multiple temporary host creations.

Potential fixes:

- Keep a shared lazy history host for read-only history operations.
- Dispose it on extension deactivation or after an idle timeout.
- Avoid creating and disposing a host for every `listHistory`, `getClineMessages`, or migration check.

Expected impact: reduces cold `ClineCore.create()`/hub setup costs and repeated startup overhead.

## 4. Decouple History from hub startup blocking

Current issue:

- `VscodeSessionHost.create()` awaits `getActivationHubConnection()` if hub startup is in progress.
- Starting the hub earlier can hide cold startup, but can also make the first History call wait for hub readiness and causes lifecycle risk.

Potential fixes:

- Do not block history-only operations on in-progress hub startup if local fallback is acceptable.
- Bound hub wait time more aggressively for history reads.
- Make hub startup lazy/non-blocking unless a real runtime session needs it.

Expected impact: avoids History waiting up to the hub startup timeout.

## 5. Optimize `getTaskHistory` pagination and filtering

Current issue:

- `SdkTaskHistory.listHistory({ limit, offset })` converts offset pagination into `hostLimit = offset + limit`.
- Later pages become increasingly expensive.
- Filtering/searching happens after fetching one page, so filtered results can be incomplete and may encourage extra loads.

Potential fixes:

- Add cursor-based pagination if SDK/core supports it.
- Add filtering/search/sort to the lower-level history API if possible.
- If not possible, maintain an indexed/cached history list and paginate from the cache.
- Ensure `hasMore` reflects filtered results, not just raw page size.

Expected impact: better infinite-scroll performance and more correct search/filter behavior.

## 6. Cache or index merged history metadata

Current issue:

- Every history request reads SDK history, reads legacy `taskHistory.json`, merges, sorts, and slices.
- With many old tasks this repeated work adds up.

Potential fixes:

- Maintain an in-memory cache of merged history metadata.
- Invalidate on task create/update/delete/favorite/migration.
- Consider persisting a lightweight index if startup scans are still expensive.

Expected impact: faster repeated History opens, filtering, and state updates.

## 7. Make `getTotalTasksSize` lazy/cached/backgrounded

Status: partially implemented. History no longer requests total task/checkpoint size immediately on mount; the webview defers the recursive size scan until after the first history page has loaded, with a short delay. Explicit refreshes after deletes still request the size.

Current issue:

- Opening History triggers recursive size calculation for `globalStorageFsPath/tasks` and `checkpoints`.
- This can be slow with many tasks/checkpoints.

Potential fixes:

- Cache the total size and recompute in the background.
- Show “calculating…” instead of blocking or competing with history load.
- Update size only after delete/export operations or on a debounce.
- Consider removing automatic full directory size scan from initial History mount.

Expected impact: faster perceived History open and less filesystem contention.

## 8. Improve legacy task migration on open

Current issue:

- Opening an old legacy task can trigger migration from `api_conversation_history.json` into SDK session persistence.
- This may read/translate/sanitize large histories and write new artifacts before the task is shown.

Potential fixes:

- Show legacy task immediately from existing UI messages if available, then migrate in background.
- Only migrate when the user resumes/continues the task, not when merely viewing.
- Cache migration status to avoid repeated checks.
- Optimize `migrateLegacyTaskIfNeeded` to avoid repeated full `readTaskHistory()` lookups.

Expected impact: much faster viewing of old tasks.

## 9. Batch or replace per-message webview pushes when opening a task

Current issue:

- `showTaskWithId` loops through loaded messages and awaits `pushMessageToWebview(msg)` for each message.
- Large tasks can involve many serialized webview messages.

Potential fixes:

- Send one batched message list for history load.
- Or rely on `postStateToWebview()` carrying `clineMessages` instead of pushing every message individually.
- If streaming individual messages is needed for UX, chunk them without awaiting each one serially.

Expected impact: faster task display for long conversations.

## 10. Navigate to chat earlier when a history item is clicked

Current issue:

- `src/core/controller/task/showTaskWithId.ts` sends the chat navigation event only after `controller.showTaskWithId()` completes.
- Backend slowness is experienced as staying stuck in History.

Potential fixes:

- Navigate immediately and show a loading state while messages load.
- Or have the webview navigate optimistically on click before awaiting RPC completion.
- Preserve error handling if loading fails.

Expected impact: improved perceived responsiveness.

## 11. Debounce History search and avoid duplicate reloads

Current issue:

- Search input updates `searchQuery` immediately.
- Search also changes `sortOption` to `mostRelevant`, which can trigger additional reloads.

Potential fixes:

- Debounce search queries.
- Coalesce search/sort state updates into one backend request.
- Cancel/ignore stale requests already exists via `historyRequestIdRef`, but backend work may still run.

Expected impact: fewer expensive history requests while typing.

## 12. Avoid expensive state history rebuilds after task open

Current issue:

- `postStateToWebview()` calls `getStateToPostToWebview()`.
- The SDK implementation then calls `this.taskHistory.listHistory({ limit: 100, hydrate: false })` again.
- This happens after loading a task from history.

Potential fixes:

- Reuse the already-found history item for `currentTaskItem`.
- Avoid rebuilding task history during task-open state post.
- Use cached history metadata from item 6.

Expected impact: reduces extra work after opening a task.

## 13. Add user-visible loading states and partial rendering

Current issue:

- Slow operations can look like the UI is frozen.

Potential fixes:

- Show a History loading skeleton immediately.
- Show total size later when available.
- Show chat task shell immediately, then progressively fill messages.

Expected impact: better perceived performance even before all backend optimizations are complete.

## Suggested implementation order

1. Add instrumentation.
2. Fix unbounded `showTaskWithId` lookup.
3. Stop initial History open from doing full folder size scans synchronously.
4. Reuse/cache history host or history metadata.
5. Optimize legacy migration/viewing.
6. Batch task message delivery.
7. Improve pagination/search/filtering.
8. Revisit hub lifecycle only after the above measurements.
