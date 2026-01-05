# Cline Codebase Navigation Guide

A comprehensive guide to understanding and navigating the Cline codebase.

## Table of Contents
- [What is Cline?](#what-is-cline)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Key Directories Explained](#key-directories-explained)
- [Development Workflow](#development-workflow)
- [Important Patterns](#important-patterns)
- [Common Tasks](#common-tasks)
- [Essential Files to Read](#essential-files-to-read)

---

## What is Cline?

**Cline** is an AI-powered autonomous coding assistant that integrates into development environments:

- **Primary form**: VS Code extension with chat interface
- **Also includes**: Standalone CLI (written in Go)
- **Core capability**: Uses LLMs (Claude, GPT, etc.) to autonomously complete software development tasks
- **Key feature**: Model Context Protocol (MCP) integration for extensible tool system

The assistant can create/edit files, execute terminal commands, browse the web, and use custom tools - all with human-in-the-loop approval.

---

## Project Structure

```
cline/
├── src/                      # Extension backend (TypeScript/Node.js)
│   ├── core/                # Core business logic
│   ├── hosts/               # Host environment adapters (VSCode, external)
│   ├── integrations/        # Feature integrations
│   ├── services/            # Utility services
│   ├── shared/              # Shared types and utilities
│   └── extension.ts         # VS Code extension entry point
│
├── webview-ui/              # Chat UI (React + Vite + Tailwind)
│   ├── src/
│   │   ├── components/      # React components
│   │   └── services/        # Generated gRPC clients
│   └── package.json         # Separate npm package
│
├── proto/                   # Protocol Buffer definitions
│   ├── cline/              # Feature-domain protos
│   └── host/               # Host bridge protos
│
├── cli/                     # Standalone CLI (Go)
│   ├── cmd/                # Entry points
│   ├── pkg/                # Go packages
│   └── e2e/                # CLI tests
│
├── scripts/                 # Build and utility scripts
├── tests/                   # E2E tests (Playwright)
├── evals/                   # AI evaluation framework
├── docs/                    # Documentation site
├── assets/                  # Icons and static assets
└── locales/                 # Internationalization
```

---

## Architecture Overview

### Communication Pattern: gRPC over VS Code Messages

The extension uses a **gRPC-like protocol** over VS Code's message passing system:

```
┌─────────────┐         ┌──────────────┐         ┌──────────┐
│ Webview UI  │ ◄─────► │  Controller  │ ◄─────► │   Task   │
│  (React)    │  gRPC   │  (Handlers)  │         │ Executor │
└─────────────┘         └──────────────┘         └──────────┘
                                                        │
                                                        ▼
                                                   ┌─────────┐
                                                   │  Tools  │
                                                   └─────────┘
```

**Key Points:**
- No direct function calls between UI and backend
- All communication defined in `.proto` files
- Run `npm run protos` after any proto changes
- Generates TypeScript types and clients automatically

### Data Flow Example

1. User types message in UI (`ChatTextArea.tsx`)
2. UI calls RPC via generated client: `TaskServiceClient.newTask(...)`
3. Backend handler processes request: `src/core/controller/task/newTask.ts`
4. Task executor runs: `src/core/task/ToolExecutor.ts`
5. Tools execute: `src/core/task/tools/handlers/`
6. Results stream back via proto messages
7. UI updates: `ChatRow.tsx` renders results

---

## Key Directories Explained

### `src/core/` - The Heart of Cline

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| **`api/`** | LLM provider integrations | `providers/anthropic.ts`, `providers/openai.ts`, `providers/bedrock.ts` |
| **`task/`** | Task execution engine | `ToolExecutor.ts`, `StreamResponseHandler.ts`, `tools/handlers/` |
| **`prompts/`** | System prompt generation | `system-prompt/`, `commands.ts` |
| **`controller/`** | RPC handlers by domain | `task/`, `file/`, `mcp/`, `state/`, `ui/` |
| **`context/`** | Context management | `context-management/ContextManager.ts` |
| **`assistant-message/`** | Parse LLM responses | `parse-assistant-message.ts`, `diff.ts` |
| **`hooks/`** | User-defined hooks system | `hook-executor.ts`, `hook-factory.ts` |
| **`storage/`** | SQLite persistence | Database operations |
| **`mentions/`** | @file, @url parsing | `index.ts` |
| **`slash-commands/`** | Built-in slash commands | Command definitions |

### `src/services/` - Utility Services

- `auth/` - Authentication and account management
- `mcp/` - MCP server lifecycle management
- `browser/` - Puppeteer-based browser automation
- `search/` - ripgrep integration for file search
- `tree-sitter/` - Code parsing (AST)
- `telemetry/` - Analytics (PostHog)
- `dictation/` - Voice input support
- `logging/` - Logging infrastructure

### `src/integrations/` - Feature Integrations

- `terminal/` - Terminal integration
- `checkpoints/` - Workspace snapshot/restore
- `diagnostics/` - VS Code problems panel integration
- `editor/` - Editor-specific integrations

### `webview-ui/src/` - React Frontend

```
components/
├── chat/               # Main chat interface
│   ├── ChatView.tsx    # Container component
│   ├── ChatRow.tsx     # Individual message rendering
│   ├── ChatTextArea.tsx # Input with @mentions
│   └── ...             # Tool-specific rows (BrowserSessionRow, DiffEditRow, etc.)
│
├── settings/           # Settings panels
├── history/            # Task history browser
├── mcp/                # MCP marketplace UI
├── account/            # Account management
└── common/             # Reusable components
```

### `proto/` - Protocol Definitions

Communication contract between UI and backend:

- `proto/cline/task.proto` - Task operations (newTask, cancelTask, etc.)
- `proto/cline/ui.proto` - UI operations (scrollToSettings, etc.)
- `proto/cline/state.proto` - Settings and state management
- `proto/cline/mcp.proto` - MCP server management
- `proto/cline/account.proto` - Authentication
- `proto/host/*.proto` - Host environment operations

**After editing:** Run `npm run protos` to regenerate TypeScript

### `cli/` - Go CLI Implementation

```
cli/
├── cmd/
│   ├── cline/         # Main CLI entry (Cobra commands)
│   └── cline-host/    # Host bridge gRPC server
│
├── pkg/
│   ├── cli/           # CLI subsystems
│   │   ├── auth/      # Authentication
│   │   ├── task/      # Task management
│   │   ├── config/    # Configuration
│   │   └── display/   # Terminal rendering
│   ├── hostbridge/    # gRPC server for host operations
│   ├── common/        # Shared utilities
│   └── generated/     # Generated proto code
│
└── e2e/               # CLI E2E tests
```

---

## Development Workflow

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/cline/cline.git
cd cline

# Install dependencies
npm install

# Install webview dependencies
cd webview-ui && npm install && cd ..
```

### Development Commands

```bash
# Generate protos and watch for changes
npm run dev

# Watch extension code
npm run watch

# Watch webview (hot reload)
npm run dev:webview

# Watch CLI (hot reload)
npm run dev:cli:watch
```

### Building

```bash
# Build extension (NOT "npm run build" - this is VS Code extension!)
npm run compile

# Build webview
npm run build:webview

# Build CLI
npm run compile-cli

# Build CLI for all platforms
npm run compile-cli-all-platforms

# Create production VSIX package
npm run package
```

### Testing

```bash
# Run all tests
npm run test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests (Playwright)
npm run test:e2e

# With coverage
npm run test:coverage

# Regenerate system prompt test snapshots
UPDATE_SNAPSHOTS=true npm run test:unit
```

### VS Code Extension Development

1. Open project in VS Code
2. Press **F5** to launch Extension Development Host
3. Extension loads in new VS Code window
4. Make changes, then run "Reload Window" command
5. Use `npm run watch` + `npm run dev:webview` for hot reload

### CLI Development

```bash
# Build and link locally
npm run compile-cli
npm link

# Test CLI
cline --version
cline auth
cline "write hello world in python"
```

---

## Important Patterns

### 1. System Prompts Are Modular and Model-Specific

Located in `src/core/prompts/system-prompt/`:

```
system-prompt/
├── components/        # Reusable sections
│   ├── rules.ts      # General rules
│   ├── capabilities.ts
│   ├── tool_use.ts
│   └── ...
│
├── variants/          # Model-family-specific
│   ├── generic/      # Fallback for all models
│   ├── next-gen/     # Claude 4, GPT-5, Gemini 2.5
│   ├── native-next-gen/
│   ├── gpt-5/
│   ├── gemini-3/
│   ├── xs/           # Small/local models
│   ├── hermes/
│   └── glm/
│
├── tools/            # Tool definitions by model family
└── templates/        # Template engine ({{PLACEHOLDER}} resolution)
```

**How it works:**
1. `PromptRegistry.get(context)` detects model family
2. Loads appropriate variant config
3. Composes prompt from components (with optional overrides)
4. Resolves placeholders via `TemplateEngine`
5. Returns final system prompt

**After changes:** Run `UPDATE_SNAPSHOTS=true npm run test:unit`

### 2. Adding a New Tool (7 Steps)

From `CLAUDE.md` - this is the complete workflow:

1. **Add enum** to `src/shared/tools.ts` (`ClineDefaultTool` enum)
2. **Define tool** in `src/core/prompts/system-prompt/tools/my_tool.ts`
   - Export variants for each `ModelFamily`
   - Minimum: export `[GENERIC]` (auto-fallback for others)
3. **Register** in `src/core/prompts/system-prompt/tools/init.ts`
4. **Add to variant configs** in `variants/*/config.ts`:
   - `generic/config.ts`, `next-gen/config.ts`, `gpt-5/config.ts`, etc.
5. **Create handler** in `src/core/task/tools/handlers/my_tool.ts`
6. **Wire up** in `ToolExecutor.ts` if needed
7. **Add UI feedback** (if needed):
   - Add `ClineSay` enum in proto
   - Update `src/shared/ExtensionMessage.ts`
   - Update `src/shared/proto-conversions/cline-message.ts`
   - Update `webview-ui/src/components/chat/ChatRow.tsx`

### 3. Adding a New RPC Method

1. **Define in proto** file (e.g., `proto/cline/task.proto`):
   ```protobuf
   service TaskService {
     rpc myNewMethod(MyRequest) returns (MyResponse) {}
   }
   ```

2. **Run proto generation**:
   ```bash
   npm run protos
   ```

3. **Create handler** in `src/core/controller/<domain>/myNewMethod.ts`:
   ```typescript
   export const myNewMethod = async (
     request: MyRequest
   ): Promise<MyResponse> => {
     // Implementation
   }
   ```

4. **Call from UI**:
   ```typescript
   import { TaskServiceClient } from "@/services/TaskServiceClient"

   const result = await TaskServiceClient.myNewMethod(
     MyRequest.create({ ... })
   )
   ```

### 4. Modifying System Prompt

**Read first:**
- `src/core/prompts/system-prompt/README.md`
- `src/core/prompts/system-prompt/tools/README.md`
- `src/core/prompts/system-prompt/__tests__/README.md`

**Variant tiers (ask which to modify):**
- **Next-gen**: Claude 4, GPT-5, Gemini 2.5 (`next-gen/`, `gpt-5/`, `gemini-3/`)
- **Standard**: Default fallback (`generic/`)
- **Local**: Small models (`xs/`, `hermes/`, `glm/`)

**To add a rule:**
1. Check if variant overrides: look for `rules_template` in `variants/*/template.ts`
2. If shared: modify `components/rules.ts`
3. If overridden: modify that variant's template
4. Regenerate snapshots: `UPDATE_SNAPSHOTS=true npm run test:unit`

### 5. ChatRow Cancelled/Interrupted States

When a message has a loading state, you must handle cancellation:

```typescript
const wasCancelled =
    status === "generating" &&
    (!isLast ||
        lastModifiedMessage?.ask === "resume_task" ||
        lastModifiedMessage?.ask === "resume_completed_task")

const isGenerating = status === "generating" && !wasCancelled
```

**Why both checks?**
- `!isLast` catches: cancelled → resumed → this message is stale
- `lastModifiedMessage?.ask === "resume_task"` catches: just cancelled, hasn't resumed yet

See: `ChatRow.tsx`, `BrowserSessionRow.tsx` for examples

### 6. Proto Workflow

```bash
# 1. Edit proto file
vim proto/cline/task.proto

# 2. Regenerate types (REQUIRED!)
npm run protos

# 3. Implement handler
# src/core/controller/task/myFeature.ts

# 4. Call from UI
# webview-ui: TaskServiceClient.myFeature(...)
```

### 7. Slash Commands

Three files need updates:
1. `src/core/slash-commands/index.ts` - Command definitions
2. `src/core/prompts/commands.ts` - System prompt integration
3. `webview-ui/src/utils/slash-commands.ts` - Webview autocomplete

---

## Common Tasks

### Finding Where Something Happens

| Task | Where to Look |
|------|---------------|
| **Tool execution** | `src/core/task/tools/handlers/` |
| **LLM API calls** | `src/core/api/providers/` |
| **System prompt** | `src/core/prompts/system-prompt/` |
| **UI rendering** | `webview-ui/src/components/` |
| **RPC handlers** | `src/core/controller/` |
| **Context management** | `src/core/context/` |
| **Message parsing** | `src/core/assistant-message/` |
| **Hooks system** | `src/core/hooks/` |

### Debugging

**Extension:**
1. Press F5 to launch Extension Development Host
2. Open Developer Tools: Help → Toggle Developer Tools
3. Console logs appear in main VS Code instance (not dev host)
4. Set breakpoints in VS Code

**Webview:**
1. Right-click in chat UI → Inspect
2. React DevTools available
3. Console logs appear in webview DevTools

**CLI:**
```bash
# Enable debug logging
export CLINE_DEBUG=1
cline "your task"

# View logs
cat ~/.cline/logs/cline.log
```

### Understanding a Feature

1. **Find the proto definition** in `proto/cline/`
2. **Find the controller handler** in `src/core/controller/`
3. **Find the UI component** in `webview-ui/src/components/`
4. **Find the tool handler** (if applicable) in `src/core/task/tools/handlers/`

Example: Explain Changes feature
- Proto: `proto/cline/task.proto` (ExplainChangesRequest)
- Handler: `src/core/controller/task/explainChanges.ts`
- UI: `webview-ui/src/components/chat/ChatRow.tsx`
- Tool: `src/core/task/tools/handlers/generate_explanation.ts`

---

## Essential Files to Read

### Must-Read Documentation

1. **`CLAUDE.md`** - Tribal knowledge, non-obvious patterns (THIS IS GOLD!)
2. **`README.md`** - Project overview and getting started
3. **`CONTRIBUTING.md`** - Contribution guidelines
4. **`src/core/README.md`** - Core architecture overview
5. **`cli/architecture.md`** - CLI design and architecture
6. **`src/core/prompts/system-prompt/README.md`** - Prompt system deep dive

### Key Configuration Files

- `package.json` - Extension manifest and scripts
- `tsconfig.json` - TypeScript configuration
- `biome.jsonc` - Linting/formatting rules
- `.vscode/launch.json` - Debug configurations
- `.env.example` - Environment variables

### Entry Points

- `src/extension.ts` - VS Code extension entry
- `cli/cmd/cline/main.go` - CLI entry
- `webview-ui/src/App.tsx` - React app entry

---

## Quick Tips

✅ **DO:**
- Use `npm run compile` (not `build` - this is a VS Code extension)
- Run `npm run protos` after any proto changes
- Always use **absolute file paths** in tools (not relative)
- Check `CLAUDE.md` first when stuck
- Regenerate snapshots after system prompt changes
- Look for similar patterns before implementing new features

❌ **DON'T:**
- Make direct function calls between UI and backend (use gRPC)
- Forget to update variant configs when adding tools
- Skip running tests before committing
- Hardcode file paths or configurations
- Add features without reading existing code first

---

## Technology Stack

### Backend (Extension)
- **Language**: TypeScript
- **Runtime**: Node.js
- **Communication**: gRPC (nice-grpc), Protocol Buffers
- **Storage**: SQLite (better-sqlite3)
- **LLM SDKs**: Anthropic, OpenAI, Google Vertex AI, AWS Bedrock
- **Browser**: Puppeteer-core
- **Search**: ripgrep
- **Parsing**: tree-sitter

### Frontend (Webview)
- **Framework**: React 18
- **Build**: Vite
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI
- **Animation**: Framer Motion
- **State**: React Context + hooks

### CLI
- **Language**: Go
- **CLI Framework**: Cobra
- **TUI**: Bubble Tea
- **Communication**: gRPC

### Build & Testing
- **Build**: esbuild, Vite, Go toolchain
- **Testing**: Mocha, Playwright, vitest
- **Linting**: Biome
- **Type Checking**: TypeScript strict mode

---

## Getting Help

- **Issues**: Check existing issues on GitHub
- **Tribal Knowledge**: Read `CLAUDE.md` thoroughly
- **Architecture Docs**: Check `src/core/README.md` and `cli/architecture.md`
- **Code Patterns**: Search for similar implementations first
- **Tests**: Look at test files for usage examples

---

## Additional Resources

- **MCP Documentation**: https://modelcontextprotocol.io/
- **VS Code Extension API**: https://code.visualstudio.com/api
- **Protocol Buffers**: https://protobuf.dev/
- **Anthropic API**: https://docs.anthropic.com/

---

Happy coding! 🚀
