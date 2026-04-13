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
- **Status**: 🟡 Minor
- **Description**: The SdkController sets `mcpHub`, `accountService`, `authService`, `ocaAuthService` to `undefined`. Handler modules that access these will throw "not available" errors at runtime.
- **Root cause**: Services will be properly initialized in Steps 6-7.
- **Fix**: Wire up services as part of their respective migration steps.

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

<!-- Template:
### [ID] Title
- **Status**: 🔴/🟡/🔵/🟢
- **Description**: What's wrong
- **Root cause**: If known
- **Fix**: If attempted, with file references
- **Verification**: How to verify (test name, harness command)
- **Evidence**: Test output, screenshot, etc. (required for 🟢)
-->