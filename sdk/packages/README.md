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
| `@cline/hub` | Hub discovery, client transport, and managed standalone-daemon lifecycle | `@cline/core`, `@cline/hub-daemon`, apps | `@cline/shared` |
| `@cline/core` | Stateful runtime orchestration (runtime composition, session lifecycle/storage, local and Hub-backed runtime hosts) | `@cline/hub-daemon`, CLI/Desktop apps | `@cline/agents`, `@cline/hub`, `@cline/llms`, `@cline/shared` |
| `@cline/hub-daemon` | Standalone Hub server and Core runtime composition | CLI/Desktop app Hub executables | `@cline/core`, `@cline/hub` |
| `@cline/ui` | Internal framework-neutral web theme, Tailwind adapter, and optional base styles | Cline web apps | None |

## How Packages Work Together

1. `@cline/llms` defines model/provider capabilities and builds concrete handlers.
2. `@cline/agents` runs the agent loop on top of those handlers and tool execution primitives.
3. `@cline/core` composes runtime behavior with persistent sessions/storage and local or hub-backed runtime services.
4. `@cline/hub` discovers or launches a version-compatible standalone daemon and exposes session-oriented client APIs (`HubSessionClient`, `HubUIClient`).
5. `@cline/hub-daemon` composes the WebSocket server, scheduled execution, and Core runtime authority without creating a Core-to-daemon dependency cycle.
6. `@cline/shared` provides the shared contracts and path/session primitives used across the stack.

## Practical Boundary Rules

- Put provider/model schema, cataloging, and handler wiring in `@cline/llms`.
- Put loop/tool/hook/team execution behavior in `@cline/agents`.
- Put persistence, session lifecycle, and runtime assembly in `@cline/core`.
- Put scheduled execution and schedule persistence in Core services, exposed to the standalone server through `@cline/core/hub-runtime`.
- Put Hub discovery, attach flows, lifecycle ownership, and client adapters in `@cline/hub`.
- Put the Hub server and daemon entrypoint in `@cline/hub-daemon`.
- Put cross-package utility types and path/session constants in `@cline/shared`.
- Put remote-config schemas, materialization, telemetry normalization, and blob upload primitives in `@cline/shared/remote-config`.
- Put shared web tokens and visual foundations in `@cline/ui`; keep fonts,
  shell layout, and product-specific animation with each consuming app.

## Runtime Entry Points

- Node-oriented imports exist where packages expose a distinct Node alias.
- `@cline/core` itself is now the Node/runtime-oriented entry point for host/session services.
- Browser entry points still exist in packages that intentionally publish a browser surface, but `@cline/core` no longer does.

## Notes for Doc Consolidation

Nested package `README.md` and `ARCHITECTURE.md` files can be reduced or removed after references are updated to point here.
