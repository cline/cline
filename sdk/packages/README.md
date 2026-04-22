# Packages Overview

This directory is the single documentation source for package-level responsibilities.

- High-level package roles: this file (`packages/README.md`)
- Package interaction and runtime flows: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## Package Responsibilities

| Package | Primary responsibility | Typical consumers | Internal deps |
| --- | --- | --- | --- |
| `@clinebot/shared` | Cross-package shared primitives (path resolution, session common types, indexing helpers) | `@clinebot/agents`, `@clinebot/core`, apps | None |
| `@clinebot/llms` | Model catalog + provider settings schema + handler creation SDK | `@clinebot/agents`, `@clinebot/core`, apps | None |
| `@clinebot/agents` | Stateless agent runtime loop (tools, hooks, extensions, teams, streaming) | `@clinebot/core`, apps | `@clinebot/llms`, `@clinebot/shared` |
| `@clinebot/core` | Stateful runtime orchestration (runtime composition, session lifecycle/storage, local and hub runtime services, hub discovery and client helpers) | CLI/Desktop apps | `@clinebot/agents`, `@clinebot/llms`, `@clinebot/shared` |
| `@clinebot/enterprise` | Enterprise composition layer (identity resolution, remote control plane sync, policy materialization, telemetry configuration) | Apps with enterprise/org management | `@clinebot/agents`, `@clinebot/shared` |

## How Packages Work Together

1. `@clinebot/llms` defines model/provider capabilities and builds concrete handlers.
2. `@clinebot/agents` runs the agent loop on top of those handlers and tool execution primitives.
3. `@clinebot/core` composes runtime behavior with persistent sessions/storage and local or hub-backed runtime services.
4. `@clinebot/core` hub services orchestrate scheduled runtime execution, execution history, and schedule command handling.
5. `@clinebot/core/hub` exposes discovery, the detached hub daemon, and session-oriented client APIs (`HubSessionClient`, `HubUIClient`) when hosts need a shared daemon.
6. `@clinebot/shared` provides the shared contracts and path/session primitives used across the stack.
7. `@clinebot/enterprise` sits on top of `@clinebot/core` and `@clinebot/agents` to sync identity, fetch remote config bundles, materialize managed instructions to disk, and register the result as an `AgentExtension`.

## Practical Boundary Rules

- Put provider/model schema, cataloging, and handler wiring in `@clinebot/llms`.
- Put loop/tool/hook/team execution behavior in `@clinebot/agents`.
- Put persistence, session lifecycle, and runtime assembly in `@clinebot/core`.
- Put scheduled execution and schedule persistence in `@clinebot/core` hub services.
- Put hub discovery, attach flows, and session-oriented client adapters in `@clinebot/core/hub`.
- Put cross-package utility types and path/session constants in `@clinebot/shared`.
- Put identity resolution, control plane sync, policy materialization, and enterprise telemetry in `@clinebot/enterprise`.

## Runtime Entry Points

- Node-oriented imports exist where packages expose a distinct Node alias.
- `@clinebot/core` itself is now the Node/runtime-oriented entry point for host/session services.
- Browser entry points still exist in packages that intentionally publish a browser surface, but `@clinebot/core` no longer does.

## Notes for Doc Consolidation

Nested package `README.md` and `ARCHITECTURE.md` files can be reduced or removed after references are updated to point here.
