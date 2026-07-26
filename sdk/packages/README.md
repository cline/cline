# Packages Overview

This directory is the single documentation source for package-level responsibilities.

- High-level package roles: this file (`packages/README.md`)
- Package interaction and runtime flows: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## Package Responsibilities

| Package | Primary responsibility | Typical consumers | Internal deps |
| --- | --- | --- | --- |
| `@bedrock-coder/shared` | Cross-package shared primitives (path resolution, session common types, indexing helpers) | `@bedrock-coder/agents`, `@bedrock-coder/core`, apps | None |
| `@bedrock-coder/llms` | AWS Bedrock model construction and streaming | `@bedrock-coder/agents`, `@bedrock-coder/core`, apps | `@bedrock-coder/shared` |
| `@bedrock-coder/agents` | Stateless agent runtime loop (tools, hooks, extensions, teams, streaming) | `@bedrock-coder/core`, apps | `@bedrock-coder/llms`, `@bedrock-coder/shared` |
| `@bedrock-coder/core` | Stateful runtime orchestration (runtime composition, session lifecycle/storage, local and hub runtime services, hub discovery and client helpers) | VS Code extension | `@bedrock-coder/agents`, `@bedrock-coder/llms`, `@bedrock-coder/shared` |

## How Packages Work Together

1. `@bedrock-coder/llms` constructs the configured Bedrock model and streaming handler.
2. `@bedrock-coder/agents` runs the agent loop on top of those handlers and tool execution primitives.
3. `@bedrock-coder/core` composes runtime behavior with persistent sessions/storage and local or hub-backed runtime services.
4. `@bedrock-coder/core` hub services orchestrate scheduled runtime execution, execution history, and schedule command handling.
5. `@bedrock-coder/core/hub` exposes discovery, the detached hub daemon, and session-oriented client APIs (`HubSessionClient`, `HubUIClient`) when hosts need a shared daemon.
6. `@bedrock-coder/shared` provides the shared contracts and path/session primitives used across the stack.

## Practical Boundary Rules

- Put Bedrock model configuration and handler wiring in `@bedrock-coder/llms`.
- Put loop/tool/hook/team execution behavior in `@bedrock-coder/agents`.
- Put persistence, session lifecycle, and runtime assembly in `@bedrock-coder/core`.
- Put scheduled execution and schedule persistence in `@bedrock-coder/core` hub services.
- Put hub discovery, attach flows, and session-oriented client adapters in `@bedrock-coder/core/hub`.
- Put cross-package utility types and path/session constants in `@bedrock-coder/shared`.

## Runtime Entry Points

- Node-oriented imports exist where packages expose a distinct Node alias.
- `@bedrock-coder/core` itself is now the Node/runtime-oriented entry point for host/session services.
- Browser entry points still exist in packages that intentionally publish a browser surface, but `@bedrock-coder/core` no longer does.

## Notes for Doc Consolidation

Nested package `README.md` and `ARCHITECTURE.md` files can be reduced or removed after references are updated to point here.
