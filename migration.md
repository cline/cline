# SDK Migration — Plan & Status

Living implementation plan for migrating Cline to the ClineCore SDK.
This document shrinks as work completes and is deleted when the
migration is done.

## Related Documents

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Evergreen: features,
  design decisions, research findings, architecture diagrams, SDK
  capabilities, test strategy, QA guide.
- **[CAVEATS.md](CAVEATS.md)** — Known issues and bugs found during
  migration work. Check here before investigating a problem.
- **[DEBUG-HARNESS.md](DEBUG-HARNESS.md)** — E2E debugging tool for
  the VSCode extension (breakpoints, expression eval, UI automation).
  See also `.clinerules/debug-harness.md` for quick reference and
  `src/dev/debug-harness/README.md` for full API docs.

---

## Decisions

- **Webview**: Keep the existing webview-ui codebase. Replace
  gRPC-over-postMessage with typed JSON messages. Do NOT build a
  new UI from scratch.

- **Session persistence**: Custom `SessionPersistenceAdapter` over
  existing JSON task history (`~/.cline/data/tasks/`). No SQLite.

- **Task history**: Continue existing JSON format. New and old
  sessions intermixed seamlessly.

- **JetBrains sidecar**: New lightweight Node.js entry point using
  JSON-RPC over stdio. Shares SDK adapter layer with VSCode.

- **SDK packaging**: Published npm packages. `npm link` for local
  development.

- **Rollout**: VSCode first (from a branch). JetBrains last.

- **Breaking changes**: Avoid. Only new on-disk formats where
  strongly justified.

---

## Retrospective: What Went Wrong on `sdk-migration-port-check`

The branch deleted ~138K lines (classic core) before having a working
replacement, created stub webview components instead of adapting the
existing ones, had zero tests for the new adapter layer, and provided
no agent-accessible debugging. The result was 595 TypeScript errors
and a non-functional extension.

**Lessons:**
- Don't create stub UI components. Adapt the existing webview by
  making the backend speak its language.
- Define and test the interface contract first.
- Build observability before building features.

---

## What Remains to Be Done

**Phase 2 (current):** Cut over webview from gRPC to typed messages,
delete proto code. See Phase 2 details below.

**Phase 3:** Delete classic core (`src/core/`, `src/standalone/`,
`proto/cline/`, `src/generated/`). See "What Gets Deleted" below.

**Phase 4:** JetBrains sidecar (JSON-RPC over stdio).

**Phase 5:** Enterprise features (remote config, SSO, team controls),
P1 features (checkpoints, MCP marketplace).

## What Gets Deleted

1. `src/core/task/` → `@clinebot/agents`
2. `src/core/controller/` → SDK adapter layer
3. `src/core/api/` → `@clinebot/llms`
4. `src/core/prompts/system-prompt/` → SDK's prompt generation
5. `src/services/mcp/McpHub.ts` → SDK MCP manager
6. `src/standalone/` → SDK sidecar
7. `proto/cline/*.proto` → typed message protocol
8. `src/shared/proto-conversions/`, `src/generated/`
9. Browser automation, IDE terminal, shadow git, memory bank,
   focus chain, deep planning, workflows

---

## Implementation Plan

### Phase 0: Preparation & Cleanup ✅

Done. Deprecated features removed (browser automation, shadow git,
focus chain, deep planning, `/reportbug`). SDK npm dependencies
added.

### Phase 1: VSCode Extension Backend ✅

Done. SDK adapter layer implemented in `src/sdk/` with 234 tests
passing across 10 test files:

| Module | Tests | Description |
|--------|-------|-------------|
| `legacy-state-reader` | 42 | Reads `~/.cline/data/` settings |
| `message-translator` | 50 | SDK events → ClineMessage[] |
| `state-builder` | 29 | Controller state → ExtensionState |
| `grpc-handler` | 26 | gRPC compat layer for webview |
| `sdk-controller` | 25 | Full controller integration |
| `inbound-handler` | 18 | Typed message routing |
| `extension-sdk-smoke` | 13 | Extension entry point |
| `provider-migration` | 11 | Credential migration |
| `sdk-foundation` | 5 | SDK imports, test infra |
| `webview-bridge` | 15 | SDK events → webview pushes |

End-to-end verified: Cline/Anthropic inference works, Ollama
local inference works, settings persist across restarts, task
completion and "Start New Task" flow works.

### Phase 2: Webview Simplification (current)

Replace gRPC-over-postMessage with typed JSON messages. The typed
message infrastructure is in place; the remaining work is to cut
over from gRPC and delete the proto code.

**Done:**
- Typed message protocol (`src/shared/WebviewMessages.ts`)
- WebviewBridge (`src/sdk/webview-bridge.ts`)
- InboundMessageHandler (`src/sdk/inbound-handler.ts`)
- Typed client (`webview-ui/src/services/typed-client.ts`)
- Dual-listen pattern in `ExtensionStateContext.tsx`

**Remaining:**
- Remove gRPC subscriptions from webview (use typed messages only)
- Delete `proto/cline/*.proto`, `src/shared/proto-conversions/`,
  `src/generated/`
- Remove proto build steps from `package.json`

### Phase 3: Delete Classic Core

Remove `src/core/task/`, `src/core/controller/`, `src/core/api/`,
`src/core/prompts/system-prompt/`, `src/services/mcp/McpHub.ts`,
`src/standalone/`. Clean up `src/shared/`. Full test suite green.

### Phase 4: JetBrains Migration

SDK-based sidecar with JSON-RPC over stdio. See ARCHITECTURE.md
"JetBrains IPC Design" for details.

### Phase 5: Polish & Enterprise

Enterprise features, checkpoint system (kanban-style git refs),
MCP Marketplace, final cleanup.

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Webview big-bang breaks everything | Work on branch; classic continues on main |
| SDK tool behavior differs from classic | E2E tests before/after |
| Provider migration loses credentials | SDK has migration code + tests; sentinel file |
| Legacy sessions not resumable | Custom SessionPersistenceAdapter preserves format |
| JetBrains sidecar complexity | Defer to Phase 4; get VSCode solid first |
| SDK missing a feature | PRs to SDK repo; `npm link` for quick iteration |

---

## Implementation Checklist

```
Phase 0 — Preparation ✅
Phase 1 — VSCode Backend (SDK Adapter) ✅ (234 tests passing)

Phase 2 — Webview Simplification (current)
  [x] Typed message protocol (WebviewMessages.ts)
  [x] WebviewBridge + tests
  [x] InboundMessageHandler + tests
  [x] Dual-listen pattern in ExtensionStateContext
  [ ] Remove gRPC subscriptions from webview
  [ ] Delete proto/cline/*.proto, proto-conversions, generated code
  [ ] Remove proto build steps from package.json

Phase 3 — Delete Classic Core
  [ ] Remove src/core/task, controller, api, prompts
  [ ] Remove src/standalone
  [ ] Clean up src/shared
  [ ] Full test suite green

Phase 4 — JetBrains
  [ ] SDK sidecar with JSON-RPC over stdio
  [ ] Kotlin plugin changes

Phase 5 — Polish & Enterprise
  [ ] Enterprise features
  [ ] P1 features (checkpoints, MCP marketplace)
  [ ] Final cleanup
```
