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
| `extra.cline` (root) | session entry, recording summary and environment segments, bundle format, schema versions, producer, redaction summary and environment |
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

## Dependency Direction

`@cline/session` depends on `@cline/shared` and `@cline/core`. `@cline/core`
never imports `@cline/session`.
