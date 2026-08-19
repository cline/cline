# messages.json contract — v1

This document describes the persisted session messages artifact written by
`@cline/core` at:

```
~/.cline/data/sessions/<sessionId>/<sessionId>.messages.json
```

It is the canonical replay/export artifact. Downstream consumers (for example,
ATIF converters) should be able to reconstruct a full session trajectory from
this file alone. `hooks.jsonl` in the same directory is observability/debug
telemetry and is not required for replay or export.

The schema is versioned by the top-level `version` field. This document
describes **version `1`**.

## File-level shape

```jsonc
{
  "version": 1,
  "updated_at": "2026-04-22T17:42:10.123Z",
  "agent": "lead" | "subagent" | "teammate",
  "sessionId": "<session-id>",
  "taskType": "...",              // optional; present for subagent/team runs
  "messages": [ /* see below */ ],
  "system_prompt": "..."          // optional
}
```

Producer: [`buildMessagesFilePayload`](../src/services/session-data.ts).

## Message shape

Each entry in `messages[]` is a normalized stored message:

```jsonc
{
  "id": "<stable-nanoid>",             // always present; generated if missing
  "role": "user" | "assistant",
  "content": [ /* content blocks, see below */ ],
  "ts": 1745343730123,                 // epoch ms; present on assistant turn messages
  "modelInfo": {                       // assistant only; see assistant guarantees
    "id": "claude-sonnet-4-6",
    "provider": "anthropic",
    "family": "claude-sonnet-4"        // optional
  },
  "metrics": {                         // terminal assistant message of a turn; see below
    "inputTokens": 21,
    "outputTokens": 8,
    "cacheReadTokens": 3,
    "cacheWriteTokens": 1,
    "cost": 0.13
  }
}
```

Notes:

- `role` is `"user"` or `"assistant"`. There is no distinct `"tool"` role at
  rest — tool results are embedded as `tool_result` blocks on a `user` message
  (Anthropic-native shape).
- `content` is always an array. No string-form content.

## Content block shape (Anthropic-native)

The persisted content uses the provider-native block shape, not the gateway
kebab-case shape. Valid block `type` values:

| `type`        | Fields                                                | Role      |
|---------------|-------------------------------------------------------|-----------|
| `text`        | `text: string`                                        | any       |
| `thinking`    | `thinking: string` (reasoning text)                   | assistant |
| `tool_use`    | `id: string`, `name: string`, `input: unknown`        | assistant |
| `tool_result` | `tool_use_id: string`, `content: unknown`, `is_error?: boolean` | user |

Correlation: a `tool_result.tool_use_id` matches a prior
`tool_use.id` on an assistant message. IDs are stable within the session.

Error signal on tool results: `is_error` is the single canonical field.
When set by the provider path it is normalized to boolean (`false` by default).

## Assistant turn guarantees

For each **completed** assistant turn (one the model actually produced output
for), the terminal assistant message of that turn carries:

- `modelInfo.id` (required)
- `modelInfo.provider` (required)
- `metrics.inputTokens` (required)
- `metrics.outputTokens` (required)
- `metrics.cacheReadTokens` (required; `0` allowed)
- `metrics.cacheWriteTokens` (required; `0` allowed)
- `metrics.cost` (required; `0` allowed)

If an assistant turn emits multiple assistant messages in the same run, only
the **last** assistant message of that turn carries `metrics`. Earlier
assistant messages in the same turn still carry `modelInfo`.

Enforced by
[`withLatestAssistantTurnMetadata`](../src/services/session-data.ts) and
covered by the LocalRuntimeHost e2e contract test in
[`../src/runtime/host/local-runtime-host.e2e.test.ts`](../src/runtime/host/local-runtime-host.e2e.test.ts).

## Failure and retry semantics

1. **Turn succeeds.** Terminal assistant message has full `modelInfo` +
   `metrics` as above.

2. **Turn fails before any assistant output exists.** No assistant message is
   appended. The persisted file remains a valid snapshot with no fabricated
   usage/model metadata. Consumers must not assume every completed session
   ends in an assistant message.

3. **Transient failure followed by successful retry** (for example, auth
   refresh + retry). Prior assistant messages retain their `modelInfo` and
   `metrics`; the retry's terminal assistant message carries the new turn's
   `metrics`. Prior metrics are not overwritten or dropped.

4. **Multiple assistant messages in one turn.** The last assistant message of
   that turn carries the turn's `metrics`. Earlier assistant messages in the
   same turn carry `modelInfo` but no `metrics`.

These behaviors are identical across CLI, desktop sidecar, and subagent /
team-task session paths.

## Versioning

The top-level `version` field is a number. Today it is `1`. Any
backwards-incompatible change to the shape above will increment this value.
Additive fields (new optional top-level keys, new optional message fields)
may appear without a version bump, so consumers should tolerate unknown
keys.

## Example

A golden example for v1 lives at
[`../fixtures/messages/success.messages.json`](../fixtures/messages/success.messages.json):
single turn with reasoning + tool call + tool result + final text. It is
provided as a copy-paste reference for downstream translators.

The authoritative guarantees come from the real writer path and the
end-to-end tests in
[`../src/runtime/host/local-runtime-host.e2e.test.ts`](../src/runtime/host/local-runtime-host.e2e.test.ts)
and [`../src/runtime/host/local-runtime-host.test.ts`](../src/runtime/host/local-runtime-host.test.ts); if
the example ever drifts from what the writer emits, those tests are the
source of truth.
