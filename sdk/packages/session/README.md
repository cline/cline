# [experimental] @cline/session

`@cline/session` reads session recordings. `@cline/core` writes them: when a
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
- `rebuildSessionReplayWorkspace` — rebuild a recorded workspace as a fresh
  clone at its starting checkpoint; a missing workspace, repository or
  checkpoint raises `SessionReplayEnvironmentError` instead of guessing
- `createSessionReplayPathMap` / `mapSessionReplaySessionData` /
  `compareSessionReplayEnv` — map recorded paths to a live workspace and back,
  and compare recorded and live environments
- `createSessionReplayRerun` / `collectSessionReplayRerunTurns` /
  `resolveSessionReplayRerunKinds` — run a recorded session again on a live
  core and report where it diverged (`rerun-report.json`)
- `exportSessionReplayBundleToAtif` / `validateAtifTrajectory` and the
  `Atif*` types — convert a bundle to an ATIF v1.7 trajectory and validate one
  (see [ATIF export](#atif-export))
- `importAtifTrajectory` / `importAtifTrajectoryToBundle` — convert an ATIF
  trajectory back into a replay bundle (see [ATIF import](#atif-import))

The bundle and recording schemas, their version constants and the request
match-key hashing are defined in `@cline/shared`, so the recorder in core and
the readers here agree on the format without depending on each other.

## ATIF export

`exportSessionReplayBundleToAtif(bundle, options)` converts a loaded session
replay bundle into one [Agent Trajectory Interchange Format][atif-rfc]
trajectory for the bundle's root session, and returns it with a list of
warnings. It reads only the bundle, so a redacted bundle gives a redacted
trajectory; an unredacted bundle adds a warning.

```sh
cline session export <session-id> --format atif --out trajectory.json
cline session export <bundle-dir> --format atif > trajectory.json
```

With a session id, the CLI exports a bundle (with the session's subagent and
teammate sessions) to a temporary directory, or to `--bundle <dir>` to keep
it, and converts that. The trajectory is validated before it is written, and
an invalid trajectory exits 1.

### Schema source

- Format: ATIF `ATIF-v1.7` (`ATIF_SCHEMA_VERSION`).
- Source: the Harbor repository, <https://github.com/harbor-framework/harbor>
  (Apache-2.0), at commit `0533a59c41ce435d9e59ff8c82da67f6e5b6edc7`. The
  normative definition is [`rfcs/0001-trajectory-format.md`][atif-rfc] plus
  the Pydantic models in `src/harbor/models/trajectories/`.
- Harbor publishes no JSON Schema file, so `src/atif/atif-v1.7.schema.json` is
  generated from those models with `Trajectory.model_json_schema()` by
  `scripts/generate-atif-schema.py`, which refuses any other commit. To
  regenerate:

  ```sh
  git clone https://github.com/harbor-framework/harbor /tmp/harbor
  git -C /tmp/harbor checkout 0533a59c41ce435d9e59ff8c82da67f6e5b6edc7
  pip install pydantic
  python3 scripts/generate-atif-schema.py /tmp/harbor > src/atif/atif-v1.7.schema.json
  bun biome format --write src/atif/atif-v1.7.schema.json
  ```

`validateAtifTrajectory` checks a value against the vendored schema and then
against the model validators the schema cannot express: `step_id`s run 1, 2,
3…; timestamps are ISO 8601; `model_name`, `reasoning_content`, `tool_calls`
and `metrics` appear only on agent steps; a step with `llm_call_count: 0` has
no `metrics` or `reasoning_content`; every `source_call_id` names a tool call
in the same step; a subagent ref sets `trajectory_id` or `trajectory_path`;
embedded subagents have unique `trajectory_id`s; content parts carry the
fields of their type. By default it also requires every embedded ref to
resolve to an entry in `subagent_trajectories` (`requireResolvableRefs:
false` turns that off). The tests check the validator against ajv for the
schema rules.

[atif-rfc]: https://github.com/harbor-framework/harbor/blob/0533a59c41ce435d9e59ff8c82da67f6e5b6edc7/rfcs/0001-trajectory-format.md

### Mapping

| ATIF | From the bundle |
| :--- | :--- |
| `session_id` | root `sessionId` |
| `agent.name` / `version` | `"cline"` / the producer's `hostVersion`, else `version` (both overridable) |
| `agent.model_name` | session `model` |
| `agent.tool_definitions` | tool definitions of the recorded requests, as OpenAI function definitions |
| step `source: "system"` (first) | the session's system prompt (`includeSystemPrompt: false` drops it) |
| step `source: "user"` | each run prompt; `message` is the text the model saw, `extra.cline.displayText` the text the user typed when it differs |
| step `source: "agent"` | one per iteration (one model call): the assistant message with its tool calls and their results |
| `message` / `reasoning_content` | assistant text / thinking blocks |
| `tool_calls[]` | `tool_use` blocks: `tool_call_id`, `function_name`, `arguments` |
| `observation.results[]` | one per tool call, `source_call_id` = the call id, `content` = the rendered tool result; error, timing and tool environment facts in `extra.cline` |
| `metrics.prompt_tokens` | `inputTokens` (includes cached tokens) |
| `metrics.completion_tokens` | `outputTokens` |
| `metrics.cached_tokens` | `cacheReadTokens` |
| `metrics.cost_usd` | `cost` |
| `metrics.extra.cache_creation_input_tokens` | `cacheWriteTokens` |
| `llm_call_count` | 1 on agent steps |
| `timestamp` | message `ts`, else the model call's finish time, else the iteration start |
| `subagent_trajectories[]` | subagent and teammate sessions in the bundle, each a full trajectory with `trajectory_id` = its session id, nested under the session that started it |
| `subagent_trajectory_ref` | on the result of the tool call that started the child (`spawn_agent`, configured subagent tools, `team_run_task`) |
| step `source: "system"` with `extra.context_management` | compaction: a `compactionSummary` message (`type: "compaction"`, `boundary: "replace"`), a `kind: "compaction"` message (`type: "pruning"`, `boundary: "truncate"`), the compaction sidecar (one result per compacted message), and compactions seen only in recorded requests (no boundary) |
| step `source: "system"` | injected messages and notices (`extra.cline.kind`, `role`, `displayRole`), orphan tool results |
| `final_metrics` | token and cost totals over the trajectory's agent steps plus its embedded subagents (as Harbor's agents report them); with subagents, `extra.own_metrics` and `extra.subagent_metrics` split them; `total_steps` counts this trajectory's steps |
| `extra.cline` (agent steps) | message id, iteration, turn, provider, redacted thinking count, recorded model calls (match key, attempts, usage, compaction, start and finish), decision and hook events of the iteration |
| `extra.cline` (root) | session entry, recording summary and environment segments, bundle format, schema versions, session order, producer, redaction report and environment |
| `extra.cline.replay` (every trajectory) | the session's exact bundle data: transcript, events, compaction, and for recorded sessions its request records and blobs (`includeReplayData: false` leaves it out), so [ATIF import](#atif-import) can restore the bundle |
| `notes` | that the trajectory was exported from a bundle, and how many images were replaced |

Not carried over:

- Images and other media: ATIF image parts need a file path and bundles store
  images inline, so each becomes a text placeholder (`[image omitted: …]`),
  with a warning and a note.
- Failed and retried model calls get no step; they are listed in the agent
  step's `extra.cline.modelCalls`.
- History removed by an earlier compaction: only the latest compaction state
  is stored, so earlier compactions keep their boundary step but not the
  messages they removed.
- `reasoning_effort`, token ids and logprobs: bundles do not store them.
- Hook payloads: hook events in `extra.cline.events` are the bundle's event
  summaries, not the raw hook payloads.

### Older bundles

Messages written before `iteration`, `childSessions` and `compactionSummary`
existed still export:

- Iterations come from `buildSessionReplayIterations`, which groups the
  transcript the same way the writer now numbers it.
- A child session without a link is attached to the session of its
  `parentAgentId`, else its `parentSessionId`, else the root. Within that
  session, the tool call whose `task`/`prompt` input matches the child's
  first prompt wins, then a call started within two seconds of the child;
  `team_run_task` calls match only teammates, and time alone matches only
  `spawn_agent` and `team_run_task`. With no match the ref goes on a system
  step "Started subagent session …". `extra.cline.linkedBy` on each ref says
  which rule linked it (`message`, `inferred` or `parent`), and a warning
  counts the inferred links.
- Links to children that are not in the bundle produce a warning and are
  listed under the tool result's `extra.cline.childSessions` with
  `inBundle: false`.

## ATIF import

`importAtifTrajectory(value, options)` converts an ATIF trajectory into the
input of a schema v2 replay bundle, and `importAtifTrajectoryToBundle(value,
dir, options)` writes it, adds an `import-report.json` next to the manifest
(not indexed in it), and validates the result. Every replay mode reads the
imported bundle like any other. Input that fails `validateAtifTrajectory`
throws `AtifImportError` with the schema errors in `issues`.

```sh
cline session import trajectory.json [--format atif] [--out <dir>] [--force]
cline session replay trajectory.json                  # playback
cline session replay trajectory.json --mode rerun ... # rerun
```

`session import` writes `<name>.bundle` next to the file unless `--out` is
given, and replaces an existing bundle there only with `--force` (a non-empty
directory that is not a bundle is never replaced). It exits 0 on success, 1
when the target cannot be written, and 2 when the file is missing, not JSON or
not a valid trajectory. `session replay` takes the file directly: playback
imports it into a temporary directory that is removed afterwards; a rerun
imports it into `<out>/recorded`, so the report's recorded bundle and the
`session diff` it suggests stay valid. An invalid file exits 2 in both modes.

### Two ways in

- **Restore** (`restored: "extra.cline"`): a trajectory exported by Cline
  carries each session's exact bundle data in `extra.cline.replay` and the
  session entry, recording and environment in `extra.cline`. The import
  rebuilds the bundle from that data, exports it again without the replay
  data, and keeps it only when the user and agent steps come out the same as
  in the file, across the subagent tree. The restored bundle has the same
  manifest, files and recording as the original, so strict matching by match
  key works on it. If a step was edited, the replay data is missing or does
  not parse, the import falls back to the steps with a warning saying why.
  `restore: "steps"` forces the fallback.
- **Steps** (`restored: "steps"`): any other trajectory is rebuilt from its
  steps. Sessions get `source: "atif-import"`, `recording: null`, no events,
  and an empty `cwd` and `workspaceRoot`.

### Mapping from steps

| Bundle | From ATIF |
| :--- | :--- |
| `sessionId` | `session_id`, else `trajectory_id`, else `atif-session`; duplicates get `__2`, `__3`…; a subagent without either gets `<parent>__subagent_<n>` |
| `model` / `provider` | `agent.model_name`, else the first step's `model_name` / `agent.extra.cline.provider`, else empty |
| `startedAt` / `endedAt` | first and last step `timestamp` (the import time when no step has one) |
| `transcript.systemPrompt` | `source: "system"` steps before the first user or agent step, and system steps marked `extra.cline.kind: "system-prompt"` |
| user message | each `source: "user"` step (`message` plus any observation content) |
| user message, `metadata.kind: "atif_system_step"` | later system steps; `userRunSpan: 0`, so playback shows them as injected, not as prompts |
| assistant message | each `source: "agent"` step: `reasoning_content` as a `thinking` block, `message` as text, `tool_calls[]` as `tool_use` blocks |
| `modelInfo` | `{ id: step model_name or agent.model_name, provider: provider or agent.name }` |
| `metrics` | `prompt_tokens` → `inputTokens`, `completion_tokens` → `outputTokens`, `cached_tokens` → `cacheReadTokens`, `extra.cache_creation_input_tokens` → `cacheWriteTokens`, `cost_usd` → `cost` |
| user message `<id>:observation`, `metadata.kind: "atif_observation"` | the agent step's `observation.results[]`: a `tool_result` per result with a `source_call_id` (`is_error` from `extra.cline.isError`, `extra.is_error` or `extra.isError`), text for the rest |
| `childSessions` on the assistant message | `subagent_trajectory_ref[]` on a result with a `source_call_id`, resolved against `subagent_trajectories` by `trajectory_id`, then `session_id` |
| child sessions | each embedded `subagent_trajectories[]` entry, mapped the same way, with `role: "subagent"` (or `"teammate"` when the ref says so) and `parentSessionId` |
| message `id` / `ts` / `iteration` | `<sessionId>:step-<step_id>` / the step `timestamp`, else the previous one / the playback iteration grouping |
| `metadata.atif` (messages) | step id and source, `reasoning_effort`, `is_copied_context`, step `extra`, tool call and result `extra` |
| `metadata.atif` (session) | `schema_version`, `session_id`, `trajectory_id`, agent name, version and `extra`, `notes`, root `extra` |

A step whose results leave `source_call_id` unset (Terminus 2 does this) and
that has exactly one tool call gets those results as that call's result; the
report lists this under `assumptions`.

### What a foreign file loses

The report's `unmapped` list counts these per session, with up to 20 step
ids each:

- Images: ATIF references image files by path and the bundle stores no file,
  so each becomes a text placeholder `[image <media_type>: <path>]`.
- `metrics.prompt_token_ids`, `completion_token_ids` and `logprobs`.
- `llm_call_count` above 1: the step becomes one assistant message.
- `agent.tool_definitions`: tool definitions live in recorded requests, which
  an import cannot create.
- Tool calls without a result: no `tool_result` is written.
- `subagent_trajectory_ref[].trajectory_path` and `continued_trajectory_ref`:
  files the trajectory points to are not loaded.
- `final_metrics` when no step has metrics: totals cannot be attributed.
- An embedded subagent no step references: it is imported, without a tool
  call link.

Beyond that list, a foreign file has no recording (no request records, no
match keys, no decisions or approvals), no workspace path or checkpoint, no
environment and no tool policies.

### Replaying an imported session

Playback reads the transcript and works on any valid trajectory.

A bundle without request records has no match keys, so
`createSessionReplaySource` defaults to `mode: "call-index"`: it builds one
model response per model call from the transcript
(`sessionReplayModelCallsFromTranscript`: reasoning, text, tool calls, usage,
finish reason) and serves them in call order; tool results are still served
by tool call id. Restored Cline exports keep their request records and use
`match-key`.

A rerun of a steps import needs:

- `--workspace <path>`: the bundle records no workspace. Without a
  checkpoint the workspace is copied as it is now.
- `--provider` (and usually `--model`): the provider is empty unless the
  file names one. Either flag relaxes request matching, which a bundle
  without requests skips anyway.

The rerun compares assistant text, tool calls and tool results; decisions are
not compared because the import has none, and tool results are compared by
text because ATIF keeps only their text. The report's `matches` show
`call-index`. When the session mode was not recorded, the rerun starts in
the mode the first prompt was sent with, if the prompt says.

A trajectory from another agent was produced with that agent's tools, so a
Cline rerun is expected to diverge on tool names and arguments from the first
tool call; the comparison shows where the two runs part, not a defect.

## Dependency Direction

`@cline/session` depends on `@cline/shared` and `@cline/core`. `@cline/core`
never imports `@cline/session`.
