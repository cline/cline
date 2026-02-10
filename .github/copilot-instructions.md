# Copilot Instructions for Cline

This repository contains the source code for the Cline VS Code extension. Follow these instructions to be effective in this codebase.

## Architecture Overview
- **Core Extension (`src/`)**: Runs in the VS Code Extension Host.
  - **Entry**: `src/extension.ts`.
  - **State Management**: `src/core/controller/index.ts` is the single source of truth used by `WebviewProvider` and `Task`.
  - **Task Execution**: `src/core/task/` handles the agent loop, API requests, and tool execution.
- **Webview UI (`webview-ui/`)**: A React/Vite application for the user interface.
- **Communication**: gRPC-like protocol over VS Code message passing. Definitions in `proto/`.
- **Model Context Protocol (MCP)**: Managed by `src/services/mcp/McpHub.ts`.

## Critical Developer Workflows
- **Build Extension**: `npm run compile` (do not use `npm run build`).
- **Build Webview**: `npm run build:webview`.
- **Watch Mode**: `npm run watch` (rebuilds both extension and webview on change).
- **Protos**: Run `npm run protos` immediately after modifying any `.proto` file. This works for both global and local changes.
- **Testing**:
  - Unit: `npm run test:unit`.
  - Snapshots: Update prompt snapshots with `UPDATE_SNAPSHOTS=true npm run test:unit`.
- **Releases**: Run `npm run changeset` for user-facing changes (patch only).

## Communication & RPC (Extension <-> Webview)
The app uses a strict schema-driven communication pattern via Protobufs.
1. **Define Schema**: Add messages/services in `proto/` (e.g., `proto/cline/ui.proto`).
   - Use `PascalCaseService`, `camelCase` RPCs, `PascalCase` Messages.
2. **Generate**: Run `npm run protos`. This updates `src/shared/proto/`, `src/generated/`, etc.
3. **Implement**:
   - **Backend**: Add handler in `src/core/controller/`.
   - **Frontend**: Call via generated client: `UiServiceClient.myMethod(Request.create({...}))`.
4. **Data Conversion**: If adding enums/types, update `src/shared/proto-conversions/cline-message.ts`.

## AI System Prompt & Tools
The system prompt is modular and located in `src/core/prompts/system-prompt/`.
- **Structure**: `components/` (shared logic), `variants/` (model-specific configs), `templates/`.
- **Adding Tools**:
  1. Add enum to `ClineDefaultTool` in `src/shared/tools.ts`.
  2. Create definition in `src/core/prompts/system-prompt/tools/` (export variants or `[GENERIC]`).
  3. Register in `src/core/prompts/system-prompt/tools/init.ts`.
  4. whitelist tool in `src/core/prompts/system-prompt/variants/*/config.ts` if acceptable for that model.
  5. Implement logic in `src/core/task/tools/handlers/` and `ToolExecutor.ts`.

## Key Files & Conventions
- **`CLAUDE.md`**: Read this for "tribal knowledge" and nuanced patterns.
- **Path Handling**: Always use `src/utils/path` helpers (`toPosixString`) for cross-platform compatibility.
- **Debugging**: Use `src/services/logging/Logger` for extension-side logs.

## Important Dependencies
- **State**: Custom implementations using VS Code Memento/SecretStorage.
- **UI**: React, Tailwind CSS, VS Code Webview UI Toolkit.
- **AI**: Anthropic SDK, various model providers via `src/api/`.
