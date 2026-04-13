# SDK Migration — Entry Point

You are working on migrating the Cline VSCode extension from its
classic core to the Cline SDK (`@clinebot/core`). This document is
your primary reference. Read it in full before starting any step.

## Document Map

| Document | Purpose | When to Read |
|----------|---------|--------------|
| **This file** | Entry point, plan, operational procedure | Always, first |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Features, design decisions, SDK capabilities | Before Step 1; refer back as needed |
| [SDK-REFERENCE/OAUTH.md](SDK-REFERENCE/OAUTH.md) | How the SDK handles OAuth and credentials | When working on auth (Steps 4, 5) |
| [SDK-REFERENCE/MCP.md](SDK-REFERENCE/MCP.md) | How the SDK handles MCP server management | When working on MCP (Step 5) |
| [PROBLEMS.md](PROBLEMS.md) | Known issues, verification status | Before each verification gate |
| [../src/dev/debug-harness/README.md](../src/dev/debug-harness/README.md) | Debug harness API reference | When using the debug harness |

Docs from previous attempts that are **not** carried forward:
- CAVEATS.md, FIXED.md, FEATURE-REMOVAL-CLEANUP-PLAN.md,
  DEBUG-HARNESS.md (root level), FEEDBACK.md — these degraded badly.
  Lessons are incorporated into this plan.

## References

### Code Repositories

| Repo | Path | kb_search name |
|------|------|----------------|
| Cline (this repo) | `~/clients/cline/cline` | `cline` |
| Cline SDK | `~/clients/cline/sdk-wip` | `sdk` |
| JetBrains Plugin | `~/clients/cline/intellij-plugin` | `plugin` |
| VSCode | `~/clients/cline/vscode` | `vscode` |

### How to Research the SDK

**Always use `kb_search` with the `sdk` repo** when you need to
understand how the SDK supports a feature. Do not guess at APIs,
URLs, or data formats. The SDK is the source of truth.

Example: Before implementing OAuth, search:
```
kb_search(name="sdk", query="OAuth login flow callback")
```

You can also compare before/after states using commit-based search:
```
kb_search(name="cline", query="accountLoginClicked", commit="origin/main")
kb_search(name="cline", query="accountLoginClicked", commit="HEAD")
```

---

## Core Principles

These principles are derived from hard-won experience on two previous
attempts. Violating them leads to broken products and wasted time.

### 1. Thunk, Don't Replace

The webview speaks gRPC-over-postMessage today. We will **not**
replace that with a new message protocol in this migration. Instead,
we build a **thunking layer** that sits between the SDK and the
existing gRPC interface. The webview continues to send gRPC-shaped
messages; the thunking layer translates between those and SDK calls.

This means:
- The webview code is largely untouched
- gRPC proto files stay in place until the final cleanup step
- Each SDK feature is wired up by implementing its gRPC handler

### 2. Verify Before You Proceed

Every step has a **verification gate**. You must demonstrate the
feature works before moving on. Verification means:
- Unit tests that test real behavior, not just that functions exist
- Debug harness smoke tests for UI-facing features
- Manual confirmation when automated tests can't cover it

Mark things as **"awaiting verification"** not "fixed". Only mark
"verified" after you have evidence (test output, screenshot, etc.).

### 3. Delete and Document

When replacing a classic module with its SDK equivalent, **delete the
classic code immediately** and document where to find it. Dead code
in the tree creates confusion about what is active vs. vestigial.

The classic implementation is always accessible via:
- `kb_search(name="cline", query="...", commit="origin/main")` —
  search the classic codebase at the pre-migration commit
- `git show origin/main:path/to/file.ts` — view any file
- `git diff origin/main..HEAD -- path/` — see what changed

When deleting a module, add a comment in the replacement file:
```
// Replaces classic src/core/task/ (see origin/main)
```

This way there is never any ambiguity about what code is running.

### 4. Use the Debug Harness

The debug harness at `src/dev/debug-harness/` is your primary
integration testing tool. Use it to:
- Verify UI renders correctly after changes
- Test user flows (login, chat, settings, history)
- Catch regressions that unit tests miss

**Always dismiss promotional overlays first.** There may be one or two:
1. "Introducing Cline Kanban" overlay
2. "New in v3.78.0" announcement overlay

Both follow the same `sr-only` pattern and can be dismissed with:
```
curl localhost:19229/api -d '{"method": "web.evaluate", "params": {"expression": "document.querySelectorAll(\".sr-only\").forEach(el => el.parentElement?.click())"}}'
```
You may need to run this twice if both overlays are present.

Use VSCode command palette actions to navigate between tabs.

### 5. SDK "Default" Implementations Are References, Not Products

The SDK's `DefaultSessionBuilder`, `DefaultRuntimeBuilder`, etc. are
designed for simple use cases. As an IDE, we need more:
- Custom MCP manager (file watching, SSE/streamableHTTP support)
- Custom session persistence (read existing task history format)
- Custom tool approval (integrate with webview approval UI)

Use the defaults as references, but implement what the product needs.

### 6. Avoid `as` Casts and Type Confusion

A recurring bug source was confusion between SDK types and gRPC/proto
types. For example, SDK returns `accountId` but gRPC expects
`workos:accountId`. Use explicit conversion functions with tests, and
never use `as` to paper over type mismatches.

---

## Migration Steps

This plan is ordered by dependency: each step builds on the previous.
Do not skip steps. Each step ends with a verification gate.

### Step 1: Foundation & Cutover

**Goal:** SDK dependencies installed, test infrastructure ready,
and the extension's entry point switched to the SDK adapter.
There is one entry point, not two.

Tasks:
- Add `@clinebot/core`, `@clinebot/llms`, `@clinebot/shared`,
  `@clinebot/agents` as dependencies (via `npm link` from local SDK)
- Add `vitest.config.sdk.ts` for SDK adapter tests
- Create `src/sdk/` directory with `index.ts` barrel export
- Modify `src/extension.ts` to use the SDK adapter as its
  activation path (replacing the classic `Controller` import)
- Delete `src/core/controller/` — the classic controller is replaced
  by `src/sdk/SdkController.ts` (to be implemented in Step 4).
  Add comment: `// Replaces classic src/core/controller/ (see origin/main)`
- Update `esbuild.mjs` if needed for the new import structure
- Verify: `npm run compile` succeeds, extension loads in VSCode
  (sidebar may show errors since handlers aren't implemented yet,
  but the extension process itself starts)

**Why one entry point:** Attempt 2 used `CLINE_SDK=1` to switch
between two entry points. This caused constant confusion about which
codepath was running. With a single entry point, there is never any
doubt. The classic code is always accessible via `origin/main`.

**Verification gate:** Extension compiles and loads. The SDK adapter
is the only codepath. (It won't do much yet — that's Step 4.)

### Step 2: Legacy State Reader

**Goal:** Read all existing on-disk state from the SDK adapter layer.

Tasks:
- Implement `src/sdk/legacy-state-reader.ts`:
  - Read `globalState.json` (provider settings, model selections,
    dismissed banners, etc.)
  - Read `secrets.json` (API keys, Cline auth tokens)
  - Read `taskHistory.json` (task list for history view)
  - Read per-task directories (`api_conversation_history.json`,
    `ui_messages.json`)
  - Read `cline_mcp_settings.json` (MCP server configs)
- Write tests against fixture data (copy real `~/.cline/data/`
  samples, redact secrets)
- Verify: All reads produce correct typed results, error handling
  for missing/corrupt files

**Verification gate:** Unit tests pass; reader correctly parses
real `~/.cline/data/` contents (spot-check manually).

### Step 3: Provider Migration

**Goal:** Existing provider credentials survive the transition.

Tasks:
- Implement `src/sdk/provider-migration.ts`:
  - Use SDK's `migrateLegacyProviderSettings()` as reference
  - Map classic `globalState.json` + `secrets.json` entries to
    SDK `providers.json` format
  - Never overwrite existing entries
  - Tag migrated entries with `tokenSource: "migration"`
  - Write a migration sentinel to prevent re-migration
- Test with fixtures covering all 30+ providers
- Verify: After migration, SDK can create handler for each provider;
  existing API keys still work

**Critical:** This is the highest-risk step. Getting it wrong means
users get logged out. Test exhaustively.

**Verification gate:** All provider credential tests pass. Manual
test: set up providers in classic extension, switch to SDK branch,
verify inference still works for Anthropic, OpenAI, OpenRouter,
Ollama, and the Cline provider.

### Step 4: Session Lifecycle (No UI Yet) — ✅ Completed

**Goal:** Create and manage SDK sessions from the adapter layer.

Tasks:
- [x] Implement `src/sdk/cline-session-factory.ts`:
  - Custom session persistence adapter reading `~/.cline/data/tasks/`
  - Map `HistoryItem` ↔ session fields
  - Implement `ClineCore.create()` with proper config
  - Build `CoreSessionConfig` from legacy state via `ProviderSettingsManager`
  - Build `StartSessionInput` and resume input helpers
- [x] Implement `src/sdk/SdkController.ts`:
  - `initTask(prompt)` — create session, start inference
  - `askResponse(message)` — continue conversation (sends to existing session)
  - `cancelTask()` — abort running session
  - `clearTask()` — reset for new task
  - `showTaskWithId(id)` — load task from history
  - `reinitExistingTaskFromId(id)` — resume task from history
  - Subscribe to SDK events, translate to internal message format
  - Session event listener system for downstream consumers
- [x] Implement `src/sdk/message-translator.ts`:
  - SDK `CoreSessionEvent` → `ClineMessage[]` for webview consumption
  - Handle all event types: chunk, agent_event (content_start/update/end,
    done, error, notice, iteration_start/end, usage), ended, hook, status
  - Streaming state tracking (partial message dedup)
  - Tool text formatting helpers
  - HistoryItem ↔ session field mapping
- [x] Test all paths — 91 unit tests pass across 4 test files

**Verification gate:** ✅ Unit tests pass (91/91). TypeScript compiles
with 0 errors in `src/sdk/`. Session lifecycle methods work through
the adapter layer without any UI. See PROBLEMS.md for known minor issues.

### Step 5: gRPC Thunking Layer — ✅ Completed

**Goal:** Wire SDK adapter to the existing webview via gRPC handlers.

This is the **critical insight from attempt 2**: the webview speaks
gRPC. We translate at the boundary. The webview stays untouched.

Tasks:
- [x] Implement `src/sdk/task-proxy.ts`:
  - `TaskProxy` provides a classic Task-compatible interface that
    delegates to SDK session methods
  - `handleWebviewAskResponse()` → SdkController.askResponse()
  - `abortTask()` → SdkController.cancelTask()
  - `MessageStateHandler` extends EventEmitter for CLI compatibility
  - `TaskProxyState` mirrors classic TaskState subset
  - Stub properties for removed features (browser, checkpoints)
- [x] Implement `src/sdk/webview-grpc-bridge.ts`:
  - Bridges SDK session events to webview gRPC streams
  - Translates ClineMessages to proto format via `convertClineMessageToProto()`
  - Pushes through `sendPartialMessageEvent()` for streaming
  - Pushes through `sendStateUpdate()` on significant events
  - Error handling — never blocks the event stream
- [x] Wire SdkController to use TaskProxy + WebviewGrpcBridge:
  - Session events → message translation → gRPC bridge → webview
  - `handleSessionEvent()` translates and emits to all listeners
  - Messages accumulated in `messageStateHandler` for state building
  - State updates pushed on turn complete / session ended
- [x] Reuse existing `getStateToPostToWebview()` for state building
  - Classic implementation reads from StateManager
  - TaskProxy provides `messageStateHandler.getClineMessages()`
  - Will be gradually replaced with SDK-sourced state in later steps

**Verification gate:** ✅ 114 unit tests pass across 6 test files.
TypeScript compiles with 0 new errors (3 pre-existing in unrelated
files). The gRPC thunking layer is complete — session events flow
from SDK through message translation to webview gRPC streams.
See PROBLEMS.md for known minor issues.

### Step 6: Auth & Account Flows

**Goal:** Full OAuth login/logout, credit display, org switching work.

This was the **most broken area** in attempt 2. Be especially careful.

Tasks:
- Implement Cline OAuth using SDK's `loginClineOAuth()`:
  - SDK spawns local callback server and provides the auth URL
  - Our code opens the browser
  - SDK handles token exchange
  - We persist tokens to `secrets.json`
- Implement `subscribeToAuthStatusUpdate` streaming:
  - Read credentials from disk on subscription
  - Push initial auth state immediately
  - Watch for changes (file watcher on secrets.json or in-memory)
- Implement `getUserCredits` / `getOrganizationCredits`:
  - Fetch from Cline API using stored auth token
  - Use `{apiBaseUrl}` not hardcoded `app.cline.bot`
- Implement `accountLogoutClicked`:
  - Clear credentials from disk
  - Push unauthenticated state to webview
- Implement `setUserOrganization`:
  - Update active org in stored credentials
  - Refresh credit display
- Test: stub environment where OAuth redirect is captured
  without opening a real browser

**Key pitfalls from attempt 2:**
- `workos:` prefix on account IDs — sometimes needed, sometimes not
- `{appBaseUrl}` vs hardcoded URLs — always use the env variable
- Race condition: webview subscribes to auth state before the
  bridge pushes it — always push initial state on subscribe
- Token field name mismatches between SDK and classic storage

**Verification gate:** Debug harness test — login, verify profile
appears, check credits, switch org, logout, verify logged-out state.
Then login again, verify session resumes.

### Step 7: MCP Integration

**Goal:** MCP servers load, tools appear in agent, server management
UI works.

Tasks:
- Implement custom MCP manager (not SDK Default):
  - Support stdio, SSE, and streamableHTTP transports
  - Watch `cline_mcp_settings.json` for changes
  - Reconnect/reload on file change
- Wire MCP tools into session as `extraTools`
- Implement gRPC handlers for MCP management UI:
  - `subscribeToMcpServers` — list servers with status
  - `restartMcpServer` / `deleteMcpServer`
  - `toggleMcpServer` / `toggleToolAutoApprove`
  - `updateMcpTimeout`
- Implement MCP marketplace (cache + refresh from API)

**Reference:** See `SDK-REFERENCE/MCP.md` for how the SDK's MCP
manager works and what gaps exist.

**Verification gate:** Debug harness test — MCP servers tab loads,
shows configured servers, can toggle enable/disable, agent can use
MCP tools during inference.

### Step 8: Settings & Features

**Goal:** All settings UI works, feature toggles persist.

Tasks:
- Wire all `updateSettings` keys to persist to `globalState.json`
- Implement `getAvailableTerminalProfiles` (simplified — only
  background terminal)
- Simplify terminal settings UI (remove IDE terminal options)
- Remove workflows tab from Cline Rules modal
- Remove focus chain / deep planning / memory bank UI remnants
- Verify model picker works for all providers
- Verify Plan/Act mode toggle works with separate model configs

**Verification gate:** Debug harness test — every settings section
renders, toggles persist across reload, model switching works.

### Step 9: Full Integration Verification

**Goal:** The SDK-backed extension is functionally equivalent to the
classic extension for all core features.

Tasks:
- Write QA test scripts covering:
  1. Fresh install flow (no saved state)
  2. Upgrade flow (existing state from classic)
  3. Login → inference → logout → login
  4. Multiple providers (Cline, Anthropic, OpenAI, Ollama)
  5. Task history: create, view, resume, delete, favorite
  6. Settings: change model, change provider, toggle features
  7. MCP: add server, use tool, remove server
  8. Plan/Act mode switching
  9. @ mentions and file attachments
  10. Cancel task mid-execution, start new task
- Run each test with the debug harness
- Document any known issues in PROBLEMS.md with reproduction steps

**Verification gate:** All QA scripts pass. Any failures are
documented and triaged.

### Step 10: Cleanup (Only After Step 9 Passes)

**Goal:** Remove classic core code that is no longer used.

**Do NOT start this step until Step 9 is fully verified.**

Tasks:
- Delete `src/core/task/` (replaced by `@clinebot/agents`)
- Delete `src/core/controller/` (replaced by SDK adapter)
- Delete `src/core/api/` (replaced by `@clinebot/llms`)
- Delete `src/core/prompts/system-prompt/` (replaced by SDK prompts)
- Delete `src/services/mcp/McpHub.ts` (replaced by SDK MCP)
- Delete `src/standalone/` (not needed for VSCode)
- Remove deprecated feature code (browser automation, shadow git,
  memory bank, focus chain, deep planning, workflows)
- Remove proto files for webview messages (keep proto for any
  persisted state that still uses them)
- Remove proto build steps from `package.json`
- Remove `src/shared/proto-conversions/`, `src/generated/`
- Clean up imports, fix TypeScript errors
- Run full test suite

**Verification gate:** Extension compiles and loads. All QA scripts
from Step 9 still pass. `npm run compile` produces no errors.

### Future Steps (Not In Scope)

- Step 11: JetBrains sidecar (JSON-RPC over stdio)
- Step 12: Enterprise features (remote config, SSO, team controls)
- Step 13: Improved checkpoints (kanban-style git refs)
- Step 14: MCP Marketplace improvements
- Step 15: Remove gRPC thunking layer, switch webview to typed
  JSON messages (optional — only if the thunking layer is a
  maintenance burden)

---

## Operational Procedure

### How to Work on a Step

1. **Read the step description** in full
2. **Check PROBLEMS.md** for any known issues in this area
3. **Research the SDK** using `kb_search(name="sdk", query="...")`
   before implementing anything
4. **Implement** the minimum needed to make the step's verification
   gate pass
5. **Write tests** that verify real behavior
6. **Verify** using the debug harness for UI-facing features
7. **Update PROBLEMS.md** with any issues found, marked as
   "awaiting verification"
8. **Commit** with a descriptive message referencing the step number

### How to Use the Debug Harness

```bash
# Build and launch
npx tsx src/dev/debug-harness/server.ts --skip-build --auto-launch

# Dismiss promotional overlays FIRST (may need to run twice)
curl localhost:19229/api -d '{"method": "ui.open_sidebar"}'
curl localhost:19229/api -d '{"method": "web.evaluate", "params": {"expression": "document.querySelectorAll(\".sr-only\").forEach(el => el.parentElement?.click())"}}'

# Navigate using command palette, NOT by clicking tabs
curl localhost:19229/api -d '{"method": "ui.command_palette", "params": {"command": "cline.accountLogin"}}'

# Take screenshots (read the file, don't open it!)
curl localhost:19229/api -d '{"method": "ui.screenshot"}'
# Returns {"result": {"path": "/tmp/cline-debug/screenshot-0001.png"}}
# Use read_file on that path to examine it
```

### How to Report Problems

When you find a bug, add it to `PROBLEMS.md` with:
- **ID**: Sequential number
- **Status**: 🔴 Blocker / 🟡 Minor / 🟢 Verified Fixed
- **Description**: What's wrong, where, how to reproduce
- **Root cause**: If known
- **Fix**: If attempted, with file references
- **Verification**: How to verify it's fixed (test name, harness
  command, etc.)

**Never mark a problem 🟢 without evidence.** Write the test first,
then mark it fixed.

### How to Handle "SDK Doesn't Support X"

If the SDK is missing a feature you need:
1. Document the gap in PROBLEMS.md
2. Search the SDK codebase (`kb_search name="sdk"`) for any
   workaround or extension point
3. If no workaround exists, implement a minimal version in the
   adapter layer
4. File an issue / PR to the SDK repo for the proper fix
5. Use `npm link` for quick iteration on SDK changes

---

## What Changed From Previous Attempts

### Attempt 1 (sdk-migration-port-check)

Deleted ~138K lines of classic core before having a working
replacement. Created stub webview components. Result: 595 TypeScript
errors, non-functional extension.

**Lesson:** Delete and document — but only as you replace, not
before. The classic code is always accessible via `origin/main`.

### Attempt 2 (sdk-migration-v2, 90 commits)

Built an SDK adapter layer with tests. Got inference working.
But documentation degraded, bugs were marked fixed without
verification, auth flows were broken, gRPC "mode" vs SDK "mode"
caused confusion, feature removals were incomplete, and the
agent kept confusing SDK types with gRPC types. The dual entry
point (`CLINE_SDK=1`) was a constant source of confusion.

**Lessons applied in this plan:**
- Single entry point — no `CLINE_SDK` flag, no dual codepaths
- Delete and document — dead code creates confusion; use
  `origin/main` and `kb_search` to reference the classic impl
- Thunk at the gRPC boundary, don't create a "mode" system
- Verify before proceeding, don't mark things fixed prematurely
- Use kb_search to research the SDK, don't guess at APIs
- Don't hardcode URLs, use `{appBaseUrl}`
- SDK "Default" implementations are references, not products
- Keep docs focused and reliable; use PROBLEMS.md for tracking
</task_progress>
</write_to_file>