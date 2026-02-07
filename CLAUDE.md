# Cline - AI Coding Assistant

Cline is a VS Code extension (also available as a CLI) that provides an autonomous AI coding agent. It supports 40+ API providers, communicates via gRPC/Protobuf between extension and webview, and uses a modular system prompt architecture with model-specific variants.

## Quick Reference

- **Build**: `npm run compile` (not `npm run build`)
- **Dev mode**: `npm run dev` (runs protos + watch)
- **Type check**: `npm run check-types` (checks extension, webview, and CLI)
- **Lint**: `npm run lint` (Biome linter)
- **Format**: `npm run format:fix` (Biome formatter — tabs, 130 line width, no semicolons)
- **Unit tests**: `npm run test:unit` (Mocha)
- **Webview tests**: `npm run test:webview`
- **CLI tests**: `npm run cli:test`
- **E2E tests**: `npm run test:e2e`
- **Proto codegen**: `npm run protos` (run after any `.proto` changes)
- **Snapshot update**: `UPDATE_SNAPSHOTS=true npm run test:unit`
- **Changesets**: `npm run changeset` (patch only, for user-facing changes)

## Project Structure

```
cline/
├── src/                          # Extension source code
│   ├── extension.ts              # VS Code extension entry point
│   ├── common.ts                 # Shared initialization
│   ├── core/                     # Core business logic
│   │   ├── api/                  # 40+ API provider implementations
│   │   │   ├── providers/        # Individual provider handlers
│   │   │   ├── transform/        # Response format transformers
│   │   │   └── index.ts          # buildApiHandler() factory
│   │   ├── task/                 # Task execution engine
│   │   │   ├── index.ts          # Task class (main loop)
│   │   │   ├── ToolExecutor.ts   # Tool execution coordinator
│   │   │   └── tools/handlers/   # 23+ tool handlers
│   │   ├── controller/           # gRPC request handlers (18 domains)
│   │   ├── prompts/              # System prompt generation
│   │   │   └── system-prompt/    # Modular prompt system
│   │   │       ├── components/   # Reusable sections (rules, capabilities)
│   │   │       ├── variants/     # Model-specific configs (12 variants)
│   │   │       ├── tools/        # Tool definitions per variant
│   │   │       └── templates/    # Template engine ({{PLACEHOLDER}})
│   │   ├── context/              # Context management & instructions
│   │   ├── storage/              # State persistence (StateManager)
│   │   ├── hooks/                # Lifecycle hooks (pre/post tool use)
│   │   ├── assistant-message/    # Response parsing & tool extraction
│   │   ├── slash-commands/       # Slash command definitions
│   │   ├── workspace/            # Multi-root workspace management
│   │   ├── permissions/          # Command permission system
│   │   ├── ignore/               # .clineignore handling
│   │   └── locks/                # SQLite-based task locking
│   ├── services/                 # Infrastructure services
│   │   ├── browser/              # Puppeteer browser automation
│   │   ├── mcp/                  # Model Context Protocol
│   │   ├── telemetry/            # Analytics & event tracking
│   │   ├── tree-sitter/          # Syntax tree parsing
│   │   ├── ripgrep/              # File search
│   │   └── feature-flags/        # Feature flag system
│   ├── shared/                   # Shared types (extension + webview + CLI)
│   │   ├── api.ts                # Provider/model definitions & pricing
│   │   ├── tools.ts              # ClineDefaultTool enum
│   │   ├── ExtensionMessage.ts   # Extension -> webview message types
│   │   ├── net.ts                # Proxy-aware fetch/axios (MUST use)
│   │   ├── storage/state-keys.ts # GlobalState & Settings interfaces
│   │   ├── proto-conversions/    # Proto <-> TypeScript mappers
│   │   └── providers/            # providers.json for UI dropdown
│   ├── integrations/             # VS Code feature integrations
│   │   ├── checkpoints/          # Git-based task snapshots
│   │   ├── editor/               # Diff view, file edit providers
│   │   └── terminal/             # Terminal command execution
│   ├── hosts/                    # IDE adapter layer
│   │   ├── vscode/               # VS Code implementation
│   │   └── external/             # Generic host (JetBrains, CLI)
│   └── utils/                    # General utilities
├── webview-ui/                   # React webview (Vite + Tailwind)
│   └── src/
│       ├── components/           # UI components (chat, settings, etc.)
│       ├── context/              # React contexts (state, auth, platform)
│       ├── services/             # gRPC client (ProtoBusClient)
│       └── utils/                # Validation, slash commands
├── cli/                          # Terminal CLI (React Ink)
│   └── src/
│       ├── components/           # TUI components (mirrors webview)
│       ├── agent/                # CLI agent logic
│       ├── controllers/          # CLI-specific controllers
│       └── utils/                # Terminal utilities
├── proto/                        # Protocol Buffer definitions
│   ├── cline/                    # Service protos (task, ui, models, etc.)
│   └── host/                     # Host environment protos
├── scripts/                      # Build & codegen scripts
├── .clinerules/                  # Development guidelines & workflows
└── locales/                      # i18n translations (8 languages)
```

## Architecture Overview

### Communication: gRPC over VS Code Message Passing

The extension (backend) and webview (frontend) communicate via a gRPC-like protocol serialized with Protocol Buffers:

1. **Webview** sends `GrpcRequest` via `window.postMessage()`
2. **Extension** routes to handler in `src/core/controller/<domain>/`
3. **Extension** responds with `GrpcResponse` (correlated by `request_id`)
4. Streaming is supported for real-time updates

### Task Execution Flow

```
User prompt -> Controller.initTask()
  -> Task.startTask() main loop:
     1. ContextManager builds context (instructions, files, MCP)
     2. PromptRegistry generates model-specific system prompt
     3. API handler streams response from provider
     4. AssistantMessageParser extracts tool calls
     5. ToolExecutor runs handler (ReadFile, WriteFile, Bash, etc.)
     6. Result appended to messages -> loop back to step 3
  -> Task completes -> history saved
```

### Import Aliases

The build uses path aliases via esbuild (defined in `esbuild.mjs` and `tsconfig.json`):
- `@/` -> `src/`
- `@core/` -> `src/core/`
- `@services/` -> `src/services/`
- `@shared/` -> `src/shared/`
- `@utils/` -> `src/utils/`

## Development Workflows

### Running Locally

```bash
npm run install:all    # Install all dependencies (root + webview)
npm run dev            # Build protos + watch mode (extension + webview)
npm run dev:webview    # Watch webview only
npm run cli:dev        # Watch CLI only
```

### Testing

- **Unit tests**: `npm run test:unit` (Mocha + Chai + Sinon, `.mocharc.json` config)
- **Webview tests**: `npm run test:webview` (Vitest)
- **CLI tests**: `npm run cli:test`
- **E2E tests**: `npm run test:e2e` (Playwright)
- **VS Code integration**: `npm run test:integration` (vscode-test)

System prompt snapshot tests validate prompts across all model families:
```bash
# Update snapshots after prompt changes
UPDATE_SNAPSHOTS=true npm run test:unit
```

### Code Quality

- **Formatter/Linter**: Biome (`biome.jsonc`)
  - Tabs, 4-space indent width, 130 char line width
  - No semicolons, trailing commas, LF line endings
  - `npm run format:fix` to auto-fix
  - `npm run lint` to check
- **Pre-commit hooks**: Husky + lint-staged (auto-formats staged files)
- **Logging**: Use `Logger` service, not `console.log` (enforced by Biome plugin)
- **VS Code API**: Restricted to `src/hosts/vscode/` (enforced by Biome plugin)

### Changesets

For user-facing changes, create a **patch** changeset:
```bash
npm run changeset
```
Never create minor or major version bumps. Skip for trivial fixes or internal refactors.

## Key Conventions & Tribal Knowledge

@.clinerules/general.md
@.clinerules/network.md
@.clinerules/cli.md
