# SDK extension Git observations

Only the SDK-backed extension's `cline` and `cline-pass` sessions emit
`task.git_snapshot`. The host's ordinary telemetry consent gate applies, including
VS Code's setting. Organization telemetry overrides do not bypass this gate.
No fetch wrapper or new request hook is installed. Prompts and backend exports
are unchanged; other clients do not collect Git telemetry through this feature.

## Observation boundaries

- `chat_open`: opening/reopening a session (also a session rebuild).
- `model_call`: `beforeModel` schedules a fresh Git read in the background.
  `afterModel` supplies the surfaced response's backend request ID when available.
  The event is emitted when both are ready. Neither hook waits for Git.
- `agent_yield`: the runtime emits `run-finished` or `run-failed`, including
  completion, failure, and cancellation. Tool-approval waits are not run endings.
- `idle_head_changed`: VS Code Git reports a HEAD change while the run is idle;
  a fresh Git read confirms a change. Ordinary file edits/staging do not emit
  idle events. There is no polling.

`model_call` is a **concurrent observation**, not an atomic pre-request snapshot.
A read can include changes after dispatch or even after a fast model response.
`observed_at` is when the Git read starts, not the HTTP dispatch or log-arrival time.
Only the session's main agent is observed, not inherited subagent hooks. Internal
HTTP retries share the model-call observation; independent compaction calls do
not pass through these hooks. Early failure/cancellation may skip `afterModel`;
then there is no model-call event, but run-end Git capture still applies.

Observation stops when the host stops the session (switching tasks/new chat) or
is disposed. SDK `ended` alone does not close a chat: both normal and restored
windows keep observing while that conversation remains open, including after a
runtime failure. Bootstrap cleanup disposes only observers that never opened
(e.g. failed starts). Hiding the sidebar does not stop observation. Git-extension
unavailability only disables idle detection; boundary reads still work. Opening a repository
later can attach the listener. Idle detection and shutdown delivery are best
effort, not an exhaustive reflog. Commits can occur between observations.

## LogAttributes contract (schema_version = 1)

| Attribute | Meaning |
| --- | --- |
| `sessionId`, `ulid` | SDK session ID, the same opaque string sent as `X-Task-ID` |
| `providerId` | `cline` or `cline-pass` |
| `workspace_id` | HMAC-SHA-256 of session ID + NUL + resolved starting directory, keyed with an unexported process-local random secret; distinguishes worktrees without allowing candidate-path confirmation from telemetry |
| `observation_window_id` | Random ID per opening/rebuild; sequence numbers restart in each window |
| `observation_sequence` | Increasing sequence assigned when a Git read starts; gaps are possible |
| `observed_at` | Client UTC time when the Git read starts, not commit time |
| `boundary` | One of the boundaries above |
| `runId`, `iteration`, `agentId` | Runtime context when available; not HTTP-attempt identity |
| `request_id` | Returned HTTP `X-Request-ID` on `model_call`, when available and valid; never the provider's generation ID |
| `request_id_status` | `present` or `missing` on model-call observations |
| `preceding_request_id` | Last completed, observed model call's response ID, on non-model boundaries when available |
| `git.state` | `ok`, `unborn` (no commits), `non_git`, or `unavailable` |
| `git.head_sha` | Full actual HEAD object ID; absent when there is no readable commit |
| `git.branch` | Branch name; absent for detached HEAD or unavailable state |
| `git.dirty` | Staged, unstaged, or non-ignored untracked changes; absent when status is unavailable |
| `git.remote_url` | Sanitized origin fetch URL, or first fetch remote if origin is absent |
| `git.remote_state` | `ok`, `none`, `unsupported` (including local paths), or `unavailable` |

`CORE_TELEMETRY_EVENTS.TASK.GIT_SNAPSHOT` and the typed `captureGitSnapshot` helper
own the event contract. The existing OTEL adapter flattens `git` into dotted
attributes. These are log attributes, never metric labels; no new producer-side
database columns are needed. The usual SDK identity/device metadata accompanies
the event.

Reads use the session's fixed starting directory, not the terminal's changing
cwd. Each Git subprocess has a 1-second timeout and 1-MiB output limit. Failed or
oversized status reads produce `unavailable`, never a stale SHA presented as fresh.
Status and remote reads are not atomic. URL userinfo, query strings, and fragments
are removed; local/unsupported remotes are omitted. No file names, contents, diffs,
commit messages, absolute local paths, or Git stderr are logged. The workspace-ID
key is neither persisted nor transmitted. IDs stay stable for a task/directory
within an extension-host process and rotate on restart; do not use them to join
workspaces across host restarts. These IDs are not access-control tokens.

## Future dataset integration (not implemented here)

`core-platform` uses `X-Task-ID` for the task and its response `X-Request-ID` for
GCS `requests/*.json`'s `requestId`. `(sessionId, request_id)` can identify that
exported request without timestamp guessing, but does not assert the Git read
preceded it. IDs discarded by internal retries are not exported here. If the AI
SDK executes multiple internal steps, only the final surfaced step's ID is used.
Missing IDs remain unjoined; never substitute a generation ID or guess by time.

The prompt-derived GCS `workspaces` fields are **not refreshed** by these logs.
`ai-data-suite` currently deduplicates request hashes into a task-level list;
a future consumer must preserve these observations to build a timeline. No
collector/exporter/parser changes are included. HEAD movement is not proof that
a user accepted agent code. A SHA plus dirty flag cannot reconstruct uncommitted
files or make private/unpushed commits accessible.
