These are issues the agent claims to have fixed, but should be verified:

## Fixed

### 1. 🟢 Remote inference fails with ECONNREFUSED (localhost:4000)
**File:** `src/sdk/cline-session-factory.ts`  
**Symptom:** Sending any message with the Cline provider fails after 6 retries with "Cannot connect to API" / ECONNREFUSED to `http://localhost:4000/v1/chat/completions`.  
**Root cause:** Base URL overrides (`openAiBaseUrl`, `openRouterBaseUrl`, `liteLlmBaseUrl`) were applied unconditionally to ALL providers, clobbering the Cline API URL. A stale `openAiBaseUrl: "http://localhost:4000/v1"` in `~/.cline/data/globalState.json` overwrote `https://api.cline.bot/api/v1`.  
**Fix:** Guard each base URL override with a provider check so it only applies to its respective provider.

---

### 2. 🟢 Task history not persisted after completion
**File:** `src/sdk/SdkController.ts`  
**Symptom:** After a task completes successfully, the task did NOT appear in the RECENT section when returning to the home screen.  
**Root cause:** `newTask()` created a `currentTaskItem` but never pushed it to `this.taskHistory[]`. `clearTask()` discarded it without saving. No disk persistence implementation existed.  
**Fix:** `SdkController` now persists tasks on three paths: (1) `done` event updates `currentTaskItem` with final usage and calls `persistCurrentTask()`, (2) `clearTask()` calls `persistCurrentTask()` before resetting, (3) `cancelTask()` persists the in-progress task. `LegacyStateReader` gained `saveTaskHistory()`, `saveUiMessages()`, and `deleteTaskDirectory()` methods for disk I/O.

### 3. 🟢 Task resumption not implemented
**File:** `src/sdk/SdkController.ts`  
**Symptom:** Cannot resume a previous task from history.  
**Fix:** `showTaskWithId()` now finds the task in history, loads saved UI messages via `legacyState.readUiMessages()`, restores them into the translator, and sets `currentTaskItem`. The task view renders with full message history.

### 6. 🟢 Settings persistence is best-effort / incomplete
**File:** `src/sdk/SdkController.ts`  
**Symptom:** `updateSettings()` was a no-op stub with a TODO comment.  
**Fix:** `updateSettings()` now persists settings to `globalState.json` via `legacyState.saveApiConfiguration()`. `updateAutoApprovalSettings()` also persists via the same mechanism.

### 7. 🟢 Completed task not appearing in RECENT section
**Where:** Home screen → RECENT section  
**Symptom:** After completing a task and clicking "New Task", the completed task did not appear in the RECENT history list.  
**Fix:** Resolved by issue #2 fix — tasks are now persisted to `taskHistory` on completion, so they appear in RECENT.

### 8. 🟢 Top bar buttons are non-functional
**Where:** Header bar — accounts, settings, new chat, history buttons  
**Symptom:** Clicking any of the top bar buttons (accounts icon, settings gear, new chat +, task history) does nothing. No navigation occurs, no panels open.  
**Root cause:** gRPC stub. The webview subscribes to `subscribeToSettingsButtonClicked`, etc. — these are event streams pushed from the extension host when VSCode title bar buttons are clicked.  
**Fix:** Extension.ts button commands now send typed `navigate` messages via `WebviewGrpcBridge.navigate()`, bypassing gRPC streaming subscriptions. Plus button also calls `clearSdkTask()` to reset the SDK session.

### 9. 🟢 @ mentions / autocomplete not working
**Where:** Chat input textarea  
**Symptom:** Typing `@` in the chat input does not trigger any autocomplete dropdown. No filename suggestions, no context items offered.  
**Root cause:** gRPC stub. The `@` autocomplete calls `FileServiceClient.searchFiles()` to get matching file paths.  
**Fix:** Implemented `searchFiles` handler in grpc-handler.ts that delegates to `SdkController.searchFiles()`, which does a real filesystem walk of the workspace directory (max depth 8, skips node_modules/.git/etc). Returns results with `mentionsRequestId` for proper request correlation.

### 10. 🟢 Add files/images button (+) does nothing
**Where:** Bottom bar, "+" button next to chat input  
**Symptom:** Clicking the "+" button to add files and images produces no response — no file picker, no dropdown, no action.  
**Root cause:** gRPC stub. The button calls `FileServiceClient.selectFiles()` which opens a native file picker dialog.  
**Fix:** Implemented `selectFiles` handler that returns `StringArrays` format (`values1` = image data URLs, `values2` = file paths). VscodeWebviewProvider callback reads image files as base64 data URLs and returns relative paths for non-images.

### 11. 🟢 Cannot switch from Plan mode back to Act mode
**Where:** Bottom bar Plan/Act toggle  
**Symptom:** Clicking "Plan" successfully switches to Plan mode. However, clicking "Act" after that does NOT switch back to Act mode.  
**Root cause:** Proto enum conversion bug — the webview sends numeric enum values (0=PLAN, 1=ACT) but the handler expected string values.  
**Fix:** `handleTogglePlanActMode` now converts proto enum values: `0/"PLAN" → "plan"`, `1/"ACT" → "act"`, with fallback for already-converted string values.

### 12. 🟢 "Manage cline rules and workflows" still mentions workflows
**Where:** ClineRulesToggleModal tooltip and aria-label  
**Symptom:** The tooltip and aria-label still said "Manage Cline Rules & Workflows".  
**Fix:** Updated tooltip to "Manage Cline Rules" and aria-label to "Show/Hide Cline Rules". Also simplified chat placeholder text to remove "workflows" mention.

### 4. 🟢 Input text not cleared immediately on send
**Where:** Webview chat input  
**Symptom:** After typing a message and pressing send/enter, the text remains visible in the input field briefly before clearing. Creates a feeling of lag.  
**Root cause:** In `useMessageHandlers.ts`, `setInputValue("")` was called AFTER `await TaskServiceClient.newTask(...)` or `await TaskServiceClient.askResponse(...)` completed. The network round-trip caused visible delay before the input cleared.  
**Fix:** Moved `setInputValue("")`, `setActiveQuote(null)`, `setSelectedImages([])`, `setSelectedFiles([])` to execute immediately when `hasContent` is true, before any async gRPC calls. React schedules a re-render synchronously, clearing the input before the network round-trip.

### 5. 🟢 api_req_started fires with zeroed token counts
**Where:** Message stream / ChatRow rendering  
**Symptom:** An `api_req_started` partial message fires with `{"tokensIn":0,"tokensOut":0,"cost":0}` before real counts arrive, causing a brief flash of "0 / 200.0k" in the token usage bar.  
**Root cause:** `ContextWindow.tsx` rendered the token bar whenever `tokenData` existed (i.e., when `contextWindow > 0`), regardless of whether `lastApiReqTotalTokens` was 0.  
**Fix:** Added `tokenData.used === 0` guard to the null-return check in `ContextWindow.tsx`. The token bar now only renders when real (non-zero) token data is available.

### 14. 🟢 "Delete chat" button shows placeholder size
**Where:** Task history → delete button tooltip / label  
**Symptom:** The "Delete chat" button tooltip displays `Delete Task (size: --)` when task size data is unavailable.  
**Root cause:** `DeleteTaskButton.tsx` unconditionally rendered `(size: ${taskSize ? formatSize(taskSize) : "--"})`, showing "--" when `taskSize` is undefined.  
**Fix:** Changed to conditionally include size: `taskSize ? \`Delete Task (${formatSize(taskSize)})\` : "Delete Task"`. The tooltip now shows just "Delete Task" when size is unavailable, or "Delete Task (12.4 KB)" when it is.

### 13. 🟢 Terminal settings navigates to blank/stuck webview
**Where:** Settings → Terminal tab  
**Symptom:** Opening terminal settings causes React to crash, leaving a blank webview.  
**Root cause:** `getAvailableTerminalProfiles` was a gRPC stub returning `{data:{}}`. The webview called `setAvailableTerminalProfiles(response.profiles)` where `response.profiles` was `undefined`, overwriting the default `[]`. Then `TerminalSettingsSection` called `profilesToShow.map()` on `undefined`, crashing React.  
**Fix:** Implemented real `handleGetAvailableTerminalProfiles()` handler in grpc-handler.ts that calls `getAvailableTerminalProfiles()` from `utils/shell.ts`, returning platform-specific profiles (Default, zsh, bash on macOS). Also added `availableTerminalProfiles: []` to state-builder.ts as a safety net, and wired `scrollToSettings` to fire `navigate("settings", { targetSection })` via the bridge.  
**Verified:** Debug harness confirmed handler returns `{data:{profiles:[{id:"default",...},{id:"zsh",...},{id:"bash",...}]}}`, Settings → Terminal tab renders "Default Terminal Profile" dropdown with all 3 options, shell integration timeout, and terminal reuse settings.

### 16. 🟢 Cline Rules popup still has a "Workflows" tab
**Where:** Scales-of-justice icon → Cline Rules modal  
**Symptom:** The "Manage Cline Rules" popup contains a "Workflows" tab. Issue #12 fixed the tooltip text, but the tab itself still exists inside the modal.  
**Root cause:** The `ClineRulesToggleModal` component had a full "Workflows" tab with toggle lists for global, local, and remote workflows, plus a description section. Workflows are no longer a feature.  
**Fix:** Removed the Workflows tab button, workflows description text, workflows content section (remote/global/local workflow toggle lists), and the remote workflows banner condition from `ClineRulesToggleModal.tsx`. The `currentView` state type was narrowed from `"rules" | "workflows" | "hooks" | "skills"` to `"rules" | "hooks" | "skills"`.

### 17. 🟢 Account pane shows "Sign up with Cline" despite being logged in
**Where:** Account panel / pane  
**Symptom:** Even when the user is already authenticated and logged in, the account pane still displays "Sign up with Cline" and other sign-up prompts as if the user were not authenticated.  
**Root cause:** `subscribeToAuthStatusUpdate` is a streaming subscription. The bridge's `handleStreamingRequest()` fell into the `default` no-op case, so auth state was never pushed to the webview.  
**Fix:** Added explicit `subscribeToAuthStatusUpdate` case in `handleStreamingRequest()` that reads auth credentials from disk and pushes them. Added `roles` to org data and null safety in `isAdminOrOwner()`.

### 18. 🟢 "Sign up with Cline" button does nothing (moot)
**Where:** Account pane → Sign up button  
**Fix:** Resolved by #17 — the sign-up button is no longer shown when the user is already authenticated.

### 19. 🟢 Terminal settings still shows "Terminal Execution Mode" option
**Where:** Settings → Terminal  
**Fix:** Removed the Terminal Execution Mode dropdown, its handler, and unused imports from `TerminalSettingsSection.tsx`.

### 20. 🟢 Cline provider model type-ahead search does not work
**Where:** Settings → Model selector (Cline provider)  
**Root cause:** `refreshClineModelsRpc` was a gRPC stub returning `{}`. The webview never received any model data.  
**Fix:** Implemented `handleRefreshClineModels()` in grpc-handler.ts that reads from disk cache first, then falls back to fetching from the Cline API using `globalThis.fetch`. Converts API response to `ModelInfo` records and returns in protobuf format.

### 21. 🟢 Cline provider recommends possibly outdated model
**Where:** Settings → Model selector (Cline provider)  
**Fix:** Updated fallback recommendation text in `ClineModelPicker.tsx` from `anthropic/claude-sonnet-4.5` to `anthropic/claude-sonnet-4.6`.

### 22. 🟢 "Use different models for Plan and Act" checkbox immediately unchecks
**Where:** Settings → Model configuration  
**Root cause:** `updateSettings()` was writing raw settings instead of merging individual known keys.  
**Fix:** `updateSettings()` now iterates known settings keys and writes each one individually. `buildExtensionState()` reads `planActSeparateModels` from `globalState`.

### 23. 🟢 MCP settings Configure tab crashes React
**Where:** MCP Servers → Configure tab  
**Root cause:** `refreshMcpMarketplace` stub returns `{}`, replacing the default `{ items: [] }` state, causing `items.find()` to crash.  
**Fix:** Added optional chaining (`?.items?.find`) in `getMcpServerDisplayName()`.

### 24. 🟢 History tab is empty and search does nothing
**Where:** History tab (task history list)  
**Root cause:** `handleGetTaskHistory()` returned `{ data: { history } }` but webview reads `response.tasks`.  
**Fix:** Changed return to `{ data: { tasks, totalCount } }`. Implemented server-side filtering/sorting.

### 25. 🟢 Auto-approve options immediately uncheck when toggled
**Where:** Auto-approve options flyout  
**Root cause:** Same as #22 — `updateAutoApprovalSettings()` was not persisting properly.  
**Fix:** Fixed alongside #22.

---

### 15. 🟢 MCP tools are missing / not visible to the agent
**Where:** Agent tool execution  
**Symptom:** MCP tools that should be available to the agent are not discovered or listed. The agent cannot see or use any MCP-provided tools during task execution.  
**Root cause:** `ClineCoreSession` in `cline-session-factory.ts` didn't pass MCP configuration through `coreConfig` when calling `host.start()`. The MCP settings file existed at `~/.cline/data/settings/cline_mcp_settings.json` but the session factory never wired MCP servers into the ClineCore session.  
**Fix:** Added `getOrCreateMcpManager()` to `cline-session-factory.ts` that reads MCP server registrations via `resolveMcpServerRegistrations()`, creates an `InMemoryMcpManager` with a client factory using `@modelcontextprotocol/sdk` (supporting stdio, streamableHttp, and SSE transports), connects to all non-disabled servers, generates `Tool[]` via `createMcpTools()`, and passes them as `extraTools` in `coreConfig`. The MCP manager is cached across sessions (servers are long-lived processes). Connection has a 30s timeout to avoid blocking session start. Individual server connection failures are logged but don't prevent other servers or the session from starting.  
**Verified:** Debug harness confirmed agent lists `kamibiki__kb_search`, `kamibiki__kb_status`, `kamibiki__kb_index` from the kamibiki MCP server, and successfully invoked `kamibiki__kb_status` returning real indexing data (6 repos, 1M+ embeddings).

---

### 27. 🟢 Banners (e.g., "Try Claude Sonnet 4.6") can't be dismissed
**Where:** Home screen → banner carousel  
**Symptom:** Clicking the X dismiss button on any banner does nothing — the banner remains visible and reappears on reload.  
**Root cause:** Two issues: (1) `state-builder.ts` hardcoded `dismissedBanners: undefined` instead of reading from globalState, so dismissed banners were never communicated to the webview. (2) `grpc-handler.ts` wrote dismissed banner IDs as plain strings instead of the `{ bannerId, dismissedAt }` objects the webview expects.  
**Fix:** State builder now reads `dismissedBanners` from globalState with `normalizeDismissedBanners()` that handles both legacy plain strings and new objects. Handler writes proper `{ bannerId, dismissedAt }` objects and normalizes legacy entries on read.  
**Verified:** Debug harness confirmed banners dismiss correctly — carousel shrinks as each banner is dismissed and stays dismissed across reloads.

### 28. 🟢 Can't mark chats as favorites in history
**Where:** History tab → star button on task items  
**Symptom:** Clicking the star icon on a history item does nothing — the favorite state never changes.  
**Root cause:** Proto field name mismatch in `handleToggleTaskFavorite()`: handler read `request.params?.id` and `request.params?.isFavorite`, but the webview sends `taskId` and `isFavorited` (proto field names from `TaskFavoriteRequest`).  
**Fix:** Handler now reads both proto names (`taskId`/`isFavorited`) with fallback to legacy names (`id`/`isFavorite`).  

### 29. 🟢 Copy button obscured by last code block in chat
**Where:** Chat response text with code blocks  
**Symptom:** The response copy button overlaps with the last code block, making it hard to see and click.  
**Root cause:** `CopyButton.tsx` positioned the bottom-right copy button at `bottom-1` (4px from bottom edge), which overlapped with code block content. No padding existed between the markdown content and the button.  
**Fix:** Changed position to `bottom-2.5` (10px clearance) and added `pb-4` padding to the chat text content wrapper for code block clearance.  

### 30. 🟢 Current balance shows "----" / reload button does nothing
**Where:** Account pane → credit balance display  
**Symptom:** The current balance always shows "----" and the reload button has no effect.  
**Root cause:** `getUserCredits` handler returned `{ credits: undefined }` instead of calling the Cline API. The webview reads `response.balance.currentBalance` which was always undefined.  
**Fix:** `getUserCredits` and `getOrganizationCredits` now fetch real balance data from the Cline API using the stored auth token (`Bearer` header). Includes 10s timeout and error handling.  
**Tested:** Integration tests with mock HTTP server verify real balance data flows through correctly (7 tests).

### 31. 🟢 Logout button does nothing
**Where:** Account pane → logout button  
**Symptom:** Clicking logout has no effect — the user remains logged in.  
**Root cause:** `accountLogoutClicked` was a STUB (silent no-op) in grpc-handler.  
**Fix:** Implemented `handleAccountLogout()` that calls `LegacyStateReader.clearClineAuthInfo()` to remove `cline:clineAccountId` from secrets.json, then pushes state update so the webview shows the sign-in view.  
**Tested:** Integration test verifies credentials are cleared from disk and auth status shows unauthenticated after logout.

### 32. 🟢 Low credit balance persists after account switching
**Where:** Account pane after switching organizations  
**Symptom:** After switching from a low-balance org to a high-balance org, the "Insufficient balance" error persists.  
**Root cause:** `setUserOrganization` was a STUB. The active org was never updated on disk, so credit queries always returned the same org's data.  
**Fix:** Implemented `handleSetUserOrganization()` that calls `LegacyStateReader.setActiveOrganization()` to update the `active` flag on orgs in stored credentials. Each credit fetch is a fresh API call keyed by org ID, so switching orgs correctly fetches the new org's balance.  
**Tested:** Integration test with mock server verifies: switch from low-balance org → high-balance org returns correct (high) balance, not stale (low) balance.

## Open Issues

---

### 26. 🟢 Clicking history items does not open them
**Where:** History tab → clicking any task item; also RECENT section on home screen  
**Symptom:** History items display correctly in the History view, but clicking on them does nothing — the view stays on the History tab instead of navigating to the chat view with the loaded task.  
**Root cause:** `handleShowTaskWithId()` in `grpc-handler.ts` called `this.delegate.showTaskWithId(id)` to load the task data and push state, but never fired `this.onNavigateCallback?.("chat")` to tell the webview to navigate from the History view to the Chat view.  
**Fix:** Added `this.onNavigateCallback?.("chat")` after `showTaskWithId()` completes in `grpc-handler.ts`. This sends a typed `navigate` message to the webview, which triggers `navigateToChat()` — hiding the History view and revealing the Chat view with the loaded task.  
**Verified:** Debug harness confirmed clicking items in both the History tab and RECENT section on the home screen now navigates to the chat view with full message history loaded.

---

## Observations (not bugs, just notes)

### UI Rendering — Task Completion View
The completed task view renders correctly:
- Task header with cost badge (e.g. "$0.0072")
- Token usage bar (e.g. "1.4k / 200.0k")
- Response text displayed properly
- "Task Completed" card with green checkmark and the result
- "Start New Task" button appears below the chat
- Input area changes to "Type a message..." (follow-up mode)

### Feature Card Carousel
The home screen shows a rotating feature card carousel (1/4 through 4/4) promoting:
- Claude Sonnet 4.6
- MiniMax M2.5
- ChatGPT integration
- Jupyter Notebooks
Each with a dismiss (X) button per-card.

### Model Selector
Bottom bar correctly shows `cline:anthropic/claud...` (truncated) with Plan/Act toggle. Act mode is the default.

### Debug Harness: `ui.send_message` and `ui.react_input(submit:true)` Don't Start Tasks
Both `ui.send_message` (gRPC postMessage) and `ui.react_input` with `submit:true` report success but don't actually start a new task—the webview stays on the home screen. The workaround is to use `ui.react_input` (without submit) to set the text, then dispatch a KeyboardEvent via `web.evaluate`:
```
curl -s localhost:19229/api -d '{"method":"ui.react_input","params":{"text":"your message","clear":true}}'
curl -s localhost:19229/api -d '{"method":"web.evaluate","params":{"expression":"(() => { const ta = document.querySelector(\"textarea\"); ta.focus(); ta.dispatchEvent(new KeyboardEvent(\"keydown\",{key:\"Enter\",code:\"Enter\",keyCode:13,which:13,bubbles:true})); return \"ok\"; })()"}}'
```

### Debug Harness Limitations (Fixed)
All three limitations below have been addressed:

- ~~Programmatic textarea input doesn't reliably trigger React state updates after the first task.~~ **Fixed**: Two new commands added:
  - `ui.react_input` — Uses `document.execCommand('insertText')` which fires real InputEvents that React's onChange handler processes correctly, even after multiple tasks.
  - `ui.send_message` — Bypasses the textarea entirely by sending gRPC requests via `postMessage` directly to the extension host.
- ~~The `web.evaluate` context can't access the VS Code API.~~ **Fixed**: The webview now exposes the VS Code API as `window.__clineVsCodeApi`, and a new `web.post_message` command lets the harness send arbitrary messages to the extension host through it.
- ~~The `ui.locator` Playwright actions don't reliably target elements inside the webview iframe.~~ **Fixed**: `findSidebar()` now validates cached frame references (checking for both detached and stale frames), `getTarget()` accepts a `forceRefresh` flag, and `ui.locator` automatically retries with frame re-discovery when targeting sidebar elements.
