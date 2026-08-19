# `@cline/gateway`

The Gateway is the single runtime authority for Cline: a long-lived
service (plus a lightweight lifecycle CLI) that owns mutable state, bot
registration, runtime resources, execution supervision, and one
versioned protocol for desktop, CLI, connector, local, and remote
clients.

This package contains the **Phase 0 protocol slice** and the **Phase 3
authority**: the server, the SQLite store, the singleton lock, the async
run runtime, and the CLI. Plugins, MCP pooling, connectors, schedules,
and client migrations are later phases.

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
  singleton lock, protocol, persistence, credentials, plugins, MCP pools,
  connectors, schedules, supervision.

Engine never imports bot or Gateway types; bot never imports Gateway
implementations; no new package depends on `@cline/core`. These rules are
machine-checked in `src/boundaries.test.ts` (and mirrored per-package).

## The Phase 3 authority

### Lifecycle

```
cline-gateway serve                    # run the authority in the foreground
cline-gateway start                    # ensure one is running (spawn detached, wait ready)
cline-gateway status                   # read discovery, connect, report gateway.status
cline-gateway drain                    # refuse new mutating work while runs finish
cline-gateway upgrade                  # drain, wait idle, stop, start a fresh process
cline-gateway stop                     # graceful stop
cline-gateway secret-put <providerId>  # store a provider credential (reads stdin)
```

Flags: `--data-root <dir>`, `--namespace <name>`, `--port <n>`,
`--reason <text>`. The singleton scope is the **canonical data directory
plus environment namespace** (`CLINE_GATEWAY_DATA_ROOT`,
`CLINE_GATEWAY_NAMESPACE`) — never a port.

### Startup sequence (ADR 0002)

1. Acquire the **OS-backed exclusive `gateway.lock`** (a SQLite file held
   inside a never-committed `BEGIN EXCLUSIVE`; the kernel releases it on
   process death — PID files and heartbeats are not authority). Failure
   means a live authority exists: **connect or diagnose, never replace**
   (a losing `serve` exits with code 3 and a diagnosis).
2. Open + migrate `gateway.db` (SQLite, versioned forward-only
   migrations): bots, sessions, runs, run attempts, the global event log,
   canonical message history, the idempotency ledger, the outbox, audit,
   and the client registry.
3. Manual crash recovery: abandoned attempts are **interrupted, never
   auto-resumed**; committed queued runs re-admit in FIFO order.
4. Bootstrap the default lead bot `cline`.
5. **Exclusive loopback bind** (ephemeral port by default).
6. Only after readiness: atomically write the **mode-0600 discovery
   record** (`gateway.json`) carrying the endpoint and the per-instance
   auth secret.

### Protocol

Newline-delimited JSON over loopback TCP. Every connection opens with
`gateway.hello` carrying the per-instance secret (loopback auth). Then:

- `run.start` acks **immediately** with `{runId, acceptedAt,
  queuePosition}`; execution is asynchronous (durable FIFO queue, one
  active run per session, recorded attempts with capped retry).
- `run.subscribe` replays durable events from an opaque cursor, then
  live-tails. Delivery is paged with socket backpressure — client
  projections stay bounded, and a reconnecting client resumes exactly
  where it left off.
- Server requests (tool approvals) are their own correlation space;
  pending requests survive disconnects and are re-issued on resubscribe.
- **Disconnect never implies abort** — no run transition is tied to
  connection lifecycle.
- Admission applies adaptive backpressure: a full session queue rejects
  with a retryable `run_admission_rejected`.

### Storage authority (ADR 0001)

The database is authoritative; files are projections. State changes
enqueue outbox entries in the same transaction; an outbox worker rewrites
`projections/sessions/<id>.json` idempotently and retries failures —
including across a crash between commit and file write. Managed session
workspaces live under `bots/<botId>/workspaces/<sessionId>`; bot memories
under `bots/<botId>/memories/`. Canonical message history is stored
behind the `AgentMessage` messages contract from `@cline/shared`.

### Provider credentials (ADR 0001: the Gateway owns credentials)

LLM provider keys are owner-only **mode-0600 files** in the data
directory's `secrets/` (dir 0700), one per provider (`anthropic`,
`openai`, `openrouter`, `cline`, ...). Operators either drop a file there
or pipe one in:

```
printf '%s' "$KEY" | cline-gateway secret-put anthropic
```

At execution time the Gateway resolves the run's **snapshotted** config
(provider/model captured on the run row at `run.start` — retries and
crash recovery always bind the same model, never live bot config or
in-memory overrides; the snapshot never contains a key) and injects the
credential in memory at the engine boundary: environment variables
(`CLINE_GATEWAY_API_KEY`, `ANTHROPIC_API_KEY`, ...) act as a local/dev
override, otherwise the provider's secret file is read. A missing
credential fails the attempt with a stable
`MissingProviderCredentialError` — an unauthenticated binding is never
passed to the engine. Group/world-readable "secret" files are refused,
and the key never reaches the database, event log, audit trail,
projections, or logs (machine-checked in
`src/credential-hygiene.test.ts`).

### Usage statistics (write path; Phase 7 reads it)

Statistics are collected at run/message completion time and folded into
daily aggregates immediately — queries never rescan session message
history:

```
engine model response -> model-call-completed (per-call token deltas,
duration, provider/model ids, status) -> usage normalizer -> ONE SQLite
transaction: usage_events (immutable) + daily_usage + model_usage +
agent_usage + topic_usage + streak_usage
```

Identity mapping (no parallel agent system): `agent_id` **is** the
existing `botId`; `topic_id` **is** the existing `sessionId` — both
denormalized onto each event so the mapping can diverge later without
rewriting history. Messages are counted (user/assistant) when the
canonical message is appended; the longest run duration per day is folded
in when the run reaches a terminal state.

Cost accuracy: provider-reported tokens/costs are recorded verbatim
(`cost_is_estimate = 0`); otherwise the injected `PriceResolver`'s price
snapshot is stored **on the event** and the cost is flagged as an
estimate; with no pricing the cost is NULL (flagged), never invented.
`recalculateEstimates` re-prices flagged events into `recalculated_*`
columns and shifts aggregates by the delta — original event fields are
immutable.

Read surface (RPC methods, the `GET /statistics/*` equivalents; bounded
to 400 days, aggregates only): `statistics.summary`,
`statistics.activity` (heatmap rows), `statistics.rankings`
(`dimension=model|agent|topic`), `statistics.usage` (`month=YYYY-MM`).

### What lives where

| Concern | Location |
| --- | --- |
| Wire contracts: IDs, envelopes, errors, revisions, cursors, idempotency, handshake, capabilities, run states, server requests | `@cline/shared/gateway` |
| Private command registry (`run.start`, `gateway.drain`, ...) | `src/methods.ts` |
| `gateway.hello` negotiation | `src/hello.ts` |
| Data directory layout + namespace | `src/paths.ts` |
| OS-backed exclusive lock | `src/lock.ts` |
| SQLite authority + migrations | `src/db.ts`, `src/stores.ts` |
| Discovery record + instance secret | `src/discovery.ts` |
| Provider credentials (0600 secret files) + engine injection | `src/secrets.ts`, `src/engine-binding.ts` |
| Usage/statistics pipeline (events + daily aggregates + queries) | `src/usage.ts` |
| Async runtime (queue, attempts, recovery, approvals) | `src/runtime.ts` |
| Loopback server + event replay | `src/server.ts` |
| Loopback client | `src/client.ts` |
| Outbox projections | `src/outbox.ts` |
| Lifecycle CLI | `src/cli.ts`, `bin/cline-gateway.mjs` |
| ADRs: write authority, singleton ownership, no implicit fallback | [`docs/adr/`](./docs/adr/) |
| Engine (Phase 1) | `@cline/engine` |
| Bot domain (Phase 2) | `@cline/bot` |

### Explicitly out of scope until Phase 4+

Plugins and the resource catalog, MCP pooling, connector supervision
(Telegram/Slack), schedules, sandbox/container supervision, desktop/CLI
client migration, remote/mobile access and federation — and any change to
`@cline/core` or the existing Hub, which remain fully untouched by this
package.
