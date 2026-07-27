# ARD-0005: Status Hub is an SQLite-backed, append-only status log in the Cline SDK

## Status

Accepted — implemented

## Metadata

- Date: 2026-07-27
- Deciders: Harrison (product), Drivecode planning
- Scope: **Cline SDK (`sdk/packages/*`), not Drive-only.** Drive is the first consumer, not the owner.
- Related: [01-architecture.md](../01-architecture.md) D2 (hub is the single writer), ARD-0002, [AHP review](#why-seq-exists)

## Product framing

Status Hub is a **changelog for every agent**. Humans want status often; agents
should volunteer it by default rather than being asked. Most updates land
quietly in the Hub where they are found on demand and where *other agents* read
them to understand project state. Only genuinely urgent updates interrupt the
human.

Two lenses over one log:

- **Board** — the current status of every subject. "Where is everything?"
- **Changelog** — every update in order. "What has happened?"

Both are read through the same paginated query, so opening the view never
materializes the whole log in the server or the tab.

## Context

Multi-agent systems need to answer two questions cheaply and constantly:

1. **Maintain** — "I am the auth-migration agent; I am now blocked on a missing credential."
2. **Use** — "What is everything currently blocked? What has the roster done in the last hour? What is the status of `drive-room/abc`?"

Today the SDK has no answer. Progress exists only as **transient hub events** —
`run.heartbeat`, `team.progress`, `iteration.started`, `session.updated`
([`hub.ts:517`](../../../../sdk/packages/shared/src/hub.ts)) — broadcast over
WebSocket and never persisted. A client that was not connected when an event
fired cannot recover it, and there is no way to query across agents at all.
`sessions.db` stores a single `status` column per session, which is lifecycle
state (`running`/`ended`), not reportable work status, and cannot express
status for work that spans sessions.

The consequence is that every multi-agent consumer invents its own status
side-channel — a JSON file, a log scrape, a bespoke table. That is the same
class of duplication that `syncTypes.ts` hand-copying represents in
[drivecode-sdk 01-problem-and-scope](../../drivecode-sdk/01-problem-and-scope.md).

## Decision

### D1. A first-class Status Hub primitive in the SDK

`@cline/shared` owns the schemas, `@cline/core` owns the store, service, and hub
ops, and everything is re-exported through `@cline/sdk`. Dependency direction
stays legal per `sdk/AGENTS.md` (`shared → llms → agents → core → apps`).

| Concern | Owner | Path |
|---|---|---|
| `StatusUpdate` / `StatusState` / `StatusQuery` zod schemas | `@cline/shared` | `sdk/packages/shared/src/status/` (new) |
| `resolveStatusDbPath()` | `@cline/shared` | `sdk/packages/shared/src/storage/paths.ts` |
| `ensureStatusSchema` | `@cline/core` | `sdk/packages/core/src/status/store/status-schema.ts` (new) |
| `SqliteStatusStore` | `@cline/core` | `sdk/packages/core/src/status/store/sqlite-status-store.ts` (new) |
| `StatusService` (publish / query / current / prune) | `@cline/core` | `sdk/packages/core/src/status/service/status-service.ts` (new) |
| Hub commands + broadcast | `@cline/core` | `sdk/packages/core/src/hub/server/handlers/status-handlers.ts` (new) |
| Public surface | `@cline/sdk` | re-export via `@cline/core/src/index.ts` |

### D2. Free-form `subject` plus attribution, not a session foreign key

A status update attaches to a caller-chosen `subject` string, `/`-delimited by
convention so prefix queries work (`drive-room/abc`, `migration/auth/step-3`).
Session, agent, and workspace are **attribution columns**, not the key.

This is a superset of the alternatives. A session-scoped status is
`subject = "session/<id>"`; a task-scoped status is `subject = "task/<id>"`.
Work that spans sessions, or that is not a Cline session at all (a CI job, an
external orchestrator), still gets a subject. Nothing has to exist first.

### D3. Dedicated `status.db`, mirroring the cron precedent

`~/.cline/db/status.db`, its own file, its own schema owned by `@cline/core` —
the same call [`cron-schema.ts`](../../../../sdk/packages/core/src/cron/store/cron-schema.ts)
already makes, and for the same reason: status lifecycle should not be coupled
to session storage, and a hot append path should not contend on the sessions DB.
WAL, `busy_timeout = 5000`, and the shared `withSqliteBusyRetry` wrapper come
free from [`@cline/shared/db`](../../../../sdk/packages/shared/src/db/sqlite-db.ts).

### D4. Append-only log with exactly one current row per subject

```sql
CREATE TABLE IF NOT EXISTS status_updates (
  update_id      TEXT PRIMARY KEY,
  seq            INTEGER NOT NULL,
  subject        TEXT NOT NULL,
  state          TEXT NOT NULL CHECK (state IN
                   ('queued','running','blocked','done','failed','cancelled')),
  headline       TEXT NOT NULL,
  detail         TEXT,
  progress       REAL,
  session_id     TEXT,
  agent_id       TEXT,
  workspace_root TEXT,
  source         TEXT NOT NULL,
  tags_json      TEXT,
  metadata_json  TEXT,
  superseded_at  TEXT,
  created_at     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS status_current_idx
  ON status_updates(subject) WHERE superseded_at IS NULL;
```

History is never mutated except to stamp `superseded_at`. "Current status of X"
is a single indexed lookup (`superseded_at IS NULL`); "history of X" is a scan
of one subject. The partial unique index makes "two current rows for one
subject" unrepresentable rather than something the service has to police.

`publish()` is one transaction: stamp the prior current row superseded, insert
the new row.

Supporting indexes:

```sql
CREATE INDEX status_subject_idx  ON status_updates(subject, seq DESC);
CREATE INDEX status_seq_idx      ON status_updates(seq DESC);
CREATE INDEX status_state_idx    ON status_updates(state, seq DESC) WHERE superseded_at IS NULL;
CREATE INDEX status_agent_idx    ON status_updates(agent_id, seq DESC);
CREATE INDEX status_session_idx  ON status_updates(session_id, seq DESC);
```

`status_state_idx` is what makes "everything currently blocked" — the query a
multi-agent supervisor runs most — an index scan rather than a table scan.

### D5. `seq` is a monotonic cursor, not a timestamp {#why-seq-exists}

Every row gets a monotonic `seq`. Consumers resume with `since: seq` instead of
a wall-clock timestamp, so a consumer that disconnects and reconnects can fetch
exactly what it missed with no clock-skew ambiguity and no duplicate delivery.

This is deliberately the mechanism the [AHP review](#context) found missing from
`HubEventEnvelope`, which has `eventId` and `timestamp` but no sequence — you
cannot detect a gap in it. The Status Hub does not repeat that. If hub events
later gain `serverSeq`, the two cursors should unify.

### D6. `LIKE` is the baseline; FTS5 is an opportunistic upgrade

"Easy to find" includes searching prose. The obvious answer is an FTS5 virtual
table over `headline` and `detail`. **Measured, FTS5 is not portable here:**

| Runtime | FTS5 | Probe |
|---|---|---|
| `bun:sqlite` (Bun 1.3.13) | **available** | `CREATE VIRTUAL TABLE … USING fts5` succeeds, `MATCH` returns rows |
| `node:sqlite` (Node 22.14.0) | **missing** | `SqliteError: no such module: fts5` |

[`loadSqliteDb`](../../../../sdk/packages/shared/src/db/sqlite-db.ts) selects
`bun:sqlite` when `globalThis.Bun` exists and `node:sqlite` otherwise — so the
**published `@cline/sdk` consumer on Node gets the runtime without FTS5.** FTS5
is therefore the exception, not the rule, and cannot be the primary design.

Decision: `query({ text })` is specified against indexed `LIKE` over `headline`
and `detail`, which works everywhere. The store probes for FTS5 once at schema
bootstrap and, where present, maintains the virtual table and uses `MATCH`
instead. Results are the same shape; ranking quality and speed differ. The probe
result is exposed on the store so a caller can report which path it is on, and
so tests can exercise both deliberately rather than by accident of runtime.

Corollary: no API may return an FTS5-only construct (`bm25()` rank, snippet
highlighting) unless it is also synthesizable on the `LIKE` path.

### D7. Hub ops make it live; the store makes it durable

New `HubCommandName`s: `status.publish`, `status.query`, `status.current`,
`status.prune`. New `HubEventName`: `status.updated`, broadcast to every
connected client on publish with the full row and its `seq`.

That is the "maintain it and use it" loop: an agent publishes through the hub
(or directly through `StatusService` when it is in-process), every other client
sees it immediately, and anyone who was not listening queries the DB with a
`since` cursor. The hub remains the single writer per D2 of
[01-architecture.md](../01-architecture.md).

### D8. Priority decides who gets interrupted

Every update carries `low | normal | high | critical`. `high` and `critical`
additionally raise `ui.notify` from the hub, which is how a status reaches the
human directly; everything else is found rather than pushed.

The default is `normal`, and the tool description tells the model explicitly
that over-using `high`/`critical` makes the signal worthless. This is the
mechanism that lets agents report *often* without becoming noise: volume goes
to the Hub, urgency goes to the person.

### D9. Agents publish through a tool, not a side channel

`report_status` is a default tool (`enableReportStatus`, on by default). Agents
publish the same way they do anything else, so status flows through the normal
model → tool → hub path and appears in the transcript.

Attribution (`sessionId`, `agentId`, `agentName`, `workspaceRoot`) is filled
from the tool context, never from model output — an agent must not be able to
file a status as some other agent. A failed publish returns a tool-level
message rather than throwing: reporting on work must never break the work.

Quality is enforced where the model actually reads it — the tool description
and the per-field `describe` text ("name the actual thing … not 'Working on the
task'"). `STATUS_REPORTING_GUIDANCE` / `withStatusReporting()` cover the
proactive half (*when* to report unprompted); the SDK has no global system
prompt, so hosts compose it in.

### D10. Retention is explicit

Status logs grow without bound. `prune({ before, keepPerSubject })` is part of
the service API from day one. Default is keep-everything — no silent deletion —
and the caller decides. A default retention policy is deferred, not assumed.

## Consequences

**Positive**

- One primitive replaces the per-consumer status side-channels.
- "What is blocked right now" is an indexed query, not a log scrape.
- Durable: status survives hub restart, unlike every existing progress event.
- `seq` gives correct resume semantics, which the current hub event stream lacks.
- Follows the cron store precedent exactly, so it is reviewable against known code.

**Negative**

- A fourth SQLite file (`sessions.db`, `cron.db`, teams, now `status.db`).
- Two search code paths to test, and the better one (FTS5) is the one most
  published-SDK consumers will *not* get. Search quality on Node is `LIKE`-grade
  until `node:sqlite` ships FTS5 or the SDK bundles its own SQLite.
- Free-form `subject` has no referential integrity — a typo'd subject is a new
  subject. Mitigated by convention and by attribution columns that *are*
  checkable, not by a constraint.
- Publish is a write on a hot path; WAL plus a dedicated file keeps it off the
  sessions DB, but a very chatty agent can still generate a lot of rows. D8 is
  the release valve.

## Alternatives considered

- **Persist the existing hub events instead.** Rejected. Hub events are a
  transport concern with no sequence, no subject, and no current-row semantics.
  Persisting them yields a log you still cannot query by "what is blocked".
- **Reuse `sessions.db`.** Rejected per D3. Couples status lifetime to session
  lifetime and puts a hot append path on the sessions DB.
- **Session/agent foreign key instead of `subject`.** Rejected per D2. Cannot
  express cross-session or non-Cline work, which is precisely the multi-agent
  case.
- **Mutable "current status" row, no history.** Rejected. Loses the audit trail,
  and multi-agent debugging is mostly *"what did it say before it got stuck"*.
- **A task table plus a status table.** Deferred, not rejected. If explicit task
  records land later, `subject = "task/<id>"` is already the join key.
- **CRDT / distributed status.** Rejected for the same reason
  [01-architecture.md](../01-architecture.md) rejected it for rooms: one writer,
  no offline multi-master.
