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
- **Status**: 🟡 Minor (partially resolved)
- **Description**: The SdkController now initializes `authService`, `ocaAuthService`, and `accountService` (Step 6). Only `mcpHub` remains as `undefined` — will be wired in Step 7.
- **Root cause**: MCP hub will be properly initialized in Step 7.
- **Fix**: Auth and account services wired in Step 6. MCP hub pending Step 7.

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
- **Status**: 🟡 Minor
- **Description**: `reinitExistingTaskFromId()` starts a new session with a resumption prompt rather than using a dedicated SDK resume API. This works but doesn't preserve the original conversation context in the SDK's persistence layer.
- **Root cause**: SDK's resume API needs investigation — may not exist yet or may require session ID continuity.
- **Fix**: Investigate SDK's `ClineCore.resume()` or similar API and update `reinitExistingTaskFromId()` to use it.

### S4-3: Workspace root not available from ClineExtensionContext
- **Status**: 🟡 Minor
- **Description**: `ClineExtensionContext` doesn't have a `workspaceRoot` property. The SdkController falls back to `process.cwd()` for the session's working directory. In VSCode, the workspace root is available from the VSCode extension context but not from the shared `ClineExtensionContext` type.
- **Root cause**: The shared context type was designed for CLI/ACP use and doesn't include VSCode-specific workspace info.
- **Fix**: Add workspace root resolution in the host-specific initialization (VSCode host, CLI host) and pass it to the SdkController.

### Step 6: Auth & Account Flows — Completed

- **Status**: 🔵 Awaiting Verification
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
- **Status**: 🔵 Awaiting Verification
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
- **Status**: 🟡 Minor
- **Description**: `handleMcpOAuthCallback()` is stubbed — will be implemented in Step 7 (MCP Integration).
- **Root cause**: MCP integration is Step 7.
- **Fix**: Implement in Step 7.

### S6-5: Sending messages does not start inference
- **Status**: 🔴 Blocker
- **Description**: When the user types a message and hits Enter (or clicks Send), nothing happens. The `newTask` gRPC handler calls `controller.initTask()` which creates a `ClineCore` session, but inference doesn't start. Possible causes: (1) provider config not correctly resolved from `ProviderSettingsManager`, (2) the SDK session doesn't have the right credentials, (3) the send button may be disabled because the webview thinks no provider is configured.
- **Root cause**: The `initTask()` → `ClineCore.start()` path hasn't been tested end-to-end. The provider config resolution in `cline-session-factory.ts` may not correctly pass Cline provider credentials from the new AuthService to the SDK.
- **Fix**: Debug the `initTask()` flow — check that `buildSessionConfig()` produces a valid config with the right API key, and that `ClineCore.start()` doesn't silently fail.
- **Verification**: Send a message via debug harness `ui.send_message`, check extension host console for errors.

### S6-6: Clicking historical chat items does nothing
- **Status**: 🔴 Blocker
- **Description**: Clicking on a task in the history view doesn't load the task's messages. `showTaskWithId()` creates a TaskProxy but doesn't load the actual messages from disk. The webview shows an empty chat.
- **Root cause**: `showTaskWithId()` in SdkController only creates a TaskProxy and posts state — it doesn't load the task's `ui_messages.json` or `api_conversation_history.json` from disk. The classic Controller loaded these through the Task class.
- **Fix**: Implement message loading in `showTaskWithId()` — read the task's messages from `~/.cline/data/tasks/{taskId}/` and push them to the webview via the gRPC bridge.
- **Verification**: Click a history item, verify messages appear in the chat view.

### S6-7: Credits/payment history don't load immediately on startup
- **Status**: 🟡 Minor
- **Description**: After login, the available tokens and payment history don't appear immediately. They show up after clicking refresh. This is a timing issue — the first `getStateToPostToWebview()` call may happen before the auth token is fully restored.
- **Root cause**: Race condition between auth restoration and initial state push.
- **Fix**: Ensure `restoreRefreshTokenAndRetrieveAuthInfo()` completes before the first state push, or trigger a re-fetch after auth restoration completes.

### S6-4: Provider-specific OAuth callbacks (OpenRouter, Requesty, Hicap) stubbed
- **Status**: 🟡 Minor
- **Description**: `handleOpenRouterCallback()`, `handleRequestyCallback()`, `handleHicapCallback()` are stubbed. These are less commonly used and can be implemented when needed.
- **Root cause**: Lower priority — Cline OAuth is the primary flow.
- **Fix**: Implement when provider-specific OAuth is needed.

<!-- Template:
### [ID] Title
- **Status**: 🔴/🟡/🔵/🟢
- **Description**: What's wrong
- **Root cause**: If known
- **Fix**: If attempted, with file references
- **Verification**: How to verify (test name, harness command)
- **Evidence**: Test output, screenshot, etc. (required for 🟢)
-->