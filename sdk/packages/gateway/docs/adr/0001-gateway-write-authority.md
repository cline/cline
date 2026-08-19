# ADR 0001 — The Gateway is the only new-path writer

**Status:** Accepted (Gateway RFC, Phase 0)

## Decision

Exactly one process — the Gateway — writes new-path state: the bot
registry, sessions, runs, credentials, configs, plugins, schedules, and
memory indexes. Clients and bots never write Gateway-owned files or
databases directly.

## Consequences

- `@cline/engine` and `@cline/bot` contain no storage code at all. They
  mutate state only through injected ports (`RunResult` persistence deltas,
  repository interfaces) whose real implementations live in the Gateway.
- The invariant is machine-checked: boundary tests in `@cline/engine`,
  `@cline/bot`, and `@cline/gateway` fail if any new package imports
  filesystem, SQLite, socket, or process-spawning modules, and the shared
  contract exports `GATEWAY_WRITE_AUTHORITY = "gateway"`.
- The durable store itself (SQLite, disk projections, 0600 secrets) arrives
  in Phase 3 behind these same ports.

## Alternatives rejected

Shared-database access from clients (the source of duplicate history and
unknown-session bugs in the current Hub), and per-client local stores with
sync (multiplies conflict-resolution surface).
