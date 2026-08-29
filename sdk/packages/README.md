# Packages Overview

This directory is the single documentation source for package-level responsibilities.

- High-level package roles: this file (`packages/README.md`)
- Package interaction and runtime flows: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## Package Responsibilities

| Package | Primary responsibility | Typical consumers | Internal deps |
| --- | --- | --- | --- |
| `@cline/shared` | Cross-package shared primitives (path resolution, session common types, indexing helpers) | `@cline/agents`, `@cline/core`, apps | None |
| `@cline/llms` | Model catalog + provider settings schema + handler creation SDK | `@cline/agents`, `@cline/core`, apps | None |
| `@cline/agents` | Stateless agent runtime loop (tools, hooks, extensions, teams, streaming) | `@cline/core`, apps | `@cline/llms`, `@cline/shared` |
| `@cline/core` | Stateful runtime orchestration (runtime composition, session lifecycle/storage, local and hub runtime services, hub discovery and client helpers) | CLI/Desktop apps | `@cline/agents`, `@cline/llms`, `@cline/shared` |
| `@cline/ui` | Shared presentation: web theme + React primitives, OpenTUI terminal UI (`/tui`), and UI protocol re-exports (`/protocol`) | Cline web apps, CLI, terminal hosts | `@cline/shared` (`@cline/llms` peer for `/tui`) |

## How Packages Work Together

1. `@cline/llms` defines model/provider capabilities and builds concrete handlers.
2. `@cline/agents` runs the agent loop on top of those handlers and tool execution primitives.
3. `@cline/core` composes runtime behavior with persistent sessions/storage and local or hub-backed runtime services.
4. `@cline/core` hub services orchestrate scheduled runtime execution, execution history, and schedule command handling.
5. `@cline/core/hub` exposes discovery, the detached hub daemon, and session-oriented client APIs (`HubSessionClient`, `HubUIClient`) when hosts need a shared daemon.
6. `@cline/shared` provides the shared contracts and path/session primitives used across the stack.

## Practical Boundary Rules

- Put provider/model schema, cataloging, and handler wiring in `@cline/llms`.
- Put loop/tool/hook/team execution behavior in `@cline/agents`.
- Put persistence, session lifecycle, and runtime assembly in `@cline/core`.
- Put scheduled execution and schedule persistence in `@cline/core` hub services.
- Put hub discovery, attach flows, and session-oriented client adapters in `@cline/core/hub`.
- Put cross-package utility types and path/session constants in `@cline/shared`.
- Put remote-config schemas, materialization, telemetry normalization, and blob upload primitives in `@cline/shared/remote-config`.
- Put shared web tokens and visual foundations in `@cline/ui`; keep fonts,
  shell layout, and product-specific animation with each consuming app.
- Put reusable terminal presentation in `@cline/ui/tui`; keep runtime-owned
  surfaces (provider auth, accounts, session history, onboarding) in the host
  and inject them through the documented host interfaces.
- Put canonical UI protocol contracts in `@cline/shared` (`src/ui/`); hosts
  extend the unions locally instead of duplicating them.

## Runtime Entry Points

- Node-oriented imports exist where packages expose a distinct Node alias.
- `@cline/core` itself is now the Node/runtime-oriented entry point for host/session services.
- Browser entry points still exist in packages that intentionally publish a browser surface, but `@cline/core` no longer does.

## Notes for Doc Consolidation

Nested package `README.md` and `ARCHITECTURE.md` files can be reduced or removed after references are updated to point here.
