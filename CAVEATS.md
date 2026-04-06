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

### 8. 🔴 Top bar buttons are non-functional
**Where:** Header bar — accounts, settings, new chat, history buttons  
**Symptom:** Clicking any of the top bar buttons (accounts icon, settings gear, new chat +, task history) does nothing. No navigation occurs, no panels open.  
**Root cause:** gRPC stub. The webview subscribes to `subscribeToSettingsButtonClicked`, `subscribeToHistoryButtonClicked`, `subscribeToChatButtonClicked`, `subscribeToAccountButtonClicked` — these are event streams pushed from the extension host when VSCode title bar buttons are clicked. The grpc-handler returns empty `{ data: {} }` for all of them, so no callback is ever fired and the webview never navigates.  
**Expected:** Each button should navigate to its respective view (account settings, settings panel, new chat, task history list).

### 9. 🔴 @ mentions / autocomplete not working
**Where:** Chat input textarea  
**Symptom:** Typing `@` in the chat input does not trigger any autocomplete dropdown. No filename suggestions, no context items offered.  
**Root cause:** gRPC stub. The `@` autocomplete calls `FileServiceClient.searchFiles()` to get matching file paths. The grpc-handler stubs `searchFiles` → `{ data: {} }`, so no results are returned and the dropdown never appears.  
**Expected:** `@` should open a dropdown showing workspace files, folders, and other context items that can be attached to the message.

### 10. 🔴 Add files/images button (+) does nothing
**Where:** Bottom bar, "+" button next to chat input  
**Symptom:** Clicking the "+" button to add files and images produces no response — no file picker, no dropdown, no action.  
**Root cause:** gRPC stub. The button calls `FileServiceClient.selectFiles()` which opens a native file picker dialog. Stubbed → silent no-op.  
**Expected:** Should open a file picker or context menu for attaching files/images to the message.

### 11. 🔴 Cannot switch from Plan mode back to Act mode
**Where:** Bottom bar Plan/Act toggle  
**Symptom:** Clicking "Plan" successfully switches to Plan mode. However, clicking "Act" after that does NOT switch back to Act mode. The user is stuck in Plan mode.  
**Root cause:** The grpc-handler has a real `togglePlanActModeProto` implementation, so this is likely a bug in the mode value conversion (proto enum → string), or the state push back to webview doesn't include the updated mode. Check `[grpc-handler] STUB:` logs to confirm it's not a different method.  
**Expected:** The Plan/Act toggle should work bidirectionally.

### 12. 🟡 "Manage cline rules and workflows" still mentions workflows
**Where:** Settings or context menu  
**Symptom:** The option text still says "Manage cline rules and workflows" even though workflows were removed in Phase 0 cleanup.  
**Root cause:** Webview UI text — not a gRPC issue. Needs a string change in a React component.  
**Expected:** Should say "Manage cline rules" (or similar) with no mention of workflows.

### 13. 🔴 Terminal settings navigates to blank/stuck webview
**Where:** Model settings panel → "Terminal settings" link  
**Symptom:** Opening model settings (by clicking the model name in the bottom bar), then clicking "Terminal settings" navigates to a blank webview. The user is stuck — no back button, no way to return to the main view.  
**Root cause:** Likely gRPC stub. The settings view navigates to a Terminal Settings sub-view that calls `getAvailableTerminalProfiles` and `updateTerminalConnectionTimeout` — both stubbed. The blank page may also be a missing React route/component. May make sense to remove "Terminal settings" entirely if there are no terminal settings in SDK mode.  
**Expected:** Either remove the option or make it work. Must never leave the user stuck on a blank page.

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
