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
- The old conversation history lives in two places:
  1. `ui_messages.json` — ClineMessage[] for the webview (already loaded by `showTaskWithId`)
  2. `api_conversation_history.json` — Anthropic.MessageParam[] (the actual LLM messages)
- The SDK's `LlmsProviders.Message[]` format needs to be compatible with what the agent
  expects. Need to verify `Anthropic.MessageParam[]` is compatible or needs conversion.

## Tasks

### 1. Load API conversation history from disk
- In the resume path (inside `askResponse` when `this.task && !this.activeSession`),
  load the old task's `api_conversation_history.json` using `getSavedApiConversationHistory(taskId)`.
- This returns `Anthropic.MessageParam[]`. The SDK's `initialMessages` expects
  `LlmsProviders.Message[]` — verify these are compatible (both are `{role, content}[]`
  from the Anthropic SDK types re-exported by `@clinebot/llms`).

### 2. Look up the HistoryItem for the old task
- Need the `HistoryItem` to get `cwdOnTaskInitialization` for the session config's `cwd`.
- Read from `StateManager.getGlobalStateKey("taskHistory")` (same as `showTaskWithId` does).

### 3. Build a new session config
- Call `buildSessionConfig()` with the old task's `cwd` and current mode/provider settings.
- Optionally set `config.sessionId` to the old task ID so the new session reuses the same ID
  (keeps history item linkage consistent). Note: this only helps if the SDK's session service
  can find a persisted row, which it won't for legacy tasks — but it still sets the session ID
  to match, which is useful for our `activeSession` tracking.

### 4. Create VscodeSessionHost and subscribe to events
- Same pattern as `initTask`: `VscodeSessionHost.create({ mcpHub })`, then `subscribe()`.

### 5. Start the session with `initialMessages`
- Call `sessionManager.start()` with the loaded API conversation history as `initialMessages`.
- Pass `interactive: true`, no `prompt` (same as `initTask` — fast return).
- This gives the agent the full conversation context from the old task.

### 6. Wire up the activeSession
- Set `this.activeSession` with the new session ID, manager, unsubscribe fn, etc.
- Update `this.task.taskId` to the new session ID if it changed (though ideally keep it
  the same by setting `config.sessionId`).

### 7. Send the user's follow-up message
- Call `sessionManager.send()` fire-and-forget with the user's prompt (same as current
  `askResponse` logic).
- The agent will call `agent.continue()` since `initialMessages` were provided, appending
  to the existing conversation.

### 8. Update the HistoryItem
- Update the existing history item's timestamp and model info so it appears as recently active.

### 9. Emit the user's message to the webview
- Add a "say:user_feedback" ClineMessage for the user's follow-up text so the webview shows
  it in the chat (the old messages are already loaded from `showTaskWithId`).

### 10. Handle edge cases
- If `api_conversation_history.json` doesn't exist or is empty, fall back to starting a
  fresh session with a summary prompt (e.g., "[TASK RESUMPTION] Resuming task: ...").
- If the old task's ClineMessages end with an unanswered `ask` (e.g., tool approval),
  the user's response should be handled appropriately — the SDK doesn't know about
  classic ask/response patterns, so the follow-up message text is the response.

## Implementation location

All changes go in `src/sdk/SdkController.ts` in the `askResponse` method. Extract the
resume logic into a private `resumeSessionFromTask()` method to keep `askResponse` clean.
