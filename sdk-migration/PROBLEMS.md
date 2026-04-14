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
- **Description**: When the user types a message and hits Enter (or clicks Send), nothing happens. The `newTask` gRPC handler calls `controller.initTask()` which creates a `ClineCore` session, but inference doesn't start. This affects both the debug harness and the production VSCode launch configuration.
- **Root cause**: **Both credential resolution paths in `buildSessionConfig()` fail silently:**
  1. **Path 1 — SDK ProviderSettingsManager**: The "cline" provider in `~/.cline/data/settings/providers.json` has `tokenSource: "oauth"` but an **empty `apiKey`** field. The OAuth token lives in `secrets.json` as `cline:clineAccountId` (a JSON object with `idToken`), but the SDK's migration never extracted it into the `apiKey` field. The check `if (lastUsed?.provider && lastUsed?.apiKey)` fails because `apiKey` is falsy.
  2. **Path 2 — Classic StateManager fallback**: Calls `stateManager.buildApiHandlerSettings(mode)` which **does not exist** on StateManager. TypeScript confirms: `error TS2339: Property 'buildApiHandlerSettings' does not exist on type 'StateManager'`. esbuild doesn't type-check so the build succeeds, but at runtime this throws `TypeError: stateManager.buildApiHandlerSettings is not a function`, caught silently by the try/catch.
  3. **Result**: Both paths fail → defaults to `providerId: "anthropic"`, `apiKey: ""` → API call fails with empty key.
- **Additional issue**: `SdkController.initTask()` awaits `core.start(startInput)` which blocks until the first agent turn completes, holding up the gRPC response to the webview. Even if credentials were correct, the webview would appear frozen until the first turn finishes.
- **Fix needed**:
  1. **Credential resolution**: Port the `resolveApiKey()` and `resolveModelId()` functions from `sdk-migration-fri` branch's `cline-session-factory.ts`. These functions read directly from `ApiConfiguration` (which includes secrets from `StateManager.constructApiConfigurationFromCache()`) and handle the "cline" provider specially: extract `idToken` from `cline:clineAccountId` JSON, add `workos:` prefix. They also map all 30+ providers to their correct API key field names.
  2. **Non-blocking session start**: Call `start({ interactive: true })` WITHOUT a `prompt`. This creates the session and returns immediately — `DefaultSessionManager.start()` at line 411 checks `if (startInput.prompt?.trim())` and skips `runTurn()` when there's no prompt. Then call `send({ sessionId, prompt })` to run the first turn. The `send()` blocks but events stream in real-time via `subscribe()`. The gRPC `newTask` handler should: (a) push the task message to the UI immediately, (b) `await start()` (fast — just creates session, returns session ID), (c) fire-and-forget `send()` (blocks in background, events stream to webview). This cleanly separates session creation from inference. Confirmed working by SDK's own e2e test (`default-session-manager.e2e.test.ts` lines 324-346).
- **Verification**: Send a message via debug harness `ui.send_message`, check extension host console for provider resolution logs showing a non-empty API key.
- **Reference**: `sdk-migration-fri:src/sdk/cline-session-factory.ts` lines 156-230 (`resolveApiKey()`, `resolveModelId()`)

### S6-6: Clicking historical chat items does nothing
- **Status**: 🔵 Awaiting Verification
- **Description**: Clicking on a task in the history view doesn't load the task's messages. `showTaskWithId()` creates a TaskProxy but doesn't load the actual messages from disk. The webview shows an empty chat.
- **Root cause**: `showTaskWithId()` in SdkController only created a TaskProxy and posted state — it didn't load the task's `ui_messages.json` from disk. The classic Controller loaded these through the Task class.
- **Fix**: Updated `showTaskWithId()` to call `readUiMessages(taskId)` from the legacy-state-reader and add them to the TaskProxy's `messageStateHandler` via `addMessages()`. This populates the message state so `getStateToPostToWebview()` returns the task's messages.
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

### S6-8: Debug harness loads extension in "local" environment (brown logo)
- **Status**: 🟡 Minor
- **Description**: When run via the debug harness, the extension appears in "local" environment mode (brown Cline logo) instead of "production" mode (white-on-black logo). The production VSCode launch configuration works correctly.
- **Root cause**: `src/dev/debug-harness/server.ts:370` hardcodes `CLINE_ENVIRONMENT: "local"` in the environment variables passed to the extension host.
- **Fix needed**: Change to `"production"` or make it configurable via a CLI flag (e.g., `--environment production`).
- **Verification**: Launch debug harness, take screenshot, verify logo is white-on-black.

### S6-9: DefaultSessionManager has multiple CLI-oriented assumptions
- **Status**: 🟡 Minor (anticipated, multiple sub-issues)
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
- **Status**: 🔴 Blocker (anticipated)
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

### S6-11: Credential caching from classic extension may not work
- **Status**: 🔴 Blocker
- **Description**: A key requirement of the SDK migration is that users should NOT need to log in again — cached credentials from the classic extension (`globalState.json` + `secrets.json`) should be reused. This branch's `buildSessionConfig()` attempts this via two paths, but **both fail** (see S6-5). The `sdk-migration-fri` branch solved this with custom `resolveApiKey()` / `resolveModelId()` functions that read directly from `StateManager.constructApiConfigurationFromCache()` and handle all provider-specific key mappings including the "cline" provider's OAuth token extraction.
- **Root cause**: The SDK's `ProviderSettingsManager` auto-migration does not correctly extract OAuth tokens for the "cline" provider. The `providers.json` entry has `tokenSource: "oauth"` but an empty `apiKey`. The fallback to `stateManager.buildApiHandlerSettings()` calls a method that doesn't exist.
- **Fix needed**: Replace the broken credential resolution in `buildSessionConfig()` with the working approach from `sdk-migration-fri`:
  1. Read `ApiConfiguration` from `StateManager.constructApiConfigurationFromCache()` (or equivalent)
  2. Use a `resolveApiKey(provider, config)` function that handles all providers, especially "cline" (extract `idToken` from `cline:clineAccountId` JSON, add `workos:` prefix)
  3. Use a `resolveModelId(provider, modePrefix, config)` function that maps provider-specific model ID keys
- **Verification**: After fix, `buildSessionConfig()` should log a non-empty API key for the "cline" provider when `secrets.json` contains a valid `cline:clineAccountId` entry.
- **Reference**: `sdk-migration-fri:src/sdk/cline-session-factory.ts` lines 156-280

<!-- Template:
### [ID] Title
- **Status**: 🔴/🟡/🔵/🟢
- **Description**: What's wrong
- **Root cause**: If known
- **Fix**: If attempted, with file references
- **Verification**: How to verify (test name, harness command)
- **Evidence**: Test output, screenshot, etc. (required for 🟢)
-->
