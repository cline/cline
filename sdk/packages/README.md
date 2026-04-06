# Packages Overview

This directory is the single documentation source for package-level responsibilities.

- High-level package roles: this file (`packages/README.md`)
- Package interaction and runtime flows: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## Package Responsibilities

| Package | Primary responsibility | Typical consumers | Internal deps |
| --- | --- | --- | --- |
| `@clinebot/shared` | Cross-package shared primitives (path resolution, session common types, indexing helpers) | `@clinebot/agents`, `@clinebot/core`, `@clinebot/rpc`, apps | None |
| `@clinebot/llms` | Model catalog + provider settings schema + handler creation SDK | `@clinebot/agents`, `@clinebot/core`, apps | None |
| `@clinebot/scheduler` | Scheduled runtime execution service (cron, limits, execution history) | `@clinebot/rpc` | `@clinebot/shared` |
| `@clinebot/agents` | Stateless agent runtime loop (tools, hooks, extensions, teams, streaming) | `@clinebot/core`, apps | `@clinebot/llms`, `@clinebot/shared` |
| `@clinebot/rpc` | gRPC session/task/event/tool-approval/schedule gateway (server + client) | `@clinebot/core`, apps | `@clinebot/scheduler`, `@clinebot/shared` |
| `@clinebot/core` | Stateful runtime orchestration (runtime composition, session lifecycle/storage, shared persistence service with local+RPC adapters) | CLI/Desktop apps | `@clinebot/agents`, `@clinebot/llms`, `@clinebot/rpc`, `@clinebot/shared` |

## How Packages Work Together

1. `@clinebot/llms` defines model/provider capabilities and builds concrete handlers.
2. `@clinebot/agents` runs the agent loop on top of those handlers and tool execution primitives.
3. `@clinebot/core` composes runtime behavior with persistent sessions/storage and optional RPC-backed session services.
4. `@clinebot/scheduler` orchestrates cron-driven runtime execution with bounded concurrency and timeout limits.
5. `@clinebot/rpc` exposes cross-process/session orchestration APIs when runtime and control-plane need decoupling.
6. `@clinebot/shared` provides the shared contracts and path/session primitives used across the stack.

## Practical Boundary Rules

- Put provider/model schema, cataloging, and handler wiring in `@clinebot/llms`.
- Put loop/tool/hook/team execution behavior in `@clinebot/agents`.
- Put persistence, session lifecycle, and runtime assembly in `@clinebot/core`.
- Put scheduled execution and schedule persistence in `@clinebot/scheduler`.
- Put network session routing and approval/event transport in `@clinebot/rpc`.
- Put cross-package utility types and path/session constants in `@clinebot/shared`.

## Runtime Entry Points

- Node-oriented imports exist where packages expose a distinct Node alias.
- `@clinebot/core` itself is now the Node/runtime-oriented entry point for host/session services.
- Browser entry points still exist in packages that intentionally publish a browser surface, but `@clinebot/core` no longer does.

## Notes for Doc Consolidation

Nested package `README.md` and `ARCHITECTURE.md` files can be reduced or removed after references are updated to point here.
