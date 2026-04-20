# TODO: Handle session resumption in `askResponse`

When a user clicks on an old task (`showTaskWithId` sets `this.task` with loaded messages
but does NOT create an `activeSession`), then sends a follow-up message, `askResponse`
currently bails out with "No active session". We need to spin up a new SDK session that
carries the old conversation history so the model has full context.

## Key findings from SDK source

- `DefaultSessionManager.start()` accepts `config.sessionId` — if set, it reuses that ID
  and looks up the persisted row (`resumedRow`). However, old tasks were created by the
  classic controller, not the SDK, so there is no persisted SDK row to find.
- `StartSessionInput.initialMessages` is passed through to the agent as `agentConfig.initialMessages`.
  The agent uses these as prior conversation context. This is the mechanism for resumption.
- `executeAgentTurn` checks `session.started || agent.getMessages().length > 0` to decide
  whether to call `agent.continue()` (append to history) vs `agent.run()` (fresh). If
  `initialMessages` are provided, `getMessages().length > 0` will be true, so it correctly
  calls `agent.continue()`.
- The old conversation history lives in **three** places:
  1. `ui_messages.json` — ClineMessage[] for the webview (already loaded by `showTaskWithId`)
  2. `api_conversation_history.json` — Anthropic.MessageParam[] (classic controller only)
  3. `~/.cline/data/sessions/<sessionId>/<sessionId>.messages.json` — SDK-persisted LLM
     messages (SQLite-indexed, read via `sessionManager.readMessages(sessionId)`)
- For SDK-created tasks, only #1 and #3 exist. `api_conversation_history.json` is never
  written by the SDK controller.
- The SDK's `LlmsProviders.Message[]` format is compatible with `Anthropic.MessageParam[]`
  (both are `{role, content: string | ContentBlock[]}` structurally).

## Tasks

### 1. ✅ Load conversation history from SDK persistence (primary) + classic fallback
- **Problem discovered**: The original implementation only read from
  `api_conversation_history.json`, which is NEVER written by the SDK controller.
  SDK-created tasks persist messages via `DefaultSessionManager.executeAgentTurn()`
  → `persistSessionMessages()` to SQLite/file storage at
  `~/.cline/data/sessions/<sessionId>/<sessionId>.messages.json`.
- **Fix**: Use `sessionManager.readMessages(taskId)` FIRST (reads from SQLite via
  the session service). Fall back to `getSavedApiConversationHistory(taskId)` for
  tasks created by the classic (non-SDK) controller.
- **IMPORTANT**: Must read BEFORE `start()` since `start()` with the same `sessionId`
  overwrites the session row/manifest.
- **Implementation**: Creates `VscodeSessionHost` first, calls `readMessages(taskId)`,
  then falls back to classic `api_conversation_history.json`.

### 2. ✅ Look up the HistoryItem for the old task
- Need the `HistoryItem` to get `cwdOnTaskInitialization` for the session config's `cwd`.
- Read from `StateManager.getGlobalStateKey("taskHistory")` (same as `showTaskWithId` does).
- **Implementation**: Reads from `this.stateManager.getGlobalStateKey("taskHistory")` and
  falls back to `process.cwd()` if not found.

### 3. ✅ Build a new session config
- Call `buildSessionConfig()` with the old task's `cwd` and current mode/provider settings.
- Set `config.sessionId` to the old task ID so the new session reuses the same ID
  (keeps history item linkage consistent).
- **Implementation**: Calls `buildSessionConfig({ cwd, mode })` then sets `config.sessionId = taskId`.

### 4. ✅ Create VscodeSessionHost and subscribe to events
- Same pattern as `initTask`: `VscodeSessionHost.create({ mcpHub })`, then `subscribe()`.
- **Implementation**: Creates `VscodeSessionHost`, subscribes with `handleSessionEvent`.
  Done before reading messages so `readMessages()` can use the session manager.

### 5. ✅ Start the session with `initialMessages`
- Call `sessionManager.start()` with the loaded conversation history as `initialMessages`.
- Pass `interactive: true`, no `prompt` (same as `initTask` — fast return).
- This gives the agent the full conversation context from the old task.
- **Implementation**: Passes `initialMessages` when non-empty. Omits when empty (fresh session).

### 6. ✅ Wire up the activeSession
- Set `this.activeSession` with the new session ID, manager, unsubscribe fn, etc.
- Update `this.task.taskId` to the new session ID if it changed (though ideally keep it
  the same by setting `config.sessionId`).
- **Implementation**: Sets `this.activeSession` and updates `this.task.taskId` if needed.

### 7. ✅ Send the user's follow-up message
- Call `sessionManager.send()` fire-and-forget with the user's prompt (same as current
  `askResponse` logic).
- The agent will call `agent.continue()` since `initialMessages` were provided, appending
  to the existing conversation.
- **Implementation**: Fire-and-forget `sessionManager.send()` with `.then()` / `.catch()`.

### 8. ✅ Update the HistoryItem
- Update the existing history item's timestamp and model info so it appears as recently active.
- **Implementation**: Sets `historyItem.ts = Date.now()` and `historyItem.modelId = config.modelId`,
  then calls `this.updateTaskHistory(historyItem)`.

### 9. ✅ Emit the user's message to the webview
- Add a "say:user_feedback" ClineMessage for the user's follow-up text so the webview shows
  it in the chat (the old messages are already loaded from `showTaskWithId`).
- **Implementation**: Creates a ClineMessage with `say: "user_feedback"`, adds to
  `messageStateHandler`, emits via `emitSessionEvents`, and calls `postStateToWebview()`.

### 10. ✅ Handle edge cases
- If no conversation history exists at all, fall back to starting a fresh session with a
  summary prompt (e.g., "[TASK RESUMPTION] Resuming task: ...").
- If no prompt is provided and we have history, session stays idle (ready for future messages).
- **Implementation**: `effectivePrompt` falls back to `[TASK RESUMPTION]` string when
  no conversation history and no user prompt. If no effective prompt at all, session
  is marked idle (`isRunning = false`).

## Implementation location

All changes in `src/sdk/SdkController.ts`:
- Modified `askResponse()` to detect `this.task && !this.activeSession` and call `resumeSessionFromTask()`
- Added private `resumeSessionFromTask(taskId, prompt, images, files)` method

## Bug fix applied
- **Root cause**: Original Task 1 read only from `api_conversation_history.json` (classic
  controller format), which is never written by the SDK controller. SDK-created tasks
  store LLM messages in SQLite at `~/.cline/data/sessions/`.
- **Fix**: Read from `sessionManager.readMessages(taskId)` first (SDK persistence),
  fall back to `getSavedApiConversationHistory(taskId)` (classic persistence).
