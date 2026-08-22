# ADR 0002 — Singleton ownership per data directory

**Status:** Accepted (Gateway RFC, Phase 0)

## Decision

Exactly one production Gateway owns a canonical local Cline data directory
(`gatewayId`). Ownership is taken via a lease; a second authority must not
attach to the same directory. A Gateway process has a distinct, non-durable
`instanceId`, so "same data, new process" is observable to clients across
restarts and upgrades.

Explicit lifecycle modes — `serve`, `start`, `status`, `drain`, `upgrade`,
`stop` — replace client-driven daemon replacement. Clients never retire the
authority.

## Consequences

- The shared contracts split `GatewayId` (durable, data directory) from
  `GatewayInstanceId` (process). Both are returned by `gateway.hello`.
- `GATEWAY_SINGLETON_OWNERSHIP = "lease"` is exported from the shared
  contracts; the lease implementation itself is Phase 3.
- Two installations running together get two data directories and two
  Gateways — never two authorities over one directory.

## Alternatives rejected

Port-file discovery with last-writer-wins (the current Hub's stale
discovery and port-collision failure modes), and PID-file locks without
lease expiry (leaks ownership across crashes).
