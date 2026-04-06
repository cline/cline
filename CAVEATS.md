# SDK Migration Caveats & Known Issues

Tracking issues found during the migration from the legacy inference system to the ClineCore SDK.

## Status Legend
- 🔴 **Blocker** — prevents core functionality
- 🟡 **Minor** — cosmetic or UX annoyance
- 🟢 **Fixed** — resolved

---

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

### 13. 🟢 Terminal settings navigates to blank/stuck webview
**Where:** Model settings panel → "Terminal settings" link  
**Symptom:** Opening terminal settings navigates to a blank webview. The user is stuck.  
**Root cause:** Missing `availableTerminalProfiles` in state-builder.ts — the TerminalSettingsSection component calls `.map()` on it, crashing React when it's `undefined`. Also, `scrollToSettings` handler now fires a typed `navigate` callback.  
**Fix:** Added `availableTerminalProfiles: []` to state-builder.ts output. The `scrollToSettings` handler fires `navigate("settings", { targetSection })` via the bridge.

---

## Open Issues

### 4. 🟡 Input text not cleared immediately on send
**Where:** Webview chat input  
**Symptom:** After typing a message and pressing send/enter, the text remains visible in the input field briefly before clearing. Creates a feeling of lag.  
**Expected:** Input should clear immediately on send, before the API request starts.

### 5. 🟡 api_req_started fires with zeroed token counts
**Where:** Message stream / ChatRow rendering  
**Symptom:** An `api_req_started` partial message fires with `{"tokensIn":0,"tokensOut":0,"cost":0}` before real counts arrive, causing a brief flash of "0 tokens" in the UI.  
**Expected:** Either don't show token counts until real data arrives, or suppress the initial zero-state.

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

### Debug Harness Limitations (Fixed)
All three limitations below have been addressed:

- ~~Programmatic textarea input doesn't reliably trigger React state updates after the first task.~~ **Fixed**: Two new commands added:
  - `ui.react_input` — Uses `document.execCommand('insertText')` which fires real InputEvents that React's onChange handler processes correctly, even after multiple tasks.
  - `ui.send_message` — Bypasses the textarea entirely by sending gRPC requests via `postMessage` directly to the extension host.
- ~~The `web.evaluate` context can't access the VS Code API.~~ **Fixed**: The webview now exposes the VS Code API as `window.__clineVsCodeApi`, and a new `web.post_message` command lets the harness send arbitrary messages to the extension host through it.
- ~~The `ui.locator` Playwright actions don't reliably target elements inside the webview iframe.~~ **Fixed**: `findSidebar()` now validates cached frame references (checking for both detached and stale frames), `getTarget()` accepts a `forceRefresh` flag, and `ui.locator` automatically retries with frame re-discovery when targeting sidebar elements.
