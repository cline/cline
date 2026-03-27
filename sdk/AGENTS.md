---
description: Onboarding + architecture guide for the Cline SDK.
globs: "*.ts,*.tsx,*.js,*.jsx,*.json,*.md"
alwaysApply: true
---

# Cline SDK Guide

This repository is a WIP framework for building and orchestrating AI agents. Full refactors are encouraged as we iterate on the core foundation.

## Workspace Map

- **Packages:**
  - `@clinebot/shared`: Common types, paths, and helpers.
  - `@clinebot/llms`: Provider schemas and model catalog.
  - `@clinebot/scheduler`: Cron orchestration and task scheduling (SQLite-backed).
  - `@clinebot/agents`: Stateless runtime loop, tools, and hooks.
  - `@clinebot/rpc`: Control-plane APIs and chat bridge.
  - `@clinebot/core`: Stateful orchestration, sessions, and storage.
- **Apps:** `cli`, `code` (Next.js/Tauri), `desktop` (Next.js/Tauri), `vscode` (Extension).

## Architecture

```mermaid
flowchart TD
  shared["@clinebot/shared"] --> llms["@clinebot/llms"] & agents["@clinebot/agents"] & rpc["@clinebot/rpc"] & core["@clinebot/core"]
  llms --> agents & core
  scheduler["@clinebot/scheduler"] --> rpc
  agents --> core
  rpc --> core
  core --> apps["CLI / VSCode / Desktop"]
```

## Runtime Flows

### Core Execution
1. **Host** builds a runtime via `@clinebot/core`.
2. **Core** composes tools/policies and invokes `@clinebot/agents`.
3. **Agents** use `@clinebot/llms` for model interactions.
4. **Core** persists session state and artifacts (logs, messages).

### Bootstrap & RPC
- **CLI**: Direct CLI runs default to local in-process sessions. RPC-backed hosts still use `CLINE_RPC_ADDRESS` as a preferred base address, but bootstrap is owner-scoped rather than machine-global: startup paths take a lock under `~/.cline/data/locks/`, reuse the current install's compatible sidecar when available, and otherwise start a fresh background RPC sidecar for that build without requiring users to restart older listeners manually.
- **UI Apps**: Use Tauri or Extension hosts to ensure a compatible RPC server and communicate via WebSocket or gRPC bridges.
- **Connectors**: Background bridges (Telegram, WhatsApp, etc.) that map external threads to RPC sessions.
- **Hooks**: Direct local CLI runs own one persistent `hook-worker` per CLI runtime; RPC-backed sessions share one persistent hook service owned by the RPC server process.

## Core Features

- **Tool Approvals**: Hooks can return `review: true` to force host-side approval for specific calls (e.g., `git` commands).
- **Model Routing**: Automatic tool selection (e.g., `apply_patch` vs `editor`) based on the active model and provider.
- **OAuth**: Token refresh is managed centrally by `@clinebot/core`.
- **Interactive Queueing**: Prompt queue and steer behavior are owned by `@clinebot/core`; app hosts should consume core queue events instead of duplicating pending-turn execution logic.
- **Sub-agents**: `spawn_agent` automatically inherits workspace metadata and prompt context.
- **Error Handling**: Immediate failure for non-recoverable errors; retries for transient failures.

## Storage & Paths

All data is rooted at `~/.cline/data` (overridable via `CLINE_DATA_DIR`).

- **`SqliteSessionStore`**: Session metadata and status.
- **`ArtifactStore`**: Append-only logs, hooks, and message history.
- **`ProviderSettingsManager`**: JSON-based provider configuration.
- **Search Paths**: Configs are loaded from workspace roots (`.clinerules/`, `.cline/`) and global directories.

## Development Workflow

### Essential Commands
- `bun run build`: Build SDK and CLI.
- `bun run dev`: Build SDK and CLI in development mode.
- `bun run cli`: Run CLI interactively.
- `bun run test`: Run the Vitest suite.
- `bun run lint / format / fix`: Code quality and formatting.

### Rebuilding
Changes to `packages/*` require a rebuild (`bun run build:sdk`). Direct CLI runs pick up rebuilt code immediately; RPC-backed hosts auto-replace their owner-scoped sidecar when the current build changes. If you touch CLI/RPC bootstrap, preserve the startup lock and owner-scoped discovery behavior so multiple builds can coexist safely. Use `dev:*` scripts for automatic rebuilding during development.

### Publishing SDK Packages
- Source workspace manifests must keep real workspace dependencies declared so `bun install` and local builds resolve correctly.
- Published runtime workspace packages stay in `dependencies`. Bundled internal workspace packages must live in `devDependencies` so they do not leak into packed manifests.
- `bun scripts/version.ts <version>` updates all workspace package versions in place, refreshes generated models, formats the repo, and runs `bun run build` so the post-bump artifacts match the release version.
- `bun scripts/check-publish.ts` packs the publishable packages with `bun pm pack`, installs them together in an isolated temp directory, and verifies imports.
- `bun publish` resolves published `workspace:*` dependencies to concrete versions when it packs the tarball.
- Manual publish guide:
  1. Run `bun run test` from the repo root.
  2. Choose the release version like `0.0.21`.
  3. Run `bun scripts/version.ts <version>` to update all workspace package versions and rebuild from the bumped versions.
  4. Review the changed `package.json` files and generated model artifacts before publishing.
  5. Run `bun scripts/check-publish.ts` to verify the packed SDK tarballs install and import together.
  6. Publish in dependency order:
     `cd packages/shared && bun publish`
     `cd ../llms && bun publish`
     `cd ../agents && bun publish`
     `cd ../core && bun publish`
  7. If you are doing a tagged production release, create and push the corresponding git tags after publish.
- CI publish flow in `.github/workflows/publish-sdk.yaml` follows the same order: build, version, `check:publish`, then publish `shared -> llms -> agents -> core`.

### Change Routing
- **Model/Provider schemas**: `@clinebot/llms`
- **Scheduling/Cron**: `@clinebot/scheduler`
- **Agent loop/tools**: `@clinebot/agents`
- **Sessions/Storage/Lifecycle**: `@clinebot/core`
- **RPC contracts**: `@clinebot/rpc`
