# SDK Migration — Architecture & Design

Evergreen reference for the Cline SDK migration project.
This document describes what we're building and why.
For the step-by-step plan, see [README.md](README.md).

## Product Background

There's a VSCode extension in `src/`. A large part of its UI is a
React-based webview in `webview-ui/`. There's a JetBrains plugin
that packages the core and communicates via protobufs. There's a
CLI that uses the SDK separately.

The Cline SDK (`@clinebot/core`, `@clinebot/llms`,
`@clinebot/agents`, `@clinebot/shared`) provides session management,
provider handling, tool execution, and MCP integration. Our goal is
to replace the classic core with the SDK while keeping the webview
mostly intact.

## Architecture

### Current (Classic)

```
VSCode Extension
  WebviewProvider → Controller → Task → API providers (30+)
                  → McpHub
  Webview (React) ← gRPC/postMessage → Extension Host
  proto/cline/*.proto defines message format
```

### Target (SDK-Backed)

```
VSCode Extension
  WebviewProvider → SDK Adapter Layer → @clinebot/core
                  → Custom MCP Manager
  Webview (React) ← gRPC/postMessage → gRPC Thunk → SDK Adapter
  (same proto messages — webview unchanged)
```

### Key Architectural Decision: gRPC Thunking

The webview communicates with the extension host via gRPC-over-postMessage.
We will **not** change this in the migration. Instead, we implement a
thunking layer that:

1. Receives gRPC-shaped requests from the webview
2. Translates them to SDK calls
3. Translates SDK responses back to gRPC shape
4. Pushes streaming updates (state, auth, partial messages) as
   gRPC streaming responses

This means:
- The webview code is **largely untouched**
- Proto files stay until the final cleanup step
- Each SDK feature is wired by implementing its gRPC handler

### Key Architectural Decision: Single Entry Point

There is one extension entry point (`src/extension.ts`), modified to
use the SDK adapter. No `CLINE_SDK` environment variable, no dual
codepaths. The classic implementation is always accessible via
`origin/main` and `kb_search`.

### Key Architectural Decision: Delete and Document

When replacing a classic module with its SDK equivalent, we delete
the classic code immediately and add a comment in the replacement:
```
// Replaces classic src/core/task/ (see origin/main)
```
This eliminates confusion about what code is active. The classic
code is always recoverable from git.

### Future Architecture (Post-Migration)

```
VSCode Extension
  SDK Adapter Layer → @clinebot/core
  Webview (React) ← typed JSON messages → SDK Adapter
  (gRPC removed; simpler message protocol)

JetBrains Plugin
  Kotlin Plugin ← JSON-RPC/stdio → SDK Sidecar (Node.js)
  JCEF Webview ← postMessage → SDK Sidecar
  (shares SDK adapter layer with VSCode)
```

## Features

### Features to Remove

- **Browser automation** (Playwright) — replaced by MCP browser tools
- **IDE terminal integration** — replaced by background terminal
- **Shadow git checkpoints** — too slow; will be replaced later
- **Memory bank / structured context** — removed
- **Focus chain / task tracking** — removed
- **Deep planning / `/deep-planning`** — plan/act mode replaces it
- **Workflows** — skills (SKILL.md) replace them
- **`/reportbug`** — removed

### Core Features (Must Work)

- File operations: read, write, search, replace, list files
- Background terminal execution
- Multi-provider AI models (30+ providers)
- Auto-approve & YOLO mode
- Auto-compaction
- Subagents
- Web search and web fetch
- Worktrees
- Workspaces
- Jupyter Notebooks
- Cline Rules
- Skills
- Hooks
- .clineignore
- MCP (stdio + SSE + streamableHTTP)

### Core Workflows (Must Work)

- Task lifecycle: create, resume, history, cost tracking
- Plan & Act mode with optional separate model configs
- File context (@-mentions)
- Slash commands: /newtask, /smol, /newrule

### Model Configuration

- 30+ providers with seamless switching
- **Critical**: Preserve existing credentials — never log users out
- Support local models (Ollama, LM Studio)
- Cline provider with unified auth, billing, org switching
- VSCode LM API provider (Copilot) if possible

### P1 Features (Can Follow Up)

- Checkpoints (kanban-style git refs, not shadow git)
- Diffing between checkpoints
- Restore files/task to checkpoint
- MCP Marketplace

### P2 Features (Later)

- Task favorites and grouping
- File drag-and-drop context
- `/explain-changes` slash command

## Design Principles

### Naming: "Sdk..." Considered Harmful

Don't name types `SdkFoo` or folders `sdk`. The SDK backing is an
implementation detail. Use simple noun phrases. During migration,
`SdkFoo` as a temporary alias is OK, but rename before completion.

### Proto Deprecation

Protos for webview messages will eventually be replaced by shared
TypeScript interfaces. But **not during this migration** — we keep
the gRPC thunking layer and remove protos only in the final cleanup.

Protos for persisted state (if any) can stay indefinitely.

### Data Formats & Settings

- **Must** pick up existing on-disk state
- Never log users out of their providers
- CLI, VSCode, and JetBrains share state on disk — continue that
- Design migrations with breadcrumbs and downgrade robustness
- Protect against corrupt JSON writes (atomic write-then-rename)

### Webview UI

- Reuse the existing webview — do NOT build from scratch
- Familiar, not worse, preferably better
- Simplify state management where the SDK enables it
- Fix known defects (n² state updates, wrong keybindings) when
  the opportunity arises

## What the SDK Provides

These capabilities exist in the SDK and do not need to be rebuilt:

1. **Legacy provider settings migration** —
   `migrateLegacyProviderSettings()` reads `globalState.json` +
   `secrets.json`, writes to `providers.json`
2. **30+ provider handlers** — Anthropic, OpenAI, Gemini, Bedrock,
   Vertex, DeepSeek, Ollama, LM Studio, etc.
3. **Custom handler registry** — `registerHandler(id, factory)` for
   VSCode LM API and other host-specific providers
4. **MCP management** — `InMemoryMcpManager` with stdio, SSE,
   streamableHttp transports (but needs custom factory for non-stdio)
5. **Tool framework** — 8 built-in tools, preset system, per-tool
   policies, model-aware routing
6. **Session lifecycle** — `ClineCore.create()` → `host.start()` /
   `host.send()` / `host.abort()` / `host.subscribe()`
7. **Telemetry** — `TelemetryService` with pluggable adapters
8. **Rules & Skills** — Discovery from `.clinerules/`,
   `~/Documents/Cline/Rules`, etc.
9. **Hooks** — `HookEngine` with lifecycle events
10. **Subagents/Teams** — `AgentTeamsRuntime`, spawn tools
11. **System prompt generation** — `getClineDefaultSystemPrompt()`
12. **OAuth token management** — `RuntimeOAuthTokenManager` for
    automatic refresh
13. **Storage isolation** — `CLINE_DIR`, `CLINE_DATA_DIR` env vars

## SDK Gaps (Known)

These features need custom implementation in the adapter layer:

1. **MCP settings file watcher** — SDK doesn't watch for changes
2. **MCP manager exposure** — Runtime builder encapsulates the
   manager; clients can't call lifecycle methods on running sessions
3. **SSE/StreamableHTTP client** — Default factory only creates
   stdio clients; we need a custom factory
4. **RPC endpoints for MCP** — No MCP management in the RPC layer
5. **OAuth callback handling** — SDK provides the server and URL,
   but the client must open the browser and persist tokens

See `SDK-REFERENCE/MCP.md` and `SDK-REFERENCE/OAUTH.md` for details.

## JetBrains IPC Design (Future)

The target is JSON-RPC over stdio between the Kotlin plugin and a
Node.js sidecar. See the original ARCHITECTURE.md for the full
design. This is **not in scope** for the current migration —
VSCode comes first.

## Test Strategy

### Unit Tests

- **SDK adapter tests**: Vitest (no vscode mock needed)
- **Extension unit tests**: Mocha with vscode mock (existing)
- **Webview tests**: Vitest + React Testing Library (existing)

### Integration Tests

- **Debug harness**: Playwright-driven VSCode with CDP access
- **QA scripts**: Curl-based test sequences for core flows

### SDK Storage Isolation

```typescript
import { setClineDir, setHomeDir } from "@clinebot/shared/storage"
const tempHome = mkdtempSync(join(tmpdir(), "test-home-"))
process.env.HOME = tempHome
process.env.CLINE_DIR = join(tempHome, ".cline")
process.env.CLINE_DATA_DIR = join(tempHome, ".cline", "data")
setHomeDir(tempHome)
setClineDir(process.env.CLINE_DIR)
```

## Manual QA Risk Areas

1. **Provider credentials** — Verify API keys survive upgrade/downgrade
2. **Cline provider OAuth/SSO** — Sign-in, sign-out, refresh, org switch
3. **Chat streaming** — Missing/duplicated messages, performance
4. **Tool approval** — Auto-approve, YOLO, per-tool permissions
5. **Plan/Act mode** — Toggle, separate models, persistence
6. **Task history** — Old tasks appear, new tasks save, resume works
7. **MCP servers** — Configs picked up, tools work
8. **Settings UI** — All toggles persist
9. **Webview performance** — Long conversations don't lag