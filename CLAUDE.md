# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

### Common Commands

```bash
# Setup
npm run install:all          # Install all dependencies (extension + webview)
npm run protos               # Generate Protocol Buffer files (required before first build)

# Development
npm run dev                  # Generate protos + watch mode (use this for development)
npm run watch                # Watch mode only (if protos already generated)
F5 in VS Code                # Launch extension in debug mode

# Testing
npm run test                 # Run all tests (unit + integration)
npm run test:unit            # Unit tests only
npm run test:e2e             # E2E tests with Playwright
UPDATE_SNAPSHOTS=true npm run test:unit  # Update prompt snapshots after changes

# Code Quality
npm run lint                 # Check for lint errors
npm run format:fix           # Auto-format code
npm run check-types          # TypeScript type checking

# PR Workflow
npm run changeset            # Create changeset for user-facing changes (patch only)
```

### Build Verification

This is a VS Code extension. Use `npm run compile` (not `npm run build`) to verify builds.

## Architecture Overview

Beadsmith is a VS Code extension with a TypeScript backend and React webview frontend, communicating via gRPC-over-postMessage.

### Data Flow

```
extension.ts → webview/ → controller/ → task/
     │              │           │          │
     │              │           │          └─ Executes API requests, runs tools
     │              │           └─ Handles webview messages, manages state
     │              └─ Manages webview lifecycle
     └─ Extension entry point
```

### Key Directories

| Path | Purpose |
|------|---------|
| `src/core/controller/` | Request handlers, state management, gRPC handlers |
| `src/core/task/` | Task execution loop, tool handlers |
| `src/core/prompts/system-prompt/` | Model-specific prompts with variants |
| `src/shared/` | Types shared between extension and webview |
| `src/integrations/` | Terminal, git, browser integrations |
| `webview-ui/src/` | React frontend |
| `proto/beadsmith/` | Protocol Buffer definitions |
| `src/generated/` | Auto-generated from protos (gitignored) |

### Proto Generation Pipeline

```
state-keys.ts ──generates──► state.proto ──generates──► src/generated/*
                                                              │
                                                              ▼
proto/beadsmith/*.proto ──────────────────────────────► src/shared/proto/*
```

**Always run `npm run protos` after modifying:**
- Any `.proto` file in `proto/beadsmith/`
- `src/shared/storage/state-keys.ts`

## Detailed Documentation

The following files contain critical non-obvious patterns and gotchas:

@.beadsmithrules/general.md
@.beadsmithrules/network.md
