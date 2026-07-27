# drivecode reference

Deeper detail behind the drivecode section of the [root README](../../README.md).
Everything here is cited to code in this repo.

- [Status Hub](#status-hub)
- [Drive Mode and Spotlight](#drive-mode-and-spotlight)
- [Where the code lives](#where-the-code-lives)
- [Not implemented](#not-implemented)

## Status Hub

Design: [ARD-0005](../plans/cline-drivemode/ard/ARD-0005-status-hub.md) (Accepted — implemented).

### Storage

An append-only log in its own SQLite file, `~/.cline/db/status.db`, overridable
with `CLINE_STATUS_DB_PATH` (`sdk/packages/shared/src/storage/paths.ts:219`).
It is a separate file from `sessions.db` and `cron.db` so a hot append path does
not contend on session storage.

One row per update. A partial unique index on `subject WHERE superseded_at IS
NULL` makes "two current rows for one subject" unrepresentable, so "current
status of X" is a single indexed lookup and "history of X" is a scan of one
subject. `publish()` is one transaction: stamp the prior current row superseded,
insert the new row. Schema in
`sdk/packages/core/src/status/store/status-schema.ts`.

### `seq` is the cursor

Every row gets a monotonic `seq`. Consumers resume with `since: seq` rather than
a wall clock, so a client that disconnects and reconnects fetches exactly what it
missed with no clock-skew ambiguity and no duplicate delivery. Hub events
(`HubEventEnvelope`) carry `eventId` and `timestamp` but no sequence, so a gap in
them is undetectable; the Status Hub does not repeat that.

### Update shape

`StatusUpdate` (`sdk/packages/shared/src/status/status.ts`):

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` | `STATUS_SCHEMA_VERSION` |
| `updateId` | string | assigned by the store |
| `seq` | int | monotonic cursor, store-assigned |
| `subject` | string (1–512) | caller-chosen, `/`-delimited by convention |
| `state` | `queued \| running \| blocked \| done \| failed \| cancelled` | |
| `headline` | string (1–300) | one scannable line |
| `detail` | string (≤10 000) | optional prose |
| `priority` | `low \| normal \| high \| critical` | defaults to `normal` |
| `progress` | number 0–1 | optional |
| `sessionId`, `agentId`, `agentName`, `workspaceRoot` | string | attribution, optional |
| `source` | string | publisher surface; defaults to `sdk` |
| `tags` | string[] | |
| `metadata` | record | optional |
| `supersededAt` | ISO datetime \| null | null means this row is current |
| `createdAt` | ISO datetime | store-assigned |

`subject` is free-form and is *not* a session foreign key. A session-scoped
status is `subject = "session/<id>"`; a task-scoped one is `"task/<id>"`. Work
that spans sessions, or that is not a Cline session at all, still gets a subject.
The tradeoff is no referential integrity — a typo'd subject is a new subject.

### Query and pagination

`StatusQuery` filters on `subject`, `subjectPrefix`, `state[]`, `priority[]`,
`sessionId`, `agentId`, `workspaceRoot`, and `text` (free text over `headline`
and `detail`). `currentOnly: true` returns the newest update per subject — the
Board lens.

Pagination is keyset, not `OFFSET`: `cursor` is the `seq` of the last row you
already have, and `direction` is `older` (default) or `newer`. Offset paging
rescans skipped rows, so deep pages of a long changelog get slower the further
you scroll; keyset stays flat. `limit` defaults to 50, capped at 200
(`STATUS_PAGE_DEFAULT_LIMIT` / `STATUS_PAGE_MAX_LIMIT`).

A page comes back as `{ updates, nextCursor, hasMore }`.

### Search: LIKE baseline, FTS5 upgrade

`text` search is specified against indexed `LIKE`, which works on every runtime.
The store probes for FTS5 once at schema bootstrap and uses `MATCH` where it is
available. This matters because `loadSqliteDb` picks `bun:sqlite` when `Bun`
exists and `node:sqlite` otherwise, and `node:sqlite` on Node 22 has no FTS5 —
so the published `@cline/sdk` consumer on Node gets `LIKE`-grade search. No API
returns an FTS5-only construct (`bm25()` rank, snippet highlighting).

### Priority routes attention

`shouldPushToUser(priority)` is true for `high` and `critical` only. The status
handler raises `ui.notify` for those
(`sdk/packages/core/src/hub/server/handlers/status-handlers.ts:68`); everything
else lands in the Hub and is found on demand. That is the mechanism that lets
agents report often without becoming noise — volume goes to the Hub, urgency
goes to the person. The tool description tells the model explicitly that
over-using `high`/`critical` makes the signal worthless.

### The `report_status` tool

A default tool, on by default via `enableReportStatus`
(`sdk/packages/core/src/extensions/tools/definitions.ts:925`). Input shape is
`ReportStatusInputSchema` (`sdk/packages/core/src/extensions/tools/schemas.ts:196`):
`subject`, `state`, `headline`, and optional `detail`, `priority`, `progress`.

Attribution (`sessionId`, `agentId`, `agentName`, `workspaceRoot`) is filled
from the tool context, never from model output — an agent cannot file a status
as some other agent. A failed publish returns a tool-level message rather than
throwing: reporting on work must never break the work.

`STATUS_REPORTING_GUIDANCE` and `withStatusReporting()`
(`sdk/packages/core/src/status/guidance.ts`) cover the proactive half — *when* to
report unprompted. The SDK has no global system prompt, so hosts compose it in.

### Hub surface

Commands (`sdk/packages/shared/src/hub.ts`): `status.publish`, `status.query`,
`status.current`, `status.board`, `status.summary`, `status.subjects`,
`status.prune`.
Event: `status.updated`, broadcast to every connected client on publish with the
full row and its `seq`.

`status.board` is not `status.query` with a flag. It applies `orderBy:
"attention"` (blocked → failed → running → queued → done → cancelled) and
`includeHistoryCount`, because the client groups rows by state and, with more
subjects than fit on a page, recency order could leave every blocked row off
page 1 — the grouping would then be quietly wrong.

`status.summary` returns counts over *every* live row, independent of any page:
`{ total, byState, byAgent[{agentId, agentName, total, blocked, running}],
lastUpdatedAt }`. Counting from a page would silently under-report.

### Query options beyond filtering

| Option | Default | Effect |
|---|---|---|
| `orderBy` | `recency` | `attention` sorts by state urgency first, then `seq` |
| `includeHistoryCount` | `false` | Adds `historyCount` — total updates for that subject. One correlated count per row, so it is opt-in |
| `currentOnly` | `false` | Live rows only (one per subject) |

`previousState` is always returned when a prior update exists for the subject,
so a changelog entry can render as a transition rather than a bare state.

### Retention

`prune({ before, keepPerSubject })` is part of the service API. At least one of
the two is required. The default is keep-everything — no silent deletion; the
caller decides.

### The view

`apps/cline-hub/src/webview/src/components/views/status-view.tsx`. Board and
Changelog are the same paginated query with `currentOnly` flipped, so opening the
view never materializes the whole log. State-filter chips, free-text search, a
blocked count in the header, expandable `detail`, and Load more off `nextCursor`.
Live `status_updated` messages splice in at the top; on the Board lens an update
for a subject already on screen replaces its row rather than stacking.

## Drive Mode and Spotlight

Vision and naming: [00-vision.md](../plans/cline-drivemode/00-vision.md).
Architecture: [01-architecture.md](../plans/cline-drivemode/01-architecture.md).
Runbook: [DEMO.md](../design/drive-wireframes/DEMO.md).

### The hub is the single writer

Room state — roster, Spotlight sharer, pin, cards, mute flags, sub-mode, address
set — is owned by the hub daemon on `ws://127.0.0.1:25463` and mutated only
through hub ops. Clients hold read-only projections. There is exactly one writer
for the shared room object, so no lock and no CRDT is needed.

Ops: `call_join`, `call_leave`, `call_mute`, `call_set_stage`, `call_set_mode`,
`call_record_work`, `call_get_room`. Broadcasts: `room.snapshot`, `room.event`.

Rooms live in a `Map` in hub memory
(`sdk/packages/core/src/hub/collaboration/room.ts:35`). There is no room
persistence: a hub restart ends the room. A client that reconnects to a dead room
gets `room_not_found` and the Drive UI clears with "Room ended. Join again."

### Spotlight is a projection, not pixels

`StageState` (`sdk/packages/shared/src/drive/room.ts`) is
`{ sharer, pin, cards }`:

- `sharer` — `{ kind: "human" | "agent", participantId }` or null.
- `pin` — the human share, `{ kind: "selection" | "file" | "terminal", label, ref? }`
  or null. This is the whole of human share. There is no pixel capture.
- `cards` — agent work cards, each `{ id, category, title, summary?, workEventId?, updatedAt }`
  where category is `edit | command | test | plan | decision | other`.

Cards are a derived, last-event-wins projection over versioned session events.
Completed agent edit / command / test tools bridge to `call_record_work`, and the
new snapshot fans out to every participant. Structured events are cheaper than
pixels, searchable, privacy-clean, and honest about what an agent actually does.

Three card sources exist, in precedence order: a live hub room (`call_record_work`),
an offline local `stageReducer` over private tool events when there is no room,
and a demo fixture (`DRIVE_DEMO_FIXTURE`) under the `drive.demo` flag.

### Spotlight vs `stage`

The user-facing name is **Spotlight**, because the question it answers is *who is
in the spotlight right now*. The hub wire protocol still says `stage`:
`StageState`, `call_set_stage`, `roomSnapshot.stage`. The split is deliberate —
renaming the wire is a breaking change across `@cline/shared`, the hub handlers,
and every client. Surfaces render "Spotlight"; the protocol says `stage`.

## Where the code lives

| Concern | Path |
|---|---|
| Status schemas (`StatusUpdate`, `StatusQuery`, `StatusPage`) | `sdk/packages/shared/src/status/` |
| Status store, service, guidance | `sdk/packages/core/src/status/` |
| Status hub handlers | `sdk/packages/core/src/hub/server/handlers/status-handlers.ts` |
| `report_status` schema / definition / executor | `sdk/packages/core/src/extensions/tools/` |
| Room, participant, Spotlight (`stage`) schemas | `sdk/packages/shared/src/drive/` |
| Room state and `call_*` ops | `sdk/packages/core/src/hub/collaboration/` |
| Spotlight UI, call chrome | `apps/cline-hub/src/webview/src/drive/` |
| Status Hub view | `apps/cline-hub/src/webview/src/components/views/status-view.tsx` |
| Cline brand tokens | `apps/cline-hub/src/webview/src/index.css` |

## Not implemented

Stated plainly so nobody plans around it:

- **WebRTC / pixel screen share.** Not implemented, and an explicit anti-pattern
  for the agent Spotlight path. Human share is the structured pin only.
- **Room persistence.** Rooms are in-memory; a hub restart ends the room.
- **The Drive tab.** The planned sidebar IA of channels and call rooms is a
  wireframe prototype ([drive-tab-discord-slack.html](../design/drive-wireframes/drive-tab-discord-slack.html)),
  not a hub route. The shipped entry point is Chat → **Join call**.
- **Recruit ranking and RosterPack runtime.** Planned, not built.
- **Multi-human rooms.** The room primitive carries `participants[]` so it does
  not need a rewrite later, but no multi-human media plane exists.
