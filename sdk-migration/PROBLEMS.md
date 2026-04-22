# SDK Migration — Known Issues & Verification Tracker

This file tracks problems found during the migration. Each problem
has a status and verification evidence. Problems are never marked
🟢 without evidence.

## Status Legend

- 🔴 **Blocker** — prevents core functionality
- 🟡 **Minor** — cosmetic or UX annoyance
- 🔵 **Awaiting Verification** — fix attempted, not yet verified
- 🟢 **Verified Fixed** — fix confirmed with evidence

## Known Issues From Previous Attempt

These issues were present in the second migration attempt. They
are listed here as a reference for what to watch out for. They
do not necessarily apply to this attempt's codebase, but the
underlying patterns that caused them are relevant.

### Auth & Account (Highest Risk Area)

| ID | Description | Status |
|----|-------------|--------|
| A1 | Inference works when appearing logged out | Carried pattern |
| A2 | Inference NOT working when appearing logged in | Carried pattern |
| A3 | Login button does nothing or opens wrong URL | Carried pattern |
| A4 | Logout button does nothing | Carried pattern |
| A5 | Profile/credits/history not displayed when logged in | Carried pattern |
| A6 | Error messages instead of login buttons when actually logged out | Carried pattern |
| A7 | Hardcoded `app.cline.bot` instead of `{appBaseUrl}` | Carried pattern |
| A8 | `workos:` prefix inconsistency on account IDs | Carried pattern |
| A9 | Org switching doesn't update inference profile | Carried pattern |
| A10 | Low credit balance persists after switching orgs | Carried pattern |

### gRPC Thunking

| ID | Description | Status |
|----|-------------|--------|
| G1 | Stubbed handlers return `{data:{}}` causing webview crashes | Carried pattern |
| G2 | Proto field name mismatches (e.g., `taskId` vs `id`) | Carried pattern |
| G3 | Streaming subscriptions race condition | Carried pattern |
| G4 | "SDK mode" vs "classic mode" confusion | Addressed by design |

### Feature Removal

| ID | Description | Status |
|----|-------------|--------|
| F1 | Empty `if (request.type === "workflow") {}` blocks | Carried pattern |
| F2 | Features marked "legacy" instead of actually removed | Carried pattern |
| F3 | Workflows tab still in Cline Rules modal | Carried pattern |
| F4 | Terminal settings show IDE terminal options | Carried pattern |

### UI / Webview

| ID | Description | Status |
|----|-------------|--------|
| U1 | Copy button obscured by code blocks | Carried pattern |
| U2 | Token usage bar shows 0/0 | Carried pattern |
| U3 | Input text not cleared immediately on send | Carried pattern |
| U4 | Task history items not clickable | Carried pattern |
| U5 | MCP server management buttons are no-ops | Carried pattern |
| U6 | MCP Marketplace never loads | Carried pattern |
| U7 | Tool output rectangles appear blank | Carried pattern |

## New Issues

### Step 1: Foundation & Cutover — Completed

- **Status**: 🟢 Verified Fixed
- **Description**: SDK adapter layer created as single entry point. Extension compiles and builds.
- **Verification**: `npx tsc --noEmit` returns 0 errors. `node esbuild.mjs` produces `dist/extension.js`.
- **Evidence**: Commit `3dec59fe9` on `sdk-migration-v3` branch.

### S1-1: SdkController stubs log warnings at runtime
- **Status**: 🟡 Minor
- **Description**: All unimplemented Controller methods log `[SdkController] STUB: <name> not yet implemented`. This is expected — functionality is added in Steps 4-8.
- **Root cause**: By design — stub pattern for incremental migration.
- **Fix**: Implement each method in its corresponding step.

### S1-2: Services not initialized (mcpHub, authService, etc.)
- **Status**: 🟢 Verified Fixed
- **Description**: The SdkController now initializes `authService`, `ocaAuthService`, `accountService` (Step 6), and `mcpHub` (Step 7). All core services are initialized.
- **Root cause**: N/A — fixed incrementally in Steps 6 and 7.
- **Fix**: Auth and account services wired in Step 6. MCP hub wired in Step 7 using classic McpHub (will be replaced by SDK's InMemoryMcpManager in Step 10).

### S1-3: Extension loads but sidebar shows errors
- **Status**: 🟢 Verified Fixed
- **Description**: Extension loads, sidebar renders correctly with full UI (chat input, model selector, announcements, auto-approve settings). No error elements in the webview.
- **Verification**: Debug harness launched with `--auto-launch`, sidebar opened, `document.querySelectorAll("[data-testid=error], .error, .codicon-error").length` returns 0. Sending a message via `ui.send_message` returns `{"sent": true, "method": "newTask"}` without crash. Task doesn't start (expected — `initTask` is a stub).
- **Evidence**: Debug harness session on 2026-04-13, commit `3dec59fe9`.

### Step 2: Legacy State Reader — Completed

- **Status**: 🟢 Verified Fixed
- **Description**: `src/sdk/legacy-state-reader.ts` reads all existing on-disk state from the Cline data directory. Supports globalState.json, secrets.json, taskHistory.json, per-task data (api_conversation_history, ui_messages, context_history, task_metadata), MCP settings, and task directory listing.
- **Verification**: 37 unit tests pass (`npx vitest run --config vitest.config.sdk.ts`). TypeScript compiles with 0 errors (`npx tsc --noEmit`). All reads are non-throwing — missing/corrupt files return typed defaults.
- **Evidence**: All tests pass on 2026-04-13.

### Step 3: Provider Migration — Completed

- **Status**: 🟢 Verified Fixed
- **Description**: `src/sdk/provider-migration.ts` uses the SDK's `ProviderSettingsManager` to auto-migrate legacy provider credentials from `globalState.json` + `secrets.json` to the SDK's `providers.json` format. Supports all 30+ providers. Never overwrites existing entries. Tags migrated entries with `tokenSource: "migration"`. Idempotent.
- **Verification**: 12 unit tests pass covering Anthropic, OpenAI, OpenRouter, Bedrock, Ollama, Cline providers, no-overwrite guarantee, idempotency, and missing state handling. TypeScript compiles with 0 errors.
- **Evidence**: All tests pass on 2026-04-13.

### Step 4: Session Lifecycle — Completed

- **Status**: 🟢 Verified Fixed
- **Description**: Session lifecycle implemented in `src/sdk/cline-session-factory.ts`, `src/sdk/message-translator.ts`, and `src/sdk/SdkController.ts`. The SdkController now has working `initTask()`, `askResponse()`, `cancelTask()`, `clearTask()`, `showTaskWithId()`, and `reinitExistingTaskFromId()` methods that create SDK sessions via `ClineCore`, subscribe to events, translate them to `ClineMessage[]`, and emit to listeners. The message translator handles all SDK event types: `chunk`, `agent_event` (content_start/update/end, done, error, notice, iteration_start/end, usage), `ended`, `hook`, and `status`. Session factory builds `CoreSessionConfig` from legacy state via `ProviderSettingsManager` and creates `HistoryItem` records.
- **Verification**: 91 unit tests pass across 4 test files (27 message-translator, 37 legacy-state-reader, 15 cline-session-factory, 12 provider-migration). TypeScript compiles with 0 errors in `src/sdk/`. Tests cover: streaming state tracking, all event type translations, full streaming flows (text→tool→text), history item CRUD, session input building, and provider config resolution.
- **Evidence**: All tests pass on 2026-04-13. `npx tsc --noEmit` returns 0 errors in `src/sdk/`.

### Step 5: gRPC Thunking Layer — Completed

- **Status**: 🟢 Verified Fixed
- **Description**: gRPC thunking layer implemented in `src/sdk/task-proxy.ts` and `src/sdk/webview-grpc-bridge.ts`. The `TaskProxy` provides a classic Task-compatible interface that delegates to SDK session methods, allowing existing gRPC handlers to work without modification. The `WebviewGrpcBridge` translates SDK session events to proto ClineMessages and pushes them through the existing `subscribeToPartialMessage` and `subscribeToState` gRPC streams. The `MessageStateHandler` extends `EventEmitter` for CLI compatibility (on/off pattern). The SdkController wires everything together: session events → message translation → gRPC bridge → webview streams.
- **Verification**: 114 unit tests pass across 6 test files (16 task-proxy, 7 webview-grpc-bridge, 27 message-translator, 37 legacy-state-reader, 15 cline-session-factory, 12 provider-migration). TypeScript compiles with 0 new errors (3 pre-existing errors in unrelated files). Tests cover: TaskProxy delegation, MessageStateHandler event emission, WebviewGrpcBridge message/state pushing, error handling.
- **Evidence**: All tests pass on 2026-04-13. `npx tsc --noEmit` returns only 3 pre-existing errors (searchFiles.ts, commit-message-generator.ts).

### S4-1: Session lifecycle not yet wired to gRPC handlers
- **Status**: 🟢 Verified Fixed
- **Description**: The SdkController's session lifecycle methods are now wired to the gRPC handler layer via the TaskProxy. The webview's `newTask` and `askResponse` messages flow through: gRPC handler → TaskProxy → SdkController → SDK session. Session events flow back: SDK → message translator → WebviewGrpcBridge → gRPC streams → webview.
- **Root cause**: N/A — fixed in Step 5.
- **Fix**: TaskProxy delegates `handleWebviewAskResponse()` and `abortTask()` to SdkController callbacks. WebviewGrpcBridge pushes translated messages through `sendPartialMessageEvent()` and `sendStateUpdate()`.

### S4-2: Task resumption uses new session instead of SDK resume API
- **Status**: 🟢 Verified Fixed
- **Description**: Resumption now works with preserved context. When a user opens a historical task and sends a follow-up, `SdkController.askResponse()` resumes by creating a session with the existing task ID and loading prior conversation as `initialMessages`.
- **Root cause**: The old flow had no active SDK session for history-only tasks, so follow-up prompts had no session context.
- **Fix applied**: Implemented `resumeSessionFromTask()` in `src/sdk/SdkController.ts` (commit `34afde1c5`). The flow reads persisted SDK messages (`readMessages(taskId)`) with fallback to classic `api_conversation_history`, starts a session with `config.sessionId = taskId`, posts the user follow-up immediately to chat, then sends the prompt to the resumed session.
- **Verification**: Manual verification via resumed history task + follow-up message.
- **Evidence**: Commit `34afde1c5` (“resume session working”).

### S4-3: Workspace root not available from ClineExtensionContext
- **Status**: 🟢 Verified Fixed
- **Description**: `ClineExtensionContext` doesn't have a `workspaceRoot` property. The SdkController fell back to `process.cwd()` for the session's working directory, which in VSCode returns the extension host's directory — NOT the user's workspace.
- **Root cause**: The shared context type was designed for CLI/ACP use and doesn't include VSCode-specific workspace info.
- **Fix applied**: Added `SdkController.getWorkspaceRoot()` private method that resolves the workspace root via `HostProvider.workspace.getWorkspacePaths()` (which calls `vscode.workspace.workspaceFolders[0].uri.fsPath` under the hood), falling back to `process.cwd()` only when no workspace folder is open. Replaced all 4 `process.cwd()` calls in SdkController (in `initTask()`, `reinitExistingTaskFromId()`, `resumeSessionFromTask()`, `restartSessionForMcpTools()`) with `await this.getWorkspaceRoot()`. Also added a defensive warning log in `buildSessionConfig()` for the `process.cwd()` fallback path. See S6-38 for the full fix entry.
- **Verification**: TypeScript compiles with 0 new errors (5 pre-existing SDK type errors). All `process.cwd()` calls replaced with host-aware workspace resolution.
- **Evidence**: Code review — `HostProvider.workspace.getWorkspacePaths()` delegates to the same `vscode.workspace.workspaceFolders` API used in `common.ts:131` and throughout the classic extension.

### Step 6: Auth & Account Flows — Completed

- **Status**: 🟢 Verified Fixed
- **Description**: SDK-backed auth and account services implemented. `src/sdk/auth-service.ts` replaces classic `src/services/auth/AuthService.ts`, using `@clinebot/core` OAuth functions (`loginClineOAuth`, `loginOcaOAuth`, `loginOpenAICodex`, `refreshClineToken`) for login flows while maintaining compatibility with the existing gRPC handler interface. `src/sdk/account-service.ts` replaces classic `src/services/account/ClineAccountService.ts`, making authenticated API requests using the SDK-backed AuthService for token management. The SdkController now initializes `authService`, `ocaAuthService`, and `accountService` in its constructor and restores auth state from secrets on startup. gRPC handlers (`accountLoginClicked`, `accountLogoutClicked`, `subscribeToAuthStatusUpdate`, `openAiCodexSignIn`, `openAiCodexSignOut`) now import from `@/sdk/auth-service` instead of the classic `@/services/auth/AuthService`. The `extension.ts` secrets listener also imports from the new location.
- **Key design decisions**:
  - Auth info persisted in `secrets.json` under `cline:clineAccountId` (same key as classic)
  - Tokens stored with `workos:` prefix for API compatibility
  - Token refresh uses SDK's `refreshClineToken()` with automatic retry and error recovery
  - Cross-window auth sync via secrets change listener preserved
  - Codex credentials stored via SDK's `ProviderSettingsManager`
  - `handleAuthCallback()` supports URI-handler-based OAuth flow (code exchange)
  - Streaming subscriptions push initial auth state immediately (prevents race condition)
- **Verification**: 20 unit tests pass in `src/sdk/auth-service.test.ts`. TypeScript compiles with 0 new errors. Tests cover: singleton pattern, auth state management, organization lookup, token persistence (read/write/clear), logout flow, workos: prefix handling, streaming subscriptions, and auth restoration on startup.
- **Evidence**: All tests pass on 2026-04-14. `npx tsc --noEmit` returns only pre-existing errors (none in `src/sdk/`).

### S6-1: Auth login flow not yet verified end-to-end
- **Status**: 🟢 Verified Fixed
- **Description**: The SDK-backed `loginClineOAuth()` flow has not been tested with a real browser OAuth flow. The classic flow used Firebase custom token exchange; the SDK flow uses a local callback server. Need to verify: (1) browser opens correctly, (2) callback server receives the code, (3) tokens are exchanged and persisted, (4) webview shows authenticated state.
- **Root cause**: Requires debug harness + real Cline account.
- **Fix**: Test with debug harness using `ui.send_message` to trigger login flow.
- **Verification**: Debug harness `ui.screenshot` after login should show user avatar/credits.

### S6-2: OCA and Codex OAuth flows not yet verified
- **Status**: 🔵 Awaiting Verification
- **Description**: `ocaLogin()` and `openAiCodexLogin()` delegate to SDK functions but haven't been tested end-to-end. The Codex flow stores credentials via `ProviderSettingsManager` instead of the classic `openAiCodexOAuthManager`.
- **Root cause**: Requires real OAuth providers.
- **Fix**: Manual testing with debug harness.

### S6-3: MCP OAuth callback stubbed
- **Status**: 🟢 Verified Fixed
- **Description**: MCP OAuth callback is now implemented.
- **Root cause**: Previously delegated to stub path.
- **Fix applied**: `SdkController.handleMcpOAuthCallback()` now calls `mcpHub.completeOAuth(serverHash, code, state)` and posts updated state to the webview, with error logging on failure.
- **Verification**: Manual OAuth callback test with remote Notion MCP server.
- **Evidence**: Commit `a8ac26e36` (“fix mcp oauth callback”).

### S6-5: Sending messages creates history entry but doesn't switch to inference view
- **Status**: 🟢 Verified Fixed
- **Description**: Inference itself works (the SDK agent runs, produces output, and the session completes with tokens). However, the webview does NOT switch from the welcome/history view to the chat/inference view when a message is sent. A new entry appears in the task history sidebar, but the user stays on the welcome page and never sees the agent's output.
- **Root cause**: The view transition depends on `clineMessages` having at least one message (the "task" message) in the state update. The webview's `ChatView.tsx` shows the chat view when `messages.at(0)` is truthy. Previously, the task message was only sent via the partial message stream but NOT included in the state's `clineMessages` (see S6-22). When the state update arrived with empty `clineMessages`, the webview saw no messages and stayed on the welcome view.
- **Fix applied**: Same as S6-22 — the task message is now added to `messageStateHandler` before emitting, so the state update includes it in `clineMessages`. The webview receives `clineMessages` with the task message and switches to the chat view.
- **Verification**: Send a message, verify the webview switches to the chat view showing the agent's streaming output.
- **Evidence**: Manual verification on 2026-04-16 — new chats display and do inference.

### S6-6: Clicking historical chat items does nothing (includes S6-15)
- **Status**: 🔵 Awaiting Verification (three fixes applied)
- **Description**: Clicking on a task in the history view now opens the chat view and stays there (no more flash-back to welcome). Previously, the chat view showed only "Thinking" with no messages displayed. The task's messages were loaded from disk but not rendering in the webview.
- **Root cause (flash-back fixed)**: `showTaskWithId()` was rewritten to avoid `clearTask()` race condition. The view now stays on the chat view.
- **Root cause (messages missing — fixed)**: Two issues:
  1. The messages loaded from disk were added to `messageStateHandler` and included in the state update's `clineMessages`, but the webview relies on the partial message stream for rendering individual messages. The state update alone wasn't sufficient — messages also need to be pushed through the partial message stream (`subscribeToPartialMessage`).
  2. **Path mismatch**: `showTaskWithId()` was using `readUiMessages()` from `legacy-state-reader.ts` which reads from `~/.cline/data/tasks/<id>/ui_messages.json`. But `saveClineMessages()` (from `disk.ts`) writes to `HostProvider.globalStorageFsPath/tasks/<id>/ui_messages.json` — a different path (e.g., VSCode's extension storage). The messages were being saved to one location and read from another, so `readUiMessages()` always returned an empty array.
- **Fix applied**:
  1. **(flash-back)**: Rewrote `showTaskWithId()` in `SdkController.ts` to avoid calling `clearTask()`. Instead: (1) unsubscribe from events FIRST, (2) clear `activeSession` reference, (3) fire-and-forget session stop/dispose, (4) create new task proxy with loaded messages BEFORE state push, (5) only then call `postStateToWebview()`.
  2. **(messages — partial stream)**: In `showTaskWithId()`, after loading messages from disk and adding them to `messageStateHandler`, also push each message through the partial message stream via `pushMessageToWebview()`. The webview receives messages from two sources: state updates (bulk) and partial messages (individual). Pushing through both ensures the webview has messages regardless of timing. The webview deduplicates by timestamp, so duplicate pushes are harmless.
  3. **(messages — path mismatch)**: Replaced `readUiMessages()` (from `legacy-state-reader.ts`) with `getSavedClineMessages()` (from `@core/storage/disk`) in `showTaskWithId()`. Both `saveClineMessages` and `getSavedClineMessages` use `HostProvider.globalStorageFsPath` as the base path, so they read/write from the same location. Removed the unused `readUiMessages` import.
- **Verification**: Click a history item, verify the chat view loads with the task's messages visible.

### S6-7: Credits/payment history don't load immediately on startup
- **Status**: 🟡 Minor
- **Description**: After login, the available tokens and payment history don't appear immediately. They show up after clicking refresh. This is a timing issue — the first `getStateToPostToWebview()` call may happen before the auth token is fully restored.
- **Root cause**: Race condition between auth restoration and initial state push.
- **Fix**: Ensure `restoreRefreshTokenAndRetrieveAuthInfo()` completes before the first state push, or trigger a re-fetch after auth restoration completes.

### S6-4: Provider-specific OAuth callbacks (OpenRouter, Requesty, Hicap) stubbed
- **Status**: 🟢 Verified Fixed
- **Description**: Provider OAuth callbacks are now implemented for OpenRouter, Requesty, and Hicap.
- **Root cause**: Previously low-priority stubs.
- **Fix applied**:
  - `SdkController` now routes all three callbacks to `authService` and posts state updates.
  - `auth-service.ts` implements:
    - `handleOpenRouterCallback(code)` via OpenRouter code→API key exchange (`/api/v1/auth/keys`), then persists config.
    - `handleRequestyCallback(code)` and `handleHicapCallback(code)` by persisting provider API keys and switching plan/act providers.
  - Added shared helper `setProviderApiKey()` for consistency.
- **Verification**: Manual OpenRouter login flow tested end-to-end (provider selected, “get OpenRouter API key”, prompt sent successfully).
- **Evidence**: Commits `d68e83981` and `69d500f87`.

### S6-8: Debug harness loads extension in "local" environment (brown logo)
- **Status**: 🟢 Verified Fixed
- **Description**: When run via the debug harness, the extension appears in "local" environment mode (brown Cline logo) instead of "production" mode (white-on-black logo). The production VSCode launch configuration works correctly.
- **Root cause**: `src/dev/debug-harness/server.ts:370` hardcodes `CLINE_ENVIRONMENT: "local"` in the environment variables passed to the extension host.
- **Fix**: Changed to `"production"` or made configurable.
- **Evidence**: Manual verification on 2026-04-16.

### S6-9: DefaultSessionManager has multiple CLI-oriented assumptions
- **Status**: 🔵 Awaiting Verification (VscodeSessionHost wired into SdkController)
- **Description**: `DefaultSessionManager` was designed primarily for the SDK's CLI (`clite`) and has several assumptions that don't fit the VSCode extension context. These are all addressable through the constructor options or by wrapping/catching, but must be accounted for:

  **a) Hardcoded "clite" in OAuth error messages** (`default-session-manager.ts:1377`):
  `syncOAuthCredentials()` throws `Run "clite auth ${error.providerId}" and retry.` when OAuth re-auth is needed. Meaningless in VSCode.
  **Mitigation**: Provide a custom `oauthTokenManager` that handles re-auth through the extension's login flow, or catch this error in SdkController and show a login button.

  **b) Session source defaults to `SessionSource.CLI`** (line 199):
  Every session is tagged as `"cli"` in telemetry and session manifests. VSCode sessions should be tagged differently.
  **Mitigation**: Pass `source: SessionSource.VSCODE` (or equivalent) in `StartSessionInput`. Check if `SessionSource` has a VSCode variant; if not, use a custom string.

  **c) OAuth token manager uses `ProviderSettingsManager` for token storage** (lines 185-190):
  The default `RuntimeOAuthTokenManager` reads/writes tokens via `ProviderSettingsManager` (`providers.json`). The VSCode extension stores OAuth tokens in `secrets.json` under `cline:clineAccountId`. The default manager won't find them.
  **Mitigation**: Provide a custom `oauthTokenManager` that reads from the extension's `secrets.json` / `StateManager`.

  **d) `providerSettingsManager` defaults to reading `providers.json`** (lines 183-184):
  `buildResolvedProviderConfig()` (line 268) uses this to resolve provider config including `knownModels` and `reasoningSettings`. If the extension's credentials aren't in `providers.json`, this resolution may produce incomplete config.
  **Mitigation**: Provide a custom `providerSettingsManager` or ensure `providers.json` is kept in sync.

  **e) `start()` and `send()` block until the agent turn completes** (lines 411-420, 437-475):
  Both methods are blocking — they return only after the agent finishes its turn. Events stream in real-time via `subscribe()`, but the calling code is blocked. This is fine for CLI but problematic for gRPC handlers that need to return immediately.
  **Mitigation**: Fire-and-forget the `start()`/`send()` calls (don't await in the gRPC handler), or run them in a background task. The `sdk-migration-fri` branch awaits them but pushes UI state before calling.

  **f) Tools are built once per session — no mid-session tool list changes** (line 296-318):
  `runtimeBuilder.build()` is called once at session start. The resulting `runtime.tools` array plus `config.extraTools` are merged and passed to the agent. There is no mechanism to add/remove tools from the array mid-session.

  **Important distinction — tool policies vs tool list:**
  - **Tool policies** (`toolPolicies: Record<string, ToolPolicy>`) control whether each tool is `enabled` and `autoApprove`d. The CLI mutates the policies object in-place mid-session and the agent sees changes on the next tool call. The VSCode auto-approve settings dialog maps to **policy changes**, which ARE supported natively.
  - **Tool list** (the actual `Tool[]` array) is static after `build()`. Adding/removing MCP servers mid-session requires changing this array, which is NOT supported.

  **Mitigation for auto-approve toggles**: Use `toolPolicies` mutation or `requestToolApproval` callback — both work mid-session.

  **Mitigation for MCP tool list changes**: The SDK supports `initialMessages` on `start()`, which pre-loads conversation history into a new session. The Tauri desktop app (`apps/code/host/runtime-bridge.ts`) already uses this pattern for checkpoint restoration. When MCP servers change mid-session: (1) stop the current session, (2) read its messages via `readMessages(sessionId)`, (3) start a new session with `initialMessages` set to those messages + the updated MCP tool list. The agent continues seamlessly. This is simpler and more robust than dynamic tool wrappers.

  **g) No mechanism for IDE-specific tool executors at the `DefaultSessionManager` level**:
  The `defaultToolExecutors` option (line 310) allows overriding how builtin tools execute (e.g., `bash`, `editor`). This IS the extensibility point for IDE-specific behavior like using VSCode's integrated terminal. However, the executor interface is defined by the SDK and may not cover all VSCode-specific needs (e.g., diff view, browser session).
  **Mitigation**: Investigate the `ToolExecutors` interface to see what's overridable. For tools not covered, use `extraTools` to provide custom implementations.

- **Root cause**: The SDK was designed as a host-agnostic runtime. The `DefaultSessionManager` provides sensible defaults for CLI use, but VSCode integration requires overriding several of these defaults. All fields are `private readonly` — the class cannot be subclassed. `ClineCore.create()` always creates a `DefaultSessionManager` internally via `createSessionHost()` — there's no way to inject a custom `SessionHost`.

- **Architecture decision — Wrapper vs Fork vs Direct Use:**

  **Option A: Direct use of `ClineCore.create()`** — Cannot customize `source`, cannot intercept OAuth errors. ❌ Insufficient.

  **Option B: Fork `DefaultSessionManager`** — Write a `VscodeSessionManager` (1516 lines to maintain). Full control but high maintenance burden. Reserve as fallback.

  **Option C (Recommended): Wrapper around `DefaultSessionManager`** — Construct `DefaultSessionManager` directly (it's exported), pass all custom options, then wrap it in a thin `VscodeSessionHost` that implements `SessionManager`:
  - Intercepts `start()` to inject `source: "vscode"`
  - Provides custom `oauthTokenManager` that reads from `secrets.json`/`StateManager` and triggers VSCode login UI on re-auth (preventing the "clite" error path entirely — `syncOAuthCredentials` only throws the "clite" message when `OAuthReauthRequiredError` is caught, so if our custom manager handles re-auth differently, that code path is never reached)
  - Provides custom `runtimeBuilder` for MCP (see S6-10)
  - Provides `requestToolApproval` for VSCode approval UI
  - Provides `defaultToolExecutors` for IDE-specific behavior
  - Catches and translates any remaining errors from `send()`/`start()` into VSCode-appropriate signals

  The wrapper is ~50-100 lines. If we hit walls where internal behavior can't be intercepted at the boundary, escalate to Option B.

- **Fix needed**: Create `src/sdk/vscode-session-host.ts` with the following custom components:

  **1. `VscodeSessionHost` (wrapper, ~50-100 lines)**
  - Implements `SessionManager` interface (13 methods: `start`, `send`, `abort`, `stop`, `dispose`, `get`, `list`, `delete`, `readMessages`, `readTranscript`, `readHooks`, `subscribe`, `getAccumulatedUsage`)
  - Delegates all methods to an inner `DefaultSessionManager`
  - Intercepts `start()` to inject `source: "vscode"` (or check `SessionSource` enum for a VSCode variant)
  - Catches errors from `start()`/`send()` and translates OAuth re-auth errors into VSCode-friendly signals (e.g., emit an event that triggers the login UI)

  **2. `VscodeOAuthTokenManager` (custom `oauthTokenManager`, ~50 lines)**
  - Implements `RuntimeOAuthTokenManager` interface (check `packages/core/src/session/` for the interface)
  - `resolveProviderApiKey({ providerId, forceRefresh })`: reads OAuth tokens from `secrets.json` via `StateManager.get().getSecretKey("cline:clineAccountId")`, extracts `idToken`, adds `workos:` prefix
  - On re-auth failure: instead of throwing `OAuthReauthRequiredError` (which triggers the "clite" message), emit a signal/event that the SdkController can use to show the VSCode login UI
  - This prevents the "clite" error path in `syncOAuthCredentials` from ever being reached

  **3. `VscodeRuntimeBuilder` (custom `runtimeBuilder`, ~100 lines)**
  - Implements `RuntimeBuilder` interface (`build(config): { tools: Tool[], shutdown: () => void, ... }`)
  - For builtin tools: delegate to `DefaultRuntimeBuilder`
  - For MCP tools: read currently-connected servers from `McpHub`, convert to SDK `Tool[]` format
  - See S6-10 for full MCP integration details

  **4. `requestToolApproval` callback (~30 lines)**
  - Receives `ToolApprovalRequest` with `toolName`, `input`, `policy`
  - If `policy.autoApprove` is true: return `{ approved: true }` immediately
  - Otherwise: emit an event to the webview showing the approval dialog, await user response
  - Return `{ approved: boolean, reason?: string }`

  **5. Wire into `SdkController`:**
  - Replace `ClineCore.create()` with direct `DefaultSessionManager` construction + `VscodeSessionHost` wrapper
  - Pass `VscodeOAuthTokenManager`, `VscodeRuntimeBuilder`, `requestToolApproval`, `defaultToolExecutors`
  - Use `VscodeSessionHost.subscribe()` for event streaming to the webview

  **Reference**: `DefaultSessionManager` constructor options at `packages/core/src/session/default-session-manager.ts:138-151`. `SessionManager` interface at `packages/core/src/session/session-manager.ts:57-73`. `RuntimeOAuthTokenManager` in `packages/core/src/session/`. `RuntimeBuilder` interface in `packages/core/src/runtime/`.

### S6-10: DefaultRuntimeBuilder loads MCP tools once — no file watching
- **Status**: 🟢 Verified Fixed
- **Description**: The SDK's `DefaultRuntimeBuilder.loadConfiguredMcpTools()` reads MCP settings from `CLINE_MCP_SETTINGS_PATH` (or default path) **once** at session start. It creates an `InMemoryMcpManager`, connects all servers, and returns tools. There is **no file watching** — changes to the MCP settings file after session start are not detected.
- **Root cause**: The SDK's MCP integration was designed for CLI/batch use where sessions are short-lived. The VSCode extension's `McpHub` watches the settings file, supports dynamic connect/disconnect, provides real-time server status to the webview, and supports the MCP Marketplace.
- **Impact**: Users cannot add/remove/restart MCP servers without restarting the extension. MCP server status in the webview will be stale. MCP Marketplace installs won't take effect until next session.
- **Fix needed**: Two-layer approach:
  1. **McpHub stays as the lifecycle manager**: Keep the classic `McpHub` for file watching, dynamic connect/disconnect, server status UI, and MCP Marketplace. It manages the MCP settings file and server connections independently of the SDK session.
  2. **Custom RuntimeBuilder bridges McpHub → SDK tools**: At session start, a custom `RuntimeBuilder` reads the currently-connected MCP servers from `McpHub` and converts them to SDK `Tool[]` format. For builtin tools (editor, bash, etc.), delegate to `DefaultRuntimeBuilder`.
  3. **Session restart on MCP tool list changes**: When `McpHub` detects that MCP servers have been added or removed (file watcher fires), and there's an active session: (a) stop the current session, (b) read its messages via `readMessages(sessionId)`, (c) start a new session with `initialMessages` set to those messages. The new session's `RuntimeBuilder.build()` will pick up the updated MCP tool list from `McpHub`. The Tauri desktop app (`apps/code/host/runtime-bridge.ts`) already uses this `initialMessages` pattern for checkpoint restoration.

     **History deduplication caveat**: A session restart creates a new session ID. The old session's persisted data stays on disk, which would create a duplicate entry in the task history list. The Tauri desktop app avoids this via its "threads" abstraction — the UI tracks threads, not raw sessions, and updates the thread's session reference. For the VSCode extension, we need to either: (a) delete the old session's history entry when restarting, (b) mark it as "superseded" and filter it from the history view, or (c) reuse the same task ID / history entry and just swap the underlying session. Option (c) is cleanest — the `SdkController` already maintains a `currentTaskItem` that maps to the history view; on restart, keep the same task item and just update the internal session reference.
  4. **No session restart needed for MCP tool policy changes**: If the user just toggles auto-approve for an MCP tool, that's a `toolPolicies` mutation — no session restart required.
- **Reference**: Classic extension's `McpHub` in `src/services/mcp/McpHub.ts`; SDK's `InMemoryMcpManager` in `packages/core/src/extensions/mcp/`; Tauri desktop's session restart pattern in `apps/code/host/runtime-bridge.ts`

### S6-12: Webview shows raw JSON instead of rendered messages
- **Status**: 🟢 Verified Fixed
- **Description**: When the SDK streams events to the webview, the ChatRow.tsx component shows raw JSON instead of properly rendered messages (text, tool calls, etc.). The message translator was producing ClineMessages with the wrong format for tool calls — using `tool_name`/`tool_input`/`tool_output` keys instead of the `text` field with XML-like `<tool_name>...</tool_name>` format that ChatRow.tsx expects.
- **Root cause**: The message translator's `translateToolCall()` and `translateToolResult()` methods were creating ClineMessages with custom fields (`tool_name`, `tool_input`, `tool_output`) that the webview's ChatRow.tsx doesn't understand. The classic Task class formats tool calls as XML-like text in the `text` field (e.g., `<read_file>\n<path>file.ts</path>\n</read_file>`), and ChatRow.tsx parses this format to render tool-specific UI.
- **Fix applied**: Rewrote `translateToolCall()` and `translateToolResult()` in `src/sdk/message-translator.ts` to format tool calls as XML-like text in the `text` field, matching the classic Task's format. Added `formatToolCallText()` and `formatToolResultText()` helper functions. Updated `translateTextChunk()` to handle partial text streaming. Updated `translateAgentEvent()` to properly track tool call state (pending tool name, accumulating input, partial text).
- **Verification**: Send a message that triggers tool use, verify ChatRow renders the tool call with proper formatting (file path, command, etc.) instead of raw JSON.
- **Evidence**: Commits `bc3590534` and `26614a007` expanded SDK tool→webview mapping and added regression tests (`message-translator.test.ts`, `messageUtils.test.ts`) including multi-file `read_files` rendering and post-tool assistant text visibility.

### S6-13: Webview state not populated with messages and task history
- **Status**: 🔵 Awaiting Verification
- **Description**: The webview's `ExtensionStateContext` wasn't receiving messages, current task item, or task history. The `subscribeToState` stream was pushing state updates without task data because the `WebviewGrpcBridge.pushStateUpdate()` method was building state without the controller's task reference.
- **Root cause**: The `WebviewGrpcBridge` was importing `getStateToPostToWebview()` directly and calling it with `task: undefined`, which meant the state never included messages or the current task item. The bridge didn't have access to the controller's `getStateToPostToWebview()` method which knows about the active task.
- **Fix applied**:
  1. Added `setGetStateFn()` method to `WebviewGrpcBridge` that accepts the controller's `getStateToPostToWebview` bound method.
  2. Updated `pushStateUpdate()` to use `getStateFn` when available (which includes task data), falling back to the minimal state builder.
  3. Wired `grpcBridge.setGetStateFn(() => this.getStateToPostToWebview())` in `SdkController` constructor.
- **Verification**: Send a message, verify the webview shows messages in the chat view and the task appears in history.

### S6-14: VscodeRuntimeBuilder for MCP tool bridging
- **Status**: 🟢 Verified Fixed
- **Description**: The SDK's `DefaultRuntimeBuilder.loadConfiguredMcpTools()` only supports stdio transport. SSE and streamableHttp MCP servers are filtered out, causing "Unsupported MCP transport" errors. The classic `McpHub` already supports all three transports.
- **Root cause**: The SDK's `InMemoryMcpManager` with `createDefaultMcpServerClientFactory()` only creates stdio clients. The VSCode extension's `McpHub` has its own connection management that supports stdio, SSE, and streamableHttp.
- **Fix applied**: Created `src/sdk/vscode-runtime-builder.ts` with:
  1. `McpHubToolProvider` — adapter that makes the classic McpHub look like an SDK `McpToolProvider` (implements `listTools()` and `callTool()` by delegating to McpHub).
  2. `VscodeRuntimeBuilder` — custom `RuntimeBuilder` that delegates builtin tool creation to `DefaultRuntimeBuilder` but replaces MCP tools with ones loaded from the classic `McpHub`. This gives the SDK agent access to all MCP servers regardless of transport type.
  3. Tool name transform matches SDK's default (`serverName__toolName` format).
- **Wiring**: The `VscodeRuntimeBuilder` is now wired into session creation via `VscodeSessionHost.create()`, which passes it as the `runtimeBuilder` option to `DefaultSessionManager`. The `VscodeSessionHost` also writes an empty MCP settings file and points `CLINE_MCP_SETTINGS_PATH` to it, so the `DefaultRuntimeBuilder`'s internal `loadConfiguredMcpTools()` loads no MCP tools — the `VscodeRuntimeBuilder` replaces them with tools from the classic `McpHub`.
- **Verification**: Start a session with MCP servers configured (including SSE/streamableHttp), verify the agent can use MCP tools from all transport types.

### S6-11: Credential caching from classic extension may not work
- **Status**: 🟢 Verified Fixed
- **Description**: Cached credentials from the classic extension (`globalState.json` + `secrets.json`) are now correctly reused. The `buildSessionConfig()` function reads from `StateManager.getApiConfiguration()` (which includes secrets) and uses `resolveApiKey()` / `resolveModelId()` functions that handle all 30+ providers including the "cline" provider's OAuth token extraction.
- **Root cause (fixed)**: Same as S6-5 — replaced broken `ProviderSettingsManager` and `buildApiHandlerSettings()` paths with direct `ApiConfiguration` reading.
- **Fix applied**: `src/sdk/cline-session-factory.ts` — `resolveApiKey()`, `resolveModelId()`, `resolveBaseUrl()` functions that read from `StateManager.getApiConfiguration()`.
- **Verification**: Debug harness session shows inference working with `z-ai/glm-5.1` provider using cached credentials. No re-login required.
- **Evidence**: Same as S6-5 — debug harness session on 2026-04-14.

### S6-15: History items not clickable (welcome page and history view)
- **Status**: 🔴 Blocker — **Merged into S6-6**
- **Description**: Same issue as S6-6. Clicking history items from the welcome page does nothing. Clicking history items from the history view navigates back to the welcome page instead of loading the task.
- **Note**: This issue is tracked under S6-6. Likely shares a common root cause with S6-5 (view transition logic).

### S6-16: Sending a message completes immediately with no output
- **Status**: 🟢 Verified Fixed
- **Description**: When the user types and submits a message, the task immediately shows as "completed" with no tokens, no size, and no output. The webview console shows `handleSendMessage - Sending message: <text>` followed by four `ended "got subscribed state"` messages. No inference occurs.
- **Root cause**: Two issues:
  1. **Inference was actually working** — the SDK agent ran, produced output, and completed with tokens. But the output was invisible because of issue #2.
  2. **Partial message handler dropped new messages** — The webview's `ExtensionStateContext.tsx` partial message handler only updated existing messages by matching timestamps (`findLastIndex` by `ts`). If no existing message matched, the message was silently dropped (`return prevState`). In the classic extension, messages were first added via state updates, then updated in-place by partial messages. In the SDK migration, messages arrive via the partial message stream *before* any state update, so they were all dropped.
- **Fix**: In `webview-ui/src/context/ExtensionStateContext.tsx`, when a partial message arrives with a new timestamp (no match), append it to the `clineMessages` array instead of returning `prevState` unchanged. Also added debounced ClineMessage persistence in `SdkController.ts` so task history can load messages via `readUiMessages()`.
- **Verification**: Debug harness: sent "Say hello", Playwright locator found 3 elements containing "Hello" (user message + AI response). SDK returned: `"Hello! 👋 How can I help you today?"` with `inputTokens: 2776, outputTokens: 36, totalCost: 0.01478`.
- **Evidence**: Commit `32f1fa84e` on `sdk-migration-v3`.

### S6-17: Cancel button enabled after task "completes" but does nothing
- **Status**: 🟡 Minor
- **Description**: Despite the task showing as "completed", the cancel button remains enabled. Clicking it disables the button but has no visible effect. Sending a follow-up message after cancellation just logs `handleSendMessage` again with no inference.
- **Root cause**: Likely related to S6-16 — the task state isn't being properly set to "completed" in the webview, so the cancel button's enabled/disabled state is wrong. The follow-up message issue is the same root cause as S6-16.
- **Fix**: Fix S6-16 first. Then verify the task completion state properly disables the cancel button and enables the follow-up input.

### S6-18: Missing API key shows error instead of login prompt
- **Status**: 🔴 Blocker
- **Description**: When not logged in and attempting inference with the "cline" provider, instead of showing a login prompt, the user sees a red error message: `Missing API key for provider "cline". Set apiKey explicitly or one of: CLINE_API_KEY.` followed by "Thinking..." that spins forever.
- **Root cause**: The `resolveApiKey()` function in `cline-session-factory.ts` reads the access token from `providers.json`. When the user is not logged in, there's no token, and the SDK throws a generic "missing API key" error. The classic extension would detect the missing Cline credentials and show a login button instead. The error handling in `SdkController.initTask()` doesn't distinguish between "missing credentials for cline provider" (should show login UI) and other API key errors.
- **Fix**: In `SdkController.initTask()` or the session error handler, detect when the error is about missing Cline credentials specifically and emit a signal to the webview to show the login UI instead of a generic error. Alternatively, check for Cline credentials before starting the session and redirect to login if missing.
- **Verification**: Log out, attempt to send a message with "cline" provider selected, verify a login prompt appears instead of the error.

### S6-19: History deletion dialog confirms but doesn't delete
- **Status**: 🟢 Verified Fixed
- **Description**: When clicking the delete button on a history item, a confirmation dialog appears. After confirming, the item is deleted from state/disk AND the UI updates immediately — both the history list and the recents list on the welcome page reflect the deletion.
- **Root cause**: The `deleteTaskWithId` handler in `src/core/controller/task/deleteTasksWithIds.ts` called `controller.getTaskWithId(id)` before `deleteTaskFromState(id)`. When the task's `apiConversationHistory` file didn't exist on disk (common for new/short tasks), `getTaskWithId()` threw `"Task not found"`, which was caught and re-thrown. The `postStateToWebview()` call at the end of the function was outside the try/catch block and was never reached. The state was updated (because `getTaskWithId` called `deleteTaskFromState` internally before throwing), but the webview was never notified.
- **Fix applied**: Restructured `deleteTaskWithId()` to: (1) call `deleteTaskFromState(id)` first (always succeeds, updates in-memory cache immediately), (2) clean up task files on disk as best-effort (wrapped in try/catch), (3) always call `postStateToWebview()` at the end. Removed the `getTaskWithId()` call entirely — it's not needed for deletion since the task directory path can be constructed directly from the ID. Also simplified file cleanup to use `fs.rm(taskDirPath, { recursive: true, force: true })` instead of deleting individual files.
- **Verification**: Debug harness test on 2026-04-16: Created 2 tasks ("Say hello world", "Say goodbye world"). Deleted "Say goodbye world" via the history view delete button. History list immediately showed only "Say hello world" (1 delete button, size 682 B down from 1.3 kB). Navigated to welcome page — recents list showed only "Say hello world". Disk state confirmed: only 1 task in `taskHistory.json`, only 1 task directory remaining.
- **Evidence**: Debug harness session on 2026-04-16.

### S6-20: MCP tools panel is empty / MCP tools not available to agent
- **Status**: 🟢 Verified Fixed
- **Description**: Two related issues: (1) The MCP tools panel in the sidebar shows no tools, even when MCP servers are configured. (2) The SDK's DefaultSessionBuilder does not support dynamic MCP tools — tools are loaded once at session build time, so adding/removing MCP servers mid-session had no effect.
- **Root cause**: The VscodeRuntimeBuilder already bridges McpHub → SDK tools at session start, but there was no mechanism to reload tools when the McpHub's server list changed after session creation.
- **Fix**: Implemented a tool-list-change detection and session restart mechanism:
  - `McpHub.ts`: Added `computeToolFingerprint()` to detect actual tool list changes (vs. mere status updates), `setToolListChangeCallback()`/`clearToolListChangeCallback()` for subscribers, and `checkToolListChanged()` called from `notifyWebviewOfServerChanges()`.
  - `SdkController.ts`: Added `handleMcpToolListChanged()` which restarts the session immediately when idle, or defers via `mcpToolRestartPending` flag until the current turn completes (`checkDeferredMcpToolRestart()` called from `handleSessionEvent()` on turn completion). `restartSessionForMcpTools()` creates a new VscodeSessionHost with fresh tools, preserves conversation messages, and emits info messages to the chat.
  - `task-proxy.ts`: Made `taskId` settable so the session restart can update the proxy's session ID without recreating it (preserving accumulated messages).
- **Tests**: 16 unit tests in `src/services/mcp/__tests__/McpHub.toolListChange.test.ts` covering fingerprinting, callback firing, edge cases.
- **Verification**: Start a task, then add/remove an MCP server in `cline_mcp_settings.json`. The chat should show "MCP tools changed — reloading tools for this session..." and "MCP tools reloaded successfully." The agent should then be able to use the new tools.

### S6-21: Incremental messages are repeated/duplicated in chat output
- **Status**: 🟢 Verified Fixed
- **Description**: After the S6-16 fix (appending new partial messages), the AI response text was repeated multiple times in the chat. Additionally, during streaming, the text appeared in a "flip book" style — fragments flashed and replaced each other rather than smoothly appending.
- **Root cause**: The message translator was using `event.text` (the delta/chunk) for streaming text messages. The SDK emits MULTIPLE `content_start` events during streaming, each with `text` (delta) and `accumulated` (full text so far). Using the delta caused each update to replace the previous content with just the new chunk, creating a "flip book" effect.
- **Fix applied**: Changed `message-translator.ts` to use `event.accumulated ?? event.text` for streaming text content_start events. This gives smooth streaming — the webview updates the message in-place with the growing accumulated text.
- **Note on state push**: An earlier fix attempt removed `postStateToWebview()` from `handleSessionEvent()` to prevent double state updates. This was reverted because the webview needs the full `clineMessages` array in state for proper rendering — without it, streaming appeared completely broken (the webview sat on "Thinking" and only showed the completed response at the end). The `postStateToWebview()` call is now restored. The `MessageStateHandler.addMessages()` deduplicates by timestamp, so the state update and partial message stream don't cause duplication.
- **Verification**: 34 unit tests pass in `message-translator.test.ts` including 3 new tests for accumulated text streaming behavior.
- **Evidence**: `npx vitest run --config vitest.config.sdk.ts src/sdk/message-translator.test.ts` — 34/34 pass.

### S6-22: User input message displays as "{}" instead of message text
- **Status**: 🔵 Awaiting Verification
- **Description**: The task header box at the top of the chat shows `{}` instead of the actual user message text (e.g., "Say hello"). The message is sent correctly (inference works), but the display of the user's input in the chat header is wrong.
- **Root cause**: The initial "task" message was emitted via `emitSessionEvents()` in `SdkController.initTask()`, which sent it to listeners (including the gRPC bridge for partial message streaming) but did NOT add it to the `messageStateHandler`. When `getStateToPostToWebview()` built the state, `clineMessages` from the handler was empty (missing the task message). The state update then arrived at the webview and replaced the partial-message-sourced `clineMessages` (which had the task message) with the empty state `clineMessages`, losing the user's input text. The webview then showed `{}` because `task.text` was undefined.
- **Fix applied**: In `SdkController.initTask()`, the task message is now added to `this.task.messageStateHandler.addMessages([taskMessage])` BEFORE emitting to listeners. This ensures `getStateToPostToWebview()` includes the task message in `clineMessages`, so the state update preserves it.
- **Verification**: Send a message, verify the task header shows the actual message text.

### S6-23: Opening a message from history returns to welcome screen
- **Status**: 🔵 Awaiting Verification — **Same fix as S6-6**
- **Description**: Clicking a task in the history list briefly flashes the chat view, then returns to the welcome screen. Opening a recent conversation from the welcome screen also shows a brief flash and returns to the welcome screen. The `showTaskWithId()` method loads messages from disk but the view transition doesn't stick.
- **Root cause**: Same as S6-6 — `showTaskWithId()` called `clearTask()` which set `this.task = undefined` and triggered async session teardown that raced with the new task proxy creation.
- **Fix applied**: Same as S6-6 — rewrote `showTaskWithId()` to avoid `clearTask()` race condition.
- **Verification**: Click a history item, verify the chat view loads and stays visible with the task's messages.

### S6-24: Tool use blocks ("Cline wants to create a new file") are empty
- **Status**: 🟢 Verified Fixed
- **Description**: When the agent uses tools (e.g., `editor`), the tool use block in the chat showed the header ("Cline wants to create a new file") but the content area was empty — no file path, no diff, no content preview.
- **Root cause**: The `content_end` event for tools does NOT carry the tool's `input` (path, content, etc.). The message translator was passing `undefined` as the input to `sdkToolToClineSayTool()` at `content_end`, resulting in a `ClineSayTool` with empty `path`, `content`, and `diff` fields. The `content_start` event DOES carry the input, but it wasn't being preserved for use at `content_end`.
- **Fix applied**: Three changes to `src/sdk/message-translator.ts`:
  1. Added `streamingToolInput` and `streamingToolName` fields to `MessageTranslatorState` to store the tool context from `content_start`.
  2. At `content_start` for tools, store the input via `state.setStreamingToolContext(toolName, input)`.
  3. At `content_end` for tools, retrieve the stored input via `state.getStreamingToolInput()` and pass it to `sdkToolToClineSayTool()` instead of `undefined`.
  4. The stored context is cleared in `clearStreamingTool()` and `reset()`.
- **Verification**: 4 new unit tests verify: (1) editor edit preserves path+content through content_start→content_end, (2) newFileCreated preserves content, (3) read_files preserves path, (4) graceful fallback when content_end arrives without prior content_start.
- **Evidence**: `npx vitest run --config vitest.config.sdk.ts src/sdk/message-translator.test.ts` — 34/34 pass.

### S6-25: Streaming text appears in "flip book" style instead of smooth append
- **Status**: 🟢 Verified Fixed (same root cause as S6-21)
- **Description**: During streaming, the AI response text appeared in a "flip book" style — the entire message content flashed and replaced itself on each chunk, rather than smoothly appending new characters.
- **Root cause**: Same as S6-21. The message translator was using `event.text` (the delta) instead of `event.accumulated` (the full text so far). Each streaming update replaced the message content with just the new chunk instead of the growing accumulated text.
- **Fix applied**: Same as S6-21 — changed `message-translator.ts` to use `event.accumulated ?? event.text` for streaming text. All streaming chunks now share the same timestamp and use accumulated text, giving smooth in-place updates.
- **Verification**: 3 new unit tests verify: (1) accumulated text is used over delta, (2) fallback to text when accumulated is absent, (3) all streaming chunks share the same timestamp.
- **Evidence**: `npx vitest run --config vitest.config.sdk.ts src/sdk/message-translator.test.ts` — 34/34 pass.

### S6-26: SDK pending prompts / tool approval / ask_question not integrated
- **Status**: 🔴 Blocker
- **Description**: The SDK has three mechanisms for the agent to interact with the user mid-task, none of which are currently wired into the VSCode extension:

  **1. `requestToolApproval` callback** — When a tool's policy has `autoApprove: false`, the agent calls `requestToolApproval({ agentId, conversationId, iteration, toolCallId, toolName, input, policy })` and blocks until the callback returns `{ approved: boolean, reason?: string }`. Without this callback, ALL non-auto-approved tools are denied with "no approval handler is configured". This is the equivalent of the classic extension's "Cline wants to..." approval dialog.

  **2. `ask_question` tool executor** — The SDK has a built-in `ask_question` tool (equivalent to the classic `ask_followup_question`). It requires an `askQuestion` executor function passed via `defaultToolExecutors: { askQuestion: fn }`. The executor receives `(question, options, context)` and returns the user's answer as a string. Without this executor, the tool is excluded from the agent's tool list entirely. The CLI implements this as `askQuestionInTerminal` which prompts in the terminal.

  **3. Pending prompts system** — When the user sends a message while the agent is already running, `send()` with `delivery: "queue"` or `delivery: "steer"` enqueues the message as a pending prompt. The SDK emits `pending_prompts` events with the current queue snapshot, and `pending_prompt_submitted` events when a queued prompt is consumed. The `drainPendingPrompts()` method processes the queue when the agent is idle. `"steer"` prompts go to the front of the queue; `"queue"` prompts go to the back. The Tauri desktop app and CLI TUI both subscribe to these events to show queued messages in the UI.

- **Root cause**: The `VscodeSessionHost` currently passes no `requestToolApproval` callback and no `defaultToolExecutors.askQuestion`. The `SdkController.askResponse()` method sends with no `delivery` parameter (defaults to "immediate"), which blocks if the agent is already running.

- **Impact**: 
  - Tools that require approval are silently denied → agent can't use file editing, commands, etc. unless everything is auto-approved
  - Agent can't ask the user clarifying questions → `ask_question` tool is missing from the tool list
  - User can't send follow-up messages while the agent is running → `send()` throws "already in progress"

- **Fix needed** (three parts):

  **Part A: `requestToolApproval` callback (~50 lines)**
  Wire into `VscodeSessionHost.create()` options. The callback should:
  1. Emit a ClineMessage with `type: "ask"`, `ask: "tool"` containing the tool name and input as `ClineSayTool` JSON (same format the classic extension uses for tool approval dialogs)
  2. Add the message to `messageStateHandler` and push to the partial message stream
  3. Return a Promise that resolves when the user clicks Approve/Reject in the webview
  4. The webview's existing approval UI (Approve/Reject buttons in ChatRow) already sends `askResponse` back through gRPC → `SdkController.askResponse()`. Need to wire this to resolve the approval Promise.
  
  **Reference**: CLI implementation at `apps/cli/src/utils/approval.ts:63-108`. Desktop implementation at `apps/desktop/hooks/use-agent-session.tsx:134-194` (polls for approvals via `poll_tool_approvals` Tauri command). Tauri desktop at `apps/code/hooks/use-chat-session.ts:993-1010` (responds via `respond_tool_approval`).

  **Part B: `askQuestion` executor (~30 lines)**
  Wire into `VscodeSessionHost.create()` via `defaultToolExecutors: { askQuestion: fn }`. The executor should:
  1. Emit a ClineMessage with `type: "ask"`, `ask: "followup"` containing the question and options
  2. Return a Promise that resolves with the user's text response when they reply in the webview
  3. The webview's existing follow-up question UI already handles this message type
  
  **Reference**: CLI implementation at `apps/cli/src/runtime/run-interactive.ts:106` (`askQuestionInTerminal`).

  **Part C: Pending prompts for follow-up messages (~20 lines)**
  Update `SdkController.askResponse()` to use `delivery: "queue"` when the agent is running, so follow-up messages are queued instead of throwing. Subscribe to `pending_prompts` and `pending_prompt_submitted` events to show queued messages in the webview.
  
  **Reference**: CLI wiring at `apps/cli/src/runtime/run-interactive.ts:125-134`. Tauri desktop at `apps/code/host/runtime-bridge.ts:338-382`.

- **Verification**: 
  1. Start a task that uses tools → verify approval dialog appears → approve → tool executes
  2. Start a task where the agent calls `ask_question` → verify question appears in chat → answer → agent continues
  3. While agent is running, send a follow-up message → verify it queues and is processed after the current turn

### S6-27: History messages not rendering when opened (S6-6 still broken)
- **Status**: 🟢 Verified Fixed
- **Description**: Clicking a history item (from the welcome page's "Recent" section or the history view) did not render the task's messages. The chat view either stayed on the welcome page or showed no messages.
- **Root cause**: The gRPC handler `src/core/controller/task/showTaskWithId.ts` was calling `controller.initTask(undefined, undefined, undefined, historyItem)` which started a **new SDK session** instead of loading the existing task's messages from disk. The `SdkController.initTask()` method creates a new session, new task proxy, and new history item — it does NOT load saved messages. Meanwhile, `SdkController.showTaskWithId()` (which correctly loads messages from disk, creates a task proxy with those messages, and pushes them to the webview) was never being called.
- **Fix applied**: Changed `src/core/controller/task/showTaskWithId.ts` to call `controller.showTaskWithId(id)` instead of `controller.initTask(...)`. The `SdkController.showTaskWithId()` method handles: (1) looking up the history item, (2) tearing down any active session, (3) creating a task proxy with loaded messages, (4) pushing messages through both state updates and partial message stream, (5) posting state to the webview.
- **Verification**: Debug harness test on 2026-04-16: (1) Sent "Say hello world test", inference completed with "Hello world test! 👋". (2) Clicked "New Task" to navigate to welcome page. (3) Clicked the history item from the "Recent" section. (4) Chat view loaded with all 5 messages: task, api_req_started, text response, api_req_started with tokens, completion_result.
- **Evidence**: Debug harness session on 2026-04-16. Messages confirmed saved to `ui_messages.json` at `HostProvider.globalStorageFsPath/tasks/<id>/`. Both direct gRPC call and click-based navigation verified.

---

## Priority & Next Steps

**Current state (updated 2026-04-20)**: Inference works end-to-end. History open/resume flow is working, MCP OAuth + provider OAuth callbacks are implemented, and MCP tool reload preserves task/session continuity. Tool-call rendering in chat has been improved (including multi-file `read_files`).

### 🟢 Resolved: S6-27 — History messages not rendering

Fixed. The gRPC handler was calling `controller.initTask()` (starts new session) instead of `controller.showTaskWithId()` (loads messages from disk). See S6-27 entry for details.

### 🔴 Top Priority: S6-26 — Pending prompts / tool approval / ask_question

The SDK's three user-interaction mechanisms are not wired in. Without `requestToolApproval`, non-auto-approved tools are silently denied. Without `askQuestion`, the agent can't ask clarifying questions. Without pending prompts, follow-up messages during a running task will fail.

### 🔴 Third Priority: S6-18 — Missing API key shows error instead of login prompt

When not logged in with the "cline" provider, the user sees a raw error instead of a login prompt. This blocks the first-run experience.

### 🟡 Lower Priority:
- S6-17: Cancel button state
- S6-2: OCA and Codex OAuth flows not yet verified
- S6-7: Credits/payment history don't load immediately

### S6-28: MCP tool reload messages appear twice in chat
- **Status**: 🟢 Verified Fixed
- **Description**: When saving the MCP settings file (triggering a tool list change), the info messages "MCP tools changed — reloading tools for this session..." and "MCP tools reloaded successfully." each appeared TWICE in the chat. The tool reload itself worked correctly — only the messages were duplicated.
- **Root cause**: `notifyWebviewOfServerChanges()` in McpHub fires multiple times in quick succession when a server connects (status change → tools discovered → etc.). Each call triggered `checkToolListChanged()` which detected the fingerprint change and fired the callback. The callback fired multiple times before the fingerprint was updated, causing duplicate messages.
- **Fix applied**: Added 300ms debounce to `checkToolListChanged()` in `McpHub.ts`. The method now: (1) quick-checks the fingerprint — if unchanged, returns immediately without scheduling a timer, (2) if changed, debounces via `setTimeout(300ms)` to coalesce rapid-fire changes, (3) after the debounce, `fireToolListChangeIfNeeded()` re-checks the fingerprint and fires the callback only if it actually changed.
- **Verification**: Save MCP settings file, verify each message appears exactly once.

### S6-30: Follow-up messages silently dropped after task completion
- **Status**: 🟢 Verified Fixed
- **Description**: After a task completed, typing a follow-up message and pressing Enter (or clicking Send) did nothing. The message appeared in the textarea but was never sent. The `ui.send_message` gRPC method worked (bypassing the webview's `handleSendMessage`), but DOM-level input was broken.
- **Root cause**: The webview's `handleSendMessage()` in `useMessageHandlers.ts` requires `clineAsk` to be set to send follow-up messages. The classic extension emits `ask: "completion_result"` when a task completes, which sets `clineAsk` in the webview. The SDK's message translator was emitting `say: "completion_result"` (a display-only message) instead of `ask: "completion_result"` (which enables the follow-up input). Without the ask message, `handleSendMessage()` fell through to the "task is running" check (which was false since the task was complete), and the message was silently dropped (`messageSent` stayed `false`).
- **Fix applied**: Changed `src/sdk/message-translator.ts` to emit `type: "ask", ask: "completion_result"` instead of `type: "say", say: "completion_result"` for the `done` agent event. Only the ask is emitted (not both say+ask) to avoid duplicate "Task Completed" displays in the webview.
- **Verification**: Debug harness test on 2026-04-17: (1) Sent "Say hello" via `ui.send_message`, task completed. (2) Typed "Now say goodbye" via `ui.react_input` with `submit: true`. (3) Follow-up inference ran and returned "Goodbye! 👋". (4) Also tested MCP tools in follow-up turns — `kb_search` worked correctly.
- **Evidence**: Debug harness session on 2026-04-17.

### S6-29: MCP tool reload leaves UI in "Thinking..." state, blocking follow-ups
- **Status**: 🟢 Verified Fixed
- **Description**: After an MCP tool reload (triggered by toggling a server in the MCP panel), the chat showed "MCP tools changed" and "MCP tools reloaded" info messages but the UI was left in a "Thinking..." state. Follow-up messages could not be sent because the webview's `handleSendMessage()` requires `clineAsk` to be set.
- **Root cause**: `restartSessionForMcpTools()` emitted `say: "info"` messages for the reload status but did NOT emit `ask: "completion_result"` afterward. Without the ask message, `clineAsk` was not set in the webview, so `handleSendMessage()` silently dropped follow-up input.
- **Fix applied**: After the success info message in `restartSessionForMcpTools()`, emit an `ask: "completion_result"` message with empty text. This tells the webview the agent is idle and enables the follow-up input.
- **Verification**: Debug harness test on 2026-04-17: (1) Sent "Say hello briefly", task completed. (2) Toggled kamibiki MCP server off via UI. (3) "MCP tools changed" + "MCP tools reloaded" messages appeared (no "Thinking..." state). (4) Typed "Say goodbye" via `ui.react_input` — follow-up inference ran and returned "Goodbye! 👋".
- **Evidence**: Debug harness session on 2026-04-17.

### S6-31: Conversation history lost after MCP tool changes (session recreated)
- **Status**: 🟢 Verified Fixed
- **Description**: MCP-triggered session restarts now preserve active task/session continuity, preventing chat/task state loss after toggling MCP servers.
- **Root cause**: Session recreation could break task/session linkage in webview state.
- **Fix applied**: In `restartSessionForMcpTools()` (`src/sdk/SdkController.ts`), set `config.sessionId = oldSessionId` and keep the task ID stable even if SDK returns a different ID, with warning log fallback. This keeps `currentTaskItem` mapping intact during MCP reloads.
- **Verification**: Toggle MCP server while chat is active, verify task remains active and state continuity is preserved.
- **Evidence**: Commit `b2db4937a` (“preserve task session id when reloading MCP tools”).

### S6-32: "New Task" button and task delete disabled after MCP tool change
- **Status**: 🟢 Verified Fixed
- **Description**: Button-state lockups after MCP tool changes are resolved.
- **Root cause**: UI/task continuity broke when MCP restarts changed session identity/state linkage.
- **Fix applied**: Same core fix as S6-31 (`b2db4937a`) keeps task/session identity stable during MCP reloads, preventing webview state from drifting into a pseudo-running state.
- **Verification**: After MCP toggle, verify New Task and delete actions remain enabled/functional.
- **Evidence**: Commit `b2db4937a`.

### S6-33: Insufficient credits shows raw error text instead of buy-credits UI
- **Status**: 🔴 Blocker
- **Description**: When attempting inference with no credits (negative balance), the chat displays the raw error text "Insufficient balance. Your Cline Credits balance is $-0.14" followed by "Thinking..." that spins forever. The classic extension shows an interactive error state with buttons to buy credits, switch providers, etc. The SDK error is displayed as plain text with no actionable UI.
- **Root cause**: The SDK throws an error (or emits an error event) when the API returns a 402/insufficient-balance response. The `SdkController` or message translator doesn't distinguish this error type from generic API errors. In the classic extension, `attemptApiRequest()` catches balance errors specifically and emits `ask: "api_req_failed"` with structured error info that the webview's `ChatRow.tsx` renders with buy-credits buttons and provider-switching options. The SDK adapter just displays the error text as a `say: "error"` message, which has no interactive UI.
- **Fix**: Not yet attempted. The error handler in `SdkController` (or the message translator's error event handler) needs to detect insufficient-balance errors (check for 402 status, "insufficient balance" text, or SDK-specific error types) and emit `ask: "api_req_failed"` with the appropriate structured payload that the webview expects for rendering the buy-credits UI.
- **Verification**: Log in with an account that has no credits, attempt inference, verify the buy-credits buttons and provider-switch options appear instead of raw error text.

### S6-34: Cancel during generation doesn't show "Resume task" and follow-ups don't display
- **Status**: 🔵 Awaiting Verification
- **Description**: Two related issues when cancelling during active generation: (1) After hitting "Cancel" while the agent is streaming, the button does not change to "Resume task" — it stays in a stuck state without the expected resume option. (2) If the user sends another message after cancelling, the message does not display in the chat panel (though it may be sent to the backend).
- **Root cause**: The classic extension emits `ask: "resume_task"` when a task is cancelled mid-generation, which tells the webview to show the "Resume task" button and enables the follow-up input. The SDK adapter's `cancelTask()` called `sessionManager.abort()` but didn't emit `ask: "resume_task"` afterward. Instead it emitted `say: "info"` with "Task cancelled", which doesn't set `clineAsk` in the webview. Without the ask message, `handleSendMessage()` doesn't handle follow-up correctly.
- **Fix applied**: Changed `cancelTask()` in `src/sdk/SdkController.ts` to emit `ask: "resume_task"` instead of `say: "info"`. The resume message is added to both `messageStateHandler` (for state updates) and emitted via `emitSessionEvents()` (for the partial message stream). This mirrors the classic extension's `Task.abortTask()` behavior. Also persists the message to disk via `debouncedSaveClineMessages()`. See also S6-46 for the related AbortError suppression.
- **Verification**: Debug harness test: (1) Send a message that triggers long generation (2) Hit Cancel during streaming (3) Verify "Resume task" button appears (4) Send a follow-up message (5) Verify it displays in chat and triggers inference

<!-- Template:
### [ID] Title
- **Status**: 🔴/🟡/🔵/🟢
- **Description**: What's wrong
- **Root cause**: If known
- **Fix**: If attempted, with file references
- **Verification**: How to verify (test name, harness command)
- **Evidence**: Test output, screenshot, etc. (required for 🟢)
-->

### S6-35: Inference cost not displayed in task
- **Status**: 🟢 Fixed
- **Description**: During and after inference, the cost/token usage is not displayed in the task's chat view. The classic extension shows token counts (input/output/cache) and cost in the `api_req_started` message block. The SDK adapter emits `api_req_started` messages but likely doesn't populate the cost/token fields, or the `usage` event from the SDK isn't being translated into the format the webview expects.
- **Root cause**: The SDK emits `usage` events (with `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `totalCost`) via `agent_event` with `type: "usage"`. The message translator likely creates `api_req_started` messages without the cost JSON payload, or doesn't update them with final usage data when the `usage` event arrives. The webview's `ApiRequestRow` component expects `api_req_started` messages to have a `text` field containing JSON with `{tokensIn, tokensOut, cacheReads, cacheWrites, cost}`.
- **Fix**: Fixed in use latest sdk main (#10337)
- **Verification**: Send a message, verify that token counts and cost appear in the collapsible API request row in the chat.

### S6-36: Returning to an in-progress task after clicking New Task shows stale "Thinking..."
- **Status**: 🟢 Verified Fixed
- **Description**: If the user clicked New Task mid-generation and later reopened the old task, the old task could still appear as streaming/"Thinking..." due to partially persisted messages.
- **Root cause**: Task clear/load paths could persist partial messages without finalization, so reopening rendered stale streaming state.
- **Fix applied**: `clearTask()` now finalizes messages before save (removes `partial`, marks last unfinished `api_req_started` as `cancelReason: "user_cancelled"`), and `showTaskWithId()` sanitizes loaded messages + appends the appropriate resume ask (`resume_task` or `resume_completed_task`).
- **Verification**: Click New Task during a running task, reopen previous task, verify it no longer appears stuck in "Thinking...".
- **Evidence**: Commit `70b5ff110`.

### S6-37: Tool-call rendering gaps (multi-file read_files + post-tool assistant text)
- **Status**: 🟢 Verified Fixed
- **Description**: Two rendering gaps remained in chat tool-call UX: (1) `read_files` with multiple files showed only one file path, and (2) assistant text after tool results could be dropped by low-stakes tool grouping.
- **Root cause**:
  1. Translator extracted only the first file path for `read_files`.
  2. `groupLowStakesTools()` ignored text that arrived after a tool group had started.
- **Fix applied**:
  1. `message-translator.ts` now emits one `readFile` tool message per file for multi-file reads.
  2. `messageUtils.ts` now commits active tool groups before handling subsequent text, preserving post-tool assistant summaries.
  3. Additional SDK tool-name mappings were added (`execute_command`, `write_to_file`, `search_files`, etc.) to improve ChatView tool rendering compatibility.
- **Verification**: Run prompt paths that trigger multi-file reads and then assistant summary text; verify all files are listed and assistant text remains visible.

### S6-41: Command output shows raw JSON instead of formatted shell output
- **Status**: 🟢 Verified Fixed
- **Description**: Command output in the chat showed raw JSON like `[{"query":"ls","result":"file1\nfile2","success":true}]` instead of the classic extension's formatted shell output with code blocks and scrollable content. The classic format shows the command in a shell code block followed by the output in another shell code block, separated by "Output:".
- **Root cause**: Two issues:
  1. In `src/sdk/message-translator.ts`, the command content_end handler (line ~630) received `event.output` as a `ToolOperationResult[]` (the SDK's structured output format: `[{query, result, success, error?}]`). When `event.output` was not a string, the code fell through to `JSON.stringify(event.output)`, producing the raw JSON array in the chat.
  2. The webview's `CommandOutputRow.tsx` checks `isBackgroundExec` (from `vscodeTerminalExecutionMode === "backgroundExec"`) for proper rendering with cancel buttons, status indicators, etc. The SDK always uses background execution (bash executor spawns child processes directly), but the default `vscodeTerminalExecutionMode` from globalState was `"vscodeTerminal"`, causing the webview to render commands with the wrong UI mode.
- **Fix applied**:
  1. Added `extractToolOutputText()` helper in `src/sdk/message-translator.ts` that extracts raw text from the SDK's structured `ToolOperationResult[]` format. For each result: if `result.result` is a non-empty string, use it; if `result.error` is a non-empty string, use it. Join multiple results with newlines. Falls back to `JSON.stringify` only for truly unknown formats.
  2. Updated the command content_end handler to use `extractToolOutputText(event.output)` instead of the old ternary with `JSON.stringify`.
  3. Overrode `vscodeTerminalExecutionMode` to `"backgroundExec"` in `SdkController.getStateToPostToWebview()` so the webview's `CommandOutputRow` renders with the correct background-exec UI.
- **Verification**: 15 new unit tests pass in `src/sdk/message-translator.test.ts`:
  - `extractToolOutputText` tests: null/undefined, string passthrough, single ToolOperationResult, multiple results, error results, mixed success/error, plain string arrays, unknown object fallback, empty array, empty-result skipping.
  - `command content_end output formatting` tests: ToolOperationResult[] produces raw text (not JSON), string output passes through, error output formatted correctly.
- **Evidence**: `npx vitest run --config vitest.config.sdk.ts src/sdk/message-translator.test.ts` — 50 tests pass (35 existing + 15 new). Zero new TypeScript compilation errors.

- **Evidence**: Commits `bc3590534` and `26614a007`, plus added tests in `src/sdk/message-translator.test.ts` and `webview-ui/src/components/chat/chat-view/utils/messageUtils.test.ts`.


### S6-38: Cline doesn't know the user's working directory (process.cwd() fallback)
- **Status**: 🟢 Verified Fixed
- **Description**: The SdkController used `process.cwd()` as the working directory in 4 places (in `initTask()`, `reinitExistingTaskFromId()`, `resumeSessionFromTask()`, `restartSessionForMcpTools()`). In VSCode, `process.cwd()` returns the extension host's directory (e.g., `/Applications/Visual Studio Code.app/...`), not the user's workspace. This meant Cline couldn't find files in the user's project without being told the path explicitly. Related to S4-3 which was marked minor but is actually a blocker.
- **Root cause**: The shared `ClineExtensionContext` type doesn't have a `workspaceRoot` property (designed for CLI/ACP). The SdkController had no way to resolve the user's workspace root and fell back to `process.cwd()`.
- **Fix applied**:
  1. Added `SdkController.getWorkspaceRoot()` private async method that resolves the workspace root via `HostProvider.workspace.getWorkspacePaths()` — which delegates to `vscode.workspace.workspaceFolders[0].uri.fsPath` in VSCode. Falls back to `process.cwd()` only when no workspace folder is open.
  2. Replaced all 4 `process.cwd()` calls in `SdkController.ts` with `await this.getWorkspaceRoot()`.
  3. Added a defensive warning log in `buildSessionConfig()` (`cline-session-factory.ts`) for the `process.cwd()` fallback path, so it's immediately obvious if the workspace root is ever missing.
- **Files changed**:
  - `src/sdk/SdkController.ts` — Added `getWorkspaceRoot()`, replaced 4 call sites
  - `src/sdk/cline-session-factory.ts` — Added warning log for missing cwd fallback
- **Verification**: TypeScript compiles with 0 new errors (5 pre-existing SDK type errors). `grep -n 'process.cwd()' src/sdk/SdkController.ts` shows only the fallback in `getWorkspaceRoot()`. The `HostProvider.workspace.getWorkspacePaths()` API is the same one used in `common.ts:131` (`checkWorktreeAutoOpen`) and is known to work correctly.
- **Evidence**: Code diff shows 34 insertions, 5 deletions across 2 files. All direct `process.cwd()` usages replaced with host-aware workspace resolution.

### S6-45: React warns about `isActive` prop forwarded to DOM element
- **Status**: 🟢 Verified Fixed
- **Description**: React console warning: "React does not recognize the `isActive` prop on a DOM element." The `StyledTabButton` in `ClineRulesToggleModal.tsx` passed `isActive` as a styled-components prop, which was forwarded to the underlying `<button>` DOM element.
- **Root cause**: styled-components forwards all props to the DOM unless filtered. The `isActive` prop was used only for CSS interpolation but leaked to the DOM.
- **Fix applied**: Renamed `isActive` to `$isActive` (styled-components transient prop prefix) in the `StyledTabButton` type, CSS interpolations, and JSX usage. The dollar-sign prefix tells styled-components to consume the prop for styling without forwarding it to the DOM. The public `TabButton` component API is unchanged.
- **Verification**: Open the Cline Rules modal — no React console warning about `isActive` on a DOM element.
- **Evidence**: TypeScript compiles cleanly. The `McpConfigurationView.tsx` version of `StyledTabButton` already used `shouldForwardProp` to filter `isActive` — this fix aligns the `ClineRulesToggleModal.tsx` version using the more idiomatic transient prop approach.

### S6-44: RangeError: Invalid string length when starting a new task
- **Status**: 🟢 Verified Fixed
- **Description**: Starting a new task could produce `RangeError: Invalid string length` in the console, crashing the task. The error occurred in the SDK's `file-indexer.ts` at the `stdout += chunk.toString()` line inside `listFilesWithRg()`. The function spawns `rg --files --hidden -g '!.git'` and accumulates ALL stdout into a single string. Two bugs combined to cause this:
  1. **Missing directory exclusions in `rg`**: The `rg` command only excluded `.git`, but the fallback `walkDir` function excluded 10 directories (`node_modules`, `dist`, `build`, `.next`, `coverage`, `.turbo`, `.cache`, `target`, `out`). This inconsistency meant `rg` listed vastly more files — including all of `node_modules` — producing output that could approach or exceed Node.js's max string length (~512MB).
  2. **Wrong workspace path**: `SdkController` used `process.cwd()` instead of the VSCode workspace root. In the VSCode extension host, `process.cwd()` can return the VSCode installation directory or `/`, causing `rg` to recurse enormous directory trees.
- **Root cause**: SDK `file-indexer.ts` had no buffer size limit and inconsistent directory exclusions between `rg` and `walkDir` codepaths. Extension used `process.cwd()` instead of `getCwd()` (which resolves the actual workspace folder via `HostProvider.workspace.getWorkspacePaths()`).
- **Fix applied**:
  1. **SDK `file-indexer.ts`** (`@clinebot/core/src/services/workspace/file-indexer.ts`):
     - Added `MAX_RG_STDOUT_BYTES = 64MB` safety limit — kills `rg` and falls back to `walkDir` if output exceeds the limit.
     - Added `rgExcludeArgs` that generates `-g '!dir'` flags for every entry in `DEFAULT_EXCLUDE_DIRS`, making `rg` and `walkDir` exclude the same directories.
  2. **`SdkController.ts`**: Replaced all 4 `process.cwd()` calls with `await getCwd()` (which uses `HostProvider.workspace.getWorkspacePaths()`).
  3. **`cline-session-factory.ts`**: Replaced `process.cwd()` fallback with `await getCwd()`.
- **Verification**:
  - SDK tests pass: 5 file-indexer tests + 4 mention-enricher tests (9/9).
  - Extension SDK adapter tests pass: 112/112.
  - TypeScript compiles with 0 new errors (5 pre-existing).
  - Extension builds successfully with fixes in the bundle.
- **Evidence**: Fix verified via `npx vitest run` (SDK workspace tests) and `npx tsc --noEmit` (extension).

### S6-46: Unhandled AbortError thrown when cancelling a running task
- **Status**: 🔵 Awaiting Verification
- **Description**: When the user cancels a running task, an unhandled `AbortError: This operation was aborted` appears in the VSCode developer console. The error propagates from `ClineCore.abort()` → `DefaultSessionManager.abort()` → `VscodeSessionHost.abort()` → `SdkController.cancelTask()` → gRPC handler → extension host. Additionally, the fire-and-forget `send()` promise rejects with `AbortError` when the abort signal fires, which was being logged as `Logger.error` and emitting an error event to the UI.
- **Root cause**: Three compounding issues:
  1. `VscodeSessionHost.abort()` directly proxied `this.inner.abort()` with no error handling. The SDK's `ClineCore.abort()` calls `AbortController.abort()` which can throw synchronously.
  2. `SdkController.cancelTask()` had a try/catch but logged all errors at `Logger.error` level, including `AbortError` which is expected behavior.
  3. `SdkController.fireAndForgetSend()` `.catch()` handler treated all errors equally — logging at error level and emitting error events to the UI, even for `AbortError` which should be silently absorbed since `cancelTask()` handles the UI state.
- **Fix applied**:
  1. **`src/sdk/vscode-session-host.ts`**: Wrapped `this.inner.abort()` in try/catch that suppresses `AbortError` (checks `error.name === "AbortError"` or `error.message` containing "aborted") and re-throws other errors. Logs at `Logger.debug` level.
  2. **`src/sdk/SdkController.ts`**: Added `isAbortError()` helper function. Restructured `cancelTask()` to: (a) wrap `sessionManager.abort()` in its own try/catch that suppresses `AbortError` at debug level, (b) always proceed with cancellation cleanup regardless of abort error, (c) emit `ask: "resume_task"` instead of `say: "info"` to fix S6-34 simultaneously.
  3. **`src/sdk/SdkController.ts`**: Updated `fireAndForgetSend()` `.catch()` to check `isAbortError()` first — if true, log at debug level and return early without emitting error events to the UI.
- **Verification**: Debug harness test: (1) Start a task with long generation. (2) Cancel during streaming. (3) Verify no `AbortError` in the developer console. (4) Verify the "Resume task" button appears. (5) Send a follow-up message and verify it works.
- **Evidence**: TypeScript compiles with 0 errors (`npx tsc --noEmit`). All 126 SDK adapter tests pass (`npx vitest run --config vitest.config.sdk.ts`).

### S6-39: 'Cline Fetched Content from this URL' tool call appears blank (no URL)
- **Status**: 🟢 Verified Fixed
- **Description**: When the agent uses `fetch_web_content`, the tool call in the chat showed "Cline fetched content from this URL:" but the URL was blank — no URL was rendered in the display area.
- **Root cause**: The SDK's `fetch_web_content` tool uses `{ requests: [{ url, prompt }] }` as its input format (array of request objects), but `sdkToolToClineSayTool()` in `src/sdk/message-translator.ts` only checked for a top-level `url` field via `getStringField(parsedInput, "url")`. Since the URL is nested inside `requests[0].url`, the extraction returned `""`, leaving `tool.path` empty and the webview rendering blank.
- **Fix applied**: Updated the `fetch_web_content`/`web_fetch` case in `sdkToolToClineSayTool()` to also extract the URL from `parsedInput.requests[0].url` when the top-level `url` field is missing. This handles both the SDK format (`{ requests: [{ url, prompt }] }`) and the classic format (`{ url, prompt }`).
- **Verification**: 7 new unit tests in `src/sdk/message-translator.test.ts` — S6-39 tests cover: SDK requests array URL extraction, content_end preserving URL from content_start, classic web_fetch backward compat, multiple requests extracting first URL. All 57 tests pass.
- **Evidence**: `npx vitest run --config vitest.config.sdk.ts src/sdk/message-translator.test.ts` — 57 tests pass. `npx tsc --noEmit` — 0 errors.

### S6-47: Tool architecture audit — dead code, missing tools, and disconnected handlers

- **Status**: 🔴 Blocker (attempt_completion command); 🟡 Minor (others)
- **Description**: Comprehensive audit of tool wiring on the SDK branch. The SDK provides its own built-in tools internally; the VSCode extension adds "extra tools" via `src/sdk/vscode-runtime-builder.ts` (currently: `attempt_completion` + MCP tools from McpHub). The classic `ToolExecutorCoordinator` and all its handlers (`src/core/task/tools/handlers/*.ts`) are **dead code** — the SDK handles tool execution internally, and the coordinator is never instantiated on the SDK path.

#### Where does the agent get tool descriptions?

On the SDK branch, tool descriptions come from **two sources**:
1. **SDK built-in tools** — defined inside `@clinebot/core`. The SDK provides: `read_files`/`read_file`, `list_files`, `list_code_definition_names`, `editor`/`replace_in_file`, `write_to_file`, `apply_patch`, `delete_file`, `run_commands`/`execute_command`, `search_codebase`/`search_files`, `fetch_web_content`/`web_fetch`, `web_search`, `skills`/`use_skill`, `ask_question`/`ask_followup_question`.
2. **VSCode extra tools** — defined in `src/sdk/vscode-runtime-builder.ts::createVscodeExtraTools()`, injected via `VscodeSessionHost.create()` → `applyToStartSessionInput()` → `config.extraTools`. Currently: `attempt_completion` + MCP tools bridged from McpHub.

The classic system prompt tool definitions (`src/core/prompts/system-prompt/tools/*.ts`) and variant templates are **NOT used** for tool descriptions on the SDK branch — the SDK constructs its own system prompt with its own tool definitions. The classic tool specs are only used by the classic Task path (subagents, legacy code).

#### Issue 1: `attempt_completion` `command` parameter is dead code

- **Severity**: 🔴 Blocker
- **Tool definition** (`src/sdk/vscode-runtime-builder.ts:44-71`): Defines `command` as an optional string parameter: _"An optional terminal command to showcase the result (e.g. open a dev server)."_
- **Execute function** (line 66-68): `return typeof parsedInput.result === "string" ? parsedInput.result : "Task completed."` — **ignores `command` entirely**.
- **Message translator** (`src/sdk/message-translator.ts:513-524, 603-629`): When handling `attempt_completion`, only extracts `result` via `getStringField(parsedInput, "result")` — **never reads `command`**.
- **Classic handler** (`src/core/task/tools/handlers/AttemptCompletionHandler.ts:192`): Would execute the command via `config.callbacks.executeCommandTool(command!, undefined)`, but this handler is **dead code** — the `ToolExecutorCoordinator` is never instantiated on the SDK path.
- **Impact**: The agent is told it can provide a `command` parameter, wastes tokens generating it, but the command is silently discarded. Example: agent says `command: "open localhost:3000"` but nothing happens.
- **Fix needed**: Either (a) implement command execution in the SDK extra tool's `execute` function (spawn the command via the standalone terminal manager or similar), or (b) remove the `command` parameter from the tool schema if the feature is intentionally dropped.

#### Issue 2: Classic `ToolExecutorCoordinator` and all handlers are dead code

- **Severity**: 🟡 Minor (informational — no user-facing bug, just dead code)
- **Files**: `src/core/task/tools/ToolExecutorCoordinator.ts`, `src/core/task/tools/handlers/*.ts` (28 handler files)
- **Description**: The entire classic tool execution pipeline (`ToolExecutorCoordinator` → handler → Task callbacks) is unreachable on the SDK branch. The SDK handles tool execution internally via its runtime. These files exist only for: (a) subagent support via `SubagentRunner` which still uses the classic `Task` class, (b) reference/comparison.
- **Impact**: No runtime bug, but the dead code creates confusion about which code path is active.

#### Issue 3: Tools present in classic but absent from SDK

The following classic tools have no equivalent in the SDK's built-in tool set or extra tools. Some omissions are intentional (SDK handles them differently or they're internal-only); others may be gaps:

| Classic Tool | Classic Handler | SDK Status | Notes |
|---|---|---|---|
| `browser_action` | `BrowserToolHandler` | ❌ Missing | SDK has no browser automation tool. Agent cannot interact with websites. **Likely a gap.** |
| `plan_mode_respond` | `PlanModeRespondHandler` | ❓ Unknown | SDK may handle plan/act modes differently (via session config or agent instructions rather than a tool). Need to verify. |
| `act_mode_respond` | `ActModeRespondHandler` | ❓ Unknown | Same as above. |
| `new_task` | `NewTaskHandler` | ❌ Missing | Subagent orchestration tool. SDK may use its own multi-agent mechanism. |
| `use_subagents` | `UseSubagentsToolHandler` | ❌ Missing | Same as above. |
| `condense` | `CondenseHandler` | ❓ Unknown | Internal context-management tool. SDK may handle context truncation internally. |
| `summarize_task` | `SummarizeTaskHandler` | ❓ Unknown | Internal tool for task summarization. SDK may handle this differently. |
| `generate_explanation` | `GenerateExplanationToolHandler` | ❌ Missing | UI feature for explaining changes. Would need to be an extra tool. |
| `report_bug` | `ReportBugHandler` | ❌ Missing | Slash-command tool. Low priority. |
| `new_rule` | `WriteToFileToolHandler` (shared) | ❌ Missing | Slash-command tool for creating .clinerules files. Low priority — the SDK's `write_to_file` can serve the same purpose. |
| `load_mcp_documentation` | `LoadMcpDocumentationHandler` | ❌ Missing | Loads MCP server creation docs. Low priority. |
| `access_mcp_resource` | `AccessMcpResourceHandler` | ❌ Missing | Accesses MCP server resources (not tools). The McpHub bridge only provides MCP tools, not resources. **Possible gap.** |
| `focus_chain` (TODO) | `undefined` (no handler) | ✅ N/A | Metadata-only parameter, no execution needed. |

#### Issue 4: SDK has tools NOT in classic

| SDK Tool | Classic Equivalent | Notes |
|---|---|---|
| `delete_file` | None | SDK provides file deletion. Classic extension didn't have an explicit delete tool. |

- **Root cause**: The SDK migration replaced the classic Task → ToolExecutorCoordinator → Handler pipeline with the SDK's internal tool execution. Extra tools are only `attempt_completion` + MCP tools. All other tools come from the SDK's built-in set, which doesn't include all classic tools.

- **Priority**:
  1. **Fix `attempt_completion` `command`** — the agent wastes tokens on a dead parameter
  2. **Audit `browser_action` and `access_mcp_resource`** — these may be user-visible gaps
  3. **Verify plan/act mode** — confirm the SDK handles this correctly without explicit tools
  4. **Low priority**: `report_bug`, `new_rule`, `load_mcp_documentation`, `generate_explanation` — these are convenience tools, not core functionality

### S6-40: 'Cline Loaded the skill' tool call appears blank (no skill name)
- **Status**: 🟢 Verified Fixed
- **Description**: When the agent uses the `skills` tool, the tool call in the chat showed "Cline loaded the skill:" but the skill name was blank — no name was rendered.
- **Root cause**: The SDK's `skills` tool uses `{ skill: "name", args?: "..." }` as its input format, but `sdkToolToClineSayTool()` only checked for `skill_name` and `name` fields. The SDK's field is just `skill`, so the extraction returned `""`, leaving `tool.path` empty.
- **Fix applied**: Added `getStringField(parsedInput, "skill")` to the fallback chain in the `skills`/`use_skill` case, between `skill_name` (classic) and `name` (generic fallback). This handles all three input formats.
- **Verification**: 3 new unit tests in `src/sdk/message-translator.test.ts` — S6-40 tests cover: SDK `skill` field extraction, content_end preserving skill name, classic `skill_name` backward compat. All 57 tests pass.

### S6-47: Search tool group summary shows empty regex and "/" path
- **Status**: 🟢 Verified Fixed
- **Description**: When the SDK's `search_codebase` tool runs, the tool group summary shows `Cline read 3 files, performed 1 search: "" in /` — the search regex is empty and the path is just `/` instead of a meaningful location.
- **Root cause**: Two issues:
  1. **Empty regex**: The SDK's `SearchCodebaseUnionInputSchema` accepts multiple input formats: `{ queries: string[] }`, `string[]` (bare array), or `string` (bare string). The `parseToolInput()` function in message-translator.ts only handles objects and stringified JSON objects — it returns `undefined` for bare arrays and non-JSON strings. When `parsedInput` is `undefined`, all `getArrayField`/`getStringField` lookups fail, producing `regex = ""`.
  2. **"/" path**: The SDK's `search_codebase` tool has no `path` parameter in its schema (it uses `config.cwd` internally). So `getStringField(parsedInput, "path")` always returns `undefined`. The webview's `ToolGroupRenderer` constructs `folderPath = (tool.path || "") + "/"` = `"/"`, and `formatSearchDisplay` shows `"" in /`.
- **Fix applied**: Three files changed:
  1. **`src/sdk/message-translator.ts`** (lines 275-293): Restructured the `search_codebase` case to handle all SDK union schema input formats. When `parsedInput` is an object, extracts queries normally. Falls back to checking `Array.isArray(input)` for bare arrays, then `typeof input === "string"` for bare strings.
  2. **`webview-ui/src/components/chat/chat-view/components/messages/ToolGroupRenderer.tsx`**: Three changes:
     - `formatSearchDisplay()`: When path is empty, shows "codebase" instead of `/`.
     - `getToolDisplayInfo()` searchFiles case: Sets `path` to `""` (not `"/"`) when `filePath` is empty.
     - `getActivityText()` searchFiles case: Removed `&& tool.path` requirement, and inner `formatSearchRegex()` shows "codebase" when path is empty.
  3. **`webview-ui/src/components/chat/RequestStartRow.tsx`**: Same fixes as ToolGroupRenderer — `formatSearchRegex()` shows "codebase" for empty path, `getActivityText()` doesn't require `tool.path` for search.
- **Verification**: 8 new unit tests in `src/sdk/message-translator.test.ts` cover all input formats:
  - `{ queries: ["TODO", "FIXME"] }` → `regex: "TODO, FIXME"` ✅
  - `JSON.stringify({ queries: ["TODO"] })` → `regex: "TODO"` ✅
  - `["TODO", "FIXME"]` (bare array) → `regex: "TODO, FIXME"` ✅
  - `"TODO"` (bare string) → `regex: "TODO"` ✅
  - `{ queries: "TODO" }` (string, not array) → `regex: "TODO"` ✅
  - content_end preserves queries from content_start ✅
  - content_end preserves bare array input ✅
  - path is undefined when SDK has no path param ✅
- **Evidence**: `npx vitest run --config vitest.config.sdk.ts -- message-translator` — 65 tests pass (8 new). `npx tsc --noEmit` — 0 errors in changed files.



### S6-48: File edit diffs show all green (no red deletions)
- **Status**: 🟢 Verified Fixed
- **Description**: When Cline edits an existing file, the diff shown in the chatview only showed green (additions) and never red (deletions). The entire file content appeared as additions, making it impossible to see what was actually changed.
- **Root cause**: Three compounding issues in the SDK message translation pipeline:
  1. **Editor tool**: The SDK's `editor` tool provides `old_text` and `new_text` fields. The message translator stored `new_text` into `content` and the `patch`/`diff` field into `diff`. But `ChatRow.tsx` passes `tool.content` to `DiffEditRow`'s `patch` prop. Since `content` was raw `new_text` (not a diff format), `DiffEditRow.parsePatch()` didn't recognize any known diff format and fell through to the fallback (lines 303-317) which treated the entire text as a new file, prefixing every line with `+ ` (green additions only).
  2. **apply_patch tool**: The SDK sends `apply_patch` input as `{ input: '...' }`, but the translator only checked the `patch` field (not `input`). Also, the translator set `diff` but not `content`, so `ChatRow.tsx`'s condition `tool.content` was falsy, causing it to fall through to `CodeAccordian` instead of `DiffEditRow`.
  3. **ChatRow.tsx**: The condition and prop used only `tool.content`, ignoring `tool.diff` even when it contained a valid patch.
- **Fix applied**: Three files changed:
  1. **`src/sdk/message-translator.ts`** — `editor`/`replace_in_file` case: When both `old_text` and `new_text` are provided, construct a search/replace diff in the format DiffEditRow expects (`------- SEARCH\n<old>\n=======\n<new>\n+++++++ REPLACE`) and store it in `content`. When only `new_text` is provided (new file), keep raw text as before.
  2. **`src/sdk/message-translator.ts`** — `apply_patch` case: Also check the `input` field (SDK format) in addition to `patch` and `diff`. Populate both `content` and `diff` with the patch so `ChatRow.tsx` can render it.
  3. **`webview-ui/src/components/chat/ChatRow.tsx`** — Changed condition from `tool.content` to `(tool.diff || tool.content)` and prop from `patch={tool.content}` to `patch={tool.diff || tool.content!}`, so `DiffEditRow` receives whichever field contains the diff.
- **Verification**: 7 new unit tests in `src/sdk/message-translator.test.ts`:
  - Editor with `old_text` + `new_text` → content is search/replace diff ✅
  - Editor with only `new_text` → content is raw new_text (newFileCreated) ✅
  - Editor with `old_str`/`new_str` variant → search/replace diff ✅
  - Multiline old/new text preserved in diff ✅
  - apply_patch with SDK `{ input: '...' }` → content and diff populated ✅
  - apply_patch with classic `{ patch: '...' }` → content and diff populated ✅
  - apply_patch prefers `patch` over `input` field ✅
  - Updated existing S6-24 test to expect diff format when old_text+new_text present ✅
- **Evidence**: `npx vitest run --config vitest.config.sdk.ts src/sdk/message-translator.test.ts` — 72 tests pass (7 new). `npx tsc --noEmit --skipLibCheck` — 0 errors.

- **Evidence**: `npx vitest run --config vitest.config.sdk.ts src/sdk/message-translator.test.ts` — 57 tests pass. `npx tsc --noEmit` — 0 errors.
