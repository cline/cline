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
**Where:** Settings → Terminal tab  
**Symptom:** Opening terminal settings causes React to crash, leaving a blank webview.  
**Root cause:** `getAvailableTerminalProfiles` was a gRPC stub returning `{data:{}}`. The webview called `setAvailableTerminalProfiles(response.profiles)` where `response.profiles` was `undefined`, overwriting the default `[]`. Then `TerminalSettingsSection` called `profilesToShow.map()` on `undefined`, crashing React.  
**Fix:** Implemented real `handleGetAvailableTerminalProfiles()` handler in grpc-handler.ts that calls `getAvailableTerminalProfiles()` from `utils/shell.ts`, returning platform-specific profiles (Default, zsh, bash on macOS). Also added `availableTerminalProfiles: []` to state-builder.ts as a safety net, and wired `scrollToSettings` to fire `navigate("settings", { targetSection })` via the bridge.  
**Verified:** Debug harness confirmed handler returns `{data:{profiles:[{id:"default",...},{id:"zsh",...},{id:"bash",...}]}}`, Settings → Terminal tab renders "Default Terminal Profile" dropdown with all 3 options, shell integration timeout, and terminal reuse settings.

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

### 14. 🟡 "Delete chat" button shows placeholder size
**Where:** Task history → delete button tooltip / label  
**Symptom:** The "Delete chat" button displays `(size: --)` instead of the actual disk size of the conversation data.  
**Expected:** Should show the real size (e.g., `(size: 12.4 KB)`) or omit the size entirely if unavailable.

### 15. 🔴 MCP tools are missing / not visible to the agent
**Where:** Agent tool execution  
**Symptom:** MCP tools that should be available to the agent are not discovered or listed. The agent cannot see or use any MCP-provided tools during task execution.  
**Expected:** Connected MCP servers should expose their tools to the agent, and the agent should be able to invoke them.

### 16. 🟡 Cline Rules popup still has a "Workflows" tab
**Where:** Scales-of-justice icon → Cline Rules modal  
**Symptom:** The "Manage Cline Rules" popup contains a "Workflows" tab. Issue #12 fixed the tooltip text, but the tab itself still exists inside the modal.  
**Expected:** The "Workflows" tab should be removed entirely since workflows are no longer a feature.

### 17. 🔴 Account pane shows "Sign up with Cline" despite being logged in
**Where:** Account panel / pane  
**Symptom:** Even when the user is already authenticated and logged in, the account pane still displays "Sign up with Cline" and other sign-up prompts as if the user were not authenticated.  
**Expected:** Should show the logged-in user's account details, usage, plan info, etc.

### 18. 🔴 "Sign up with Cline" button does nothing
**Where:** Account pane → Sign up button  
**Symptom:** Clicking the "Sign up with Cline" button produces no response — no browser opens, no auth flow starts, no feedback is given.  
**Expected:** Should initiate the Cline account sign-up / OAuth flow.

### 19. 🟡 Terminal settings still shows "Terminal Execution Mode" option
**Where:** Settings → Terminal  
**Symptom:** The Terminal settings section still displays a "Terminal Execution Mode" option. This is legacy — only background terminal execution should be supported now.  
**Expected:** Remove the Terminal Execution Mode selector. Background terminals should be the only mode.

### 20. 🟡 Cline provider model type-ahead search does not work
**Where:** Settings → Model selector (Cline provider)  
**Symptom:** When using the Cline provider, only "Recommended" and "Free" model categories are selectable. The type-ahead / search input for filtering models does not function — typing produces no results.  
**Expected:** The model search field should filter the full model list as the user types.

### 21. 🟡 Cline provider recommends possibly outdated model
**Where:** Settings → Model selector (Cline provider)  
**Symptom:** The Cline provider recommends `anthropic/claude-sonnet-4.5`, but this model is likely superseded by `claude-sonnet-4.6` which is already promoted elsewhere in the UI (e.g., feature carousel).  
**Expected:** Recommended model should be updated to the latest available (e.g., `anthropic/claude-sonnet-4.6`).

### 22. 🔴 "Use different models for Plan and Act" checkbox immediately unchecks
**Where:** Settings → Model configuration  
**Symptom:** Checking the "Use different models for Plan and Act modes" checkbox causes it to immediately uncheck itself. The setting cannot be enabled.  
**Root cause (likely):** The state update round-trips through proto serialization or a settings update handler that resets the value.  
**Expected:** Checkbox should stay checked and enable separate model pickers for Plan and Act modes.

### 23. 🔴 MCP settings gear icon opens blank webview
**Where:** MCP settings popup → gear icon  
**Symptom:** Opening the MCP settings popup and clicking the gear (configuration) icon results in a completely blank webview. No settings, no content rendered.  
**Expected:** Should display MCP server configuration options.

### 24. 🔴 History tab is empty and search does nothing
**Where:** History tab (task history list)  
**Symptom:** The history tab shows no tasks despite tasks having been completed. The fuzzy search input accepts text but produces no results and no feedback.  
**Expected:** Should list all completed/persisted tasks with working search/filter.

### 25. 🔴 Auto-approve options immediately uncheck when toggled
**Where:** Auto-approve options flyout  
**Symptom:** Clicking any auto-approve option (e.g., "Edit all files", "Use the browser", and likely all others) causes the checkbox to immediately uncheck itself. The setting cannot be enabled.  
**Root cause (likely):** Similar to issue #22 — the settings update handler or proto round-trip resets the value before it can persist.  
**Expected:** Toggling an auto-approve option should persist the change and keep the checkbox in its new state.

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
