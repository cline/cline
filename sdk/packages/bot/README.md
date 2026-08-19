# `@cline/bot`

Bot domain semantics — **Phase 2 of the Gateway RFC** (see
`sdk/packages/gateway/README.md` for the full design).

## What it owns

Domain semantics for one bot, entirely behind injected ports:

- **Identity**: immutable ID, role, parent, provenance. Roles are `lead`,
  `worker`, `contractor` (`sandbox` is not a role). The first bot is
  `cline` with role `lead`. Roles are immutable — there is no promotion
  path, and the repositories reject identity mutations.
- **Topology**: only a lead delegates (workers/contractors, never a new
  lead). Workers message their lead; worker-to-worker messaging is
  disabled by default.
- **Sessions**: created lazily, only with the first *accepted* prompt. The
  session workspace is immutable after creation.
- **Runs**: one mutating root run per session, FIFO admission with an
  immediate `{runId, acceptedAt, queuePosition}` acknowledgement (shared
  contract). Steering merges into the active run. Disconnect never
  implies abort.
- **Contractors**: exactly one task; on completion the bot is retired
  (record retained) and its session closed.
- **Per-turn overrides**: merge over the bot config for a single run.
- **Memories**: file-backed discovery from `memories/` via a
  `MemorySource` port.
- **Execution**: engine invocation through an `EnginePort`;
  `createEngineExecutionPort` adapts the port onto the real
  `@cline/engine`.

## What it deliberately does not do

No SQLite, no file watching, no sockets, no spawned children. Repositories,
resource bindings, clocks, IDs, and worker execution arrive as ports whose
real implementations belong to the Gateway (Phase 3+). All domain tests run
with the in-memory ports in [`src/in-memory.ts`](./src/in-memory.ts).

The dependency rules (`bot -> engine`, never `bot -> gateway` or
`bot -> core`) are machine-checked in [`src/boundaries.test.ts`](./src/boundaries.test.ts).
