# [experimental] @cline/replay

`@cline/replay` reads session recordings. `@cline/core` writes them: when a
hub session runs with `recording.enabled`, core's `SessionRecorder` appends raw
records under `<session-dir>/recording/`. Everything that reads those records
lives here.

## What You Get

- `exportSessionReplayBundle` — assemble a session replay bundle from local
  session storage, with redaction
- `readSessionReplayBundle` / `writeSessionReplayBundle` /
  `validateSessionReplayBundle` — bundle IO, validation and schema migrations
- `readSessionRecording` / `mergeSessionReplayEvents` — read a session's raw
  recording and merge it with its hook audit events
- `buildSessionReplayIterations` / `describeSessionReplayEvent` — the
  per-iteration playback projection
- `createSessionReplaySource` / `openSessionReplaySource` — serve recorded
  model responses, tool results and decisions
- `compareSessionReplaySessions` and related helpers — structural comparison
  of two recordings, iteration by iteration

The bundle and recording schemas, their version constants and the request
match-key hashing are defined in `@cline/shared`, so the recorder in core and
the readers here agree on the format without depending on each other.

## Dependency Direction

`@cline/replay` depends on `@cline/shared` and `@cline/core`. `@cline/core`
never imports `@cline/replay`.
