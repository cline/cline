# `@cline/gateway`

The Gateway is the proposed single runtime authority for Cline: a
long-lived service (plus lightweight CLI) that owns mutable state, bot
registration, runtime resources, execution supervision, and one versioned
protocol for desktop, CLI, connector, local, and remote clients.

This package currently contains the **Phase 0 slice** of the Gateway RFC.
The server itself is deliberately absent (Phase 3+).

## Gateway RFC — summary

The current Hub is a detached daemon discovered and sometimes launched by
clients; normal operations (abort, reconnect, upgrade, two installations)
have exposed lifecycle coupling: daemon replacement, stale discovery, port
collisions, lost attachments, duplicate history, unknown sessions.

The Gateway keeps Hub's durable multi-client sessions, schedules,
connectors, and remote access while adopting the strongest app-server
ideas: one named server artifact, immediate run acknowledgement,
independent events and server requests, explicit process ownership, and a
compatibility-tested wire contract.

### Package boundaries (dependency direction)

```
gateway -> bot -> engine -> agents -> llms -> shared
```

- **`@cline/engine`** owns exactly one execution: immutable `RunSpec`,
  ordered `EngineEvent`s, steer/interrupt/abort, `RunResult` + persistence
  deltas. No storage, discovery, sockets, or daemon code.
- **`@cline/bot`** owns domain semantics for one bot: immutable identity
  and roles (lead/worker/contractor), lazy sessions, immutable session
  workspaces, FIFO run admission, delegation, contractor teardown,
  memories, engine invocation — all through injected ports.
- **`@cline/gateway`** owns infrastructure and machine authority: CLI,
  singleton lease, protocol, persistence, credentials, plugins, MCP pools,
  connectors, schedules, supervision.

Engine never imports bot or Gateway types; bot never imports Gateway
implementations; no new package depends on `@cline/core`. These rules are
machine-checked in `src/boundaries.test.ts` (and mirrored per-package).

### What lives where today

| Concern | Location |
| --- | --- |
| Wire contracts: IDs, envelopes, errors, revisions, cursors, idempotency, handshake, capabilities, run states, server requests | `@cline/shared/gateway` |
| Private command registry (`run.start`, `run.steer`, ... with idempotency requirements) | `src/methods.ts` |
| `gateway.hello` negotiation | `src/hello.ts` |
| Idempotency ledger | `src/idempotency-ledger.ts` |
| ADRs: write authority, singleton ownership, no implicit fallback | [`docs/adr/`](./docs/adr/) |
| Engine (Phase 1) | `@cline/engine` |
| Bot domain (Phase 2) | `@cline/bot` |

### Explicitly out of scope until Phase 3+

Singleton lease and CLI (`serve`/`start`/`status`/`drain`/`upgrade`/`stop`),
SQLite persistence and disk projections, credentials (0600 secrets),
plugins, MCP pooling, connector supervision, schedules, sandbox/container
supervision, remote/mobile access, and any change to `@cline/core` or the
existing Hub — which remain fully untouched by this package.
