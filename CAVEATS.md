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

## Open Issues

### 2. 🔴 Task history not persisted after completion
**File:** `src/sdk/SdkController.ts` lines 180, 244–250  
**Symptom:** After a task completes successfully (e.g. "Say hello" → "Hello" with $0.0072 cost), the task does NOT appear in the RECENT section when returning to the home screen. No new task directories are created under `~/.cline/data/tasks/`.  
**Root cause:** `newTask()` creates a `currentTaskItem` (line 180) but never pushes it to `this.taskHistory[]`. `clearTask()` (line 244) sets `currentTaskItem = undefined` without saving it. There is no disk persistence implementation — no writes to `taskHistory.json` or individual task directories.  
**Impact:** All task history from the new SDK system is lost on every session. The RECENT section only shows tasks from the old legacy system.

### 3. 🔴 Task resumption not implemented
**File:** `src/sdk/SdkController.ts` line 280  
**Symptom:** Cannot resume a previous task from history.  
**Root cause:** Line 280 has `// TODO: Load task from history and restore messages`. The `resumeTask()` method is a no-op stub.

### 4. 🟡 Input text not cleared immediately on send
**Where:** Webview chat input  
**Symptom:** After typing a message and pressing send/enter, the text remains visible in the input field briefly before clearing. Creates a feeling of lag.  
**Expected:** Input should clear immediately on send, before the API request starts.

### 5. 🟡 api_req_started fires with zeroed token counts
**Where:** Message stream / ChatRow rendering  
**Symptom:** An `api_req_started` partial message fires with `{"tokensIn":0,"tokensOut":0,"cost":0}` before real counts arrive, causing a brief flash of "0 tokens" in the UI.  
**Expected:** Either don't show token counts until real data arrives, or suppress the initial zero-state.

### 6. 🟡 Settings persistence is best-effort / incomplete
**File:** `src/sdk/SdkController.ts` line 319  
**Symptom:** Comment says `// Store settings updates (would persist to disk in production)`. Settings changes made during a session may not persist reliably.  
**Impact:** Changes to auto-approve settings, model selection, etc. from the webview may not survive across sessions.

### 7. 🟡 Completed task not appearing in RECENT section
**Where:** Home screen → RECENT section  
**Symptom:** After completing a task and clicking "New Task", the completed task does not appear in the RECENT history list. Only tasks from the legacy system appear.  
**Root cause:** Directly related to issue #2 — task history isn't being persisted, so the RECENT section has no new items to show.

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

### Debug Harness Limitations
- Programmatic textarea input (via `nativeInputValueSetter` or Playwright `fill`/`type`) doesn't reliably trigger React state updates in the webview iframe after the first task. This is a **testing limitation** of the debug harness, not a product bug. The first task works because the React component is in its initial mount state; subsequent attempts may fail because React reconciliation doesn't detect the programmatic changes.
- The `web.evaluate` context can't access the VS Code API (`acquireVsCodeApi` already called).
- The `ui.locator` Playwright actions don't reliably target elements inside the webview iframe even with `frame: "sidebar"`.
