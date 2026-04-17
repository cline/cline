# @clinebot/scheduler

`@clinebot/scheduler` provides scheduled execution primitives used by the RPC server.

## Scope

- Persist schedule definitions and execution history in `sessions.db`
- Evaluate cron patterns and compute upcoming runs
- Enforce global and per-schedule concurrency limits
- Execute schedules through injected runtime handlers
- Coordinate due runs with transactional DB claims + renewable leases to avoid duplicate scheduling across concurrent tickers/restarts

## Main APIs

- `ScheduleStore`: CRUD for schedules and execution history
- `SchedulerService`: runtime service that polls due schedules and executes them
- `ResourceLimiter`: bounded concurrency helper
- `getNextCronRun` / `assertValidCronPattern`: cron utilities

## Storage

Tables are created in the same SQLite DB as sessions (`~/.cline/data/db/sessions.db` by default):

- `schedules`
- `schedule_executions`

Schema creation is delegated through `@clinebot/shared/db` `ensureSessionSchema(...)`.

## Developer Verification

- `bun -F @clinebot/scheduler test`: run scheduler unit tests (Vitest).
- `bun -F @clinebot/scheduler verify:routines`: run a deterministic routine lifecycle smoke check (create/list/pause/resume/trigger/stats/delete) against a temporary SQLite DB with mocked runtime handlers.
