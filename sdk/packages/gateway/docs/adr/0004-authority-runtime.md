# ADR 0004 — Phase 3 authority runtime mechanics

**Status:** Accepted (Gateway RFC, Phase 3)

## Decisions

### The lock is an OS primitive, not a protocol

`gateway.lock` is a SQLite database held inside a never-committed
`BEGIN EXCLUSIVE` transaction. SQLite maps that onto operating-system
file locks, so the kernel releases ownership the instant the holding
process dies: a crashed authority cannot leak the lock, and a live one
cannot be displaced by deleting a file. PID files and heartbeats are
diagnostics at most — never authority. A process that fails to acquire
the lock connects to the running authority or diagnoses it; it never
kills it and never binds another port (the singleton scope is the
canonical data directory + environment namespace, not a port).

### Readiness before discovery

The discovery record (`gateway.json`, mode 0600, written atomically via
temp-file + rename) is published only after the lock is held, the
database is migrated, recovery has run, and the loopback socket is
listening. It carries the endpoint and the per-instance auth secret;
file permissions are the access control. A stale record is diagnosed
(`unreachable`), never trusted and never "taken over" by rewriting it.

### Crash recovery is manual for attempts, automatic for admission

On startup, before serving:

- Runs that were `running` are transitioned to `interrupted` and their
  open attempts settled as `interrupted`. Abandoned attempts are **never
  auto-resumed** — resuming a half-executed turn is not safe to guess
  at; the operator (or client) starts a new run explicitly.
- Runs that were `queued` were acknowledged but never attempted;
  executing them completes admission, so they are re-admitted in FIFO
  admission order. A queued run whose session no longer admits work is
  aborted with an audit trail.

### The database is authoritative; files are outbox projections

Every state change lands in SQLite first; disk projections are enqueued
in the same transaction and written asynchronously by an outbox worker
whose projectors are idempotent full rewrites. A crash between commit
and file write therefore loses nothing — the pending entry is retried on
the next drain, including after restart.

### Retry is bounded and recorded

Every execution of a run is a recorded attempt. Failed attempts retry up
to a configured cap (default 1 — no surprise re-execution) while the run
stays `running`; interrupt/abort suppress retry.

## Alternatives rejected

- `flock`/`fcntl` via native dependencies (SQLite already ships the same
  OS locks portably), lock files with PID liveness probes (PID reuse,
  heartbeat races), and socket-file existence as authority (stale files).
- Auto-resuming interrupted attempts (replays side effects with no
  idempotency guarantee at the tool layer).
- Writing projections synchronously in the request path (couples client
  latency and crash windows to disk layout; loses the retry story).
