# Provider Request Capture

This directory contains the SDK provider gateway and AI SDK provider adapter.
`provider-request-capture.ts` adds an opt-in local capture path for debugging
the exact prompt/request sent to a model provider.

The capture layer is provider-agnostic. It does not import Weave, W&B, OTel, or
plugin code. A plugin or external tool can correlate records by stamping
`request.options.metadata` before the request reaches `sdk/packages/llms`.

## Why This Exists

Plugin hooks can observe Cline's conversation state, but they run before Core's
final provider-message preparation. That final pass can repair missing tool
results, truncate tool outputs, rewrite stale file content, apply prompt-cache
provider options, and format messages for the provider.

For token investigations, compare these layers:

```text
Plugin-visible messages
  captureStage = pre_build_for_api
        |
        v
Core MessageBuilder.buildForApi(...)
        |
        v
AI SDK prompt passed to streamText(...)
  captureStage = ai_sdk_prompt
        |
        v
Provider client fetch(...)
  captureStage = wire_request, only when CLINE_CAPTURE_WIRE=true
        |
        v
Provider receives request
```

If token growth appears only in `wire_request`, the issue is provider
serialization. If it appears in `ai_sdk_prompt` but not `pre_build_for_api`, the
issue is in Cline's final provider formatting/build step. If it is already in
`pre_build_for_api`, the issue is upstream of the final build step.

## Environment Variables

| Variable | Values | Default | Purpose |
| --- | --- | --- | --- |
| `CLINE_CAPTURE_PROVIDER_REQUEST` | `off`, `summary`, `full` | `off` | Enables provider request capture. |
| `CLINE_CAPTURE_WIRE` | `true`, `false` | `false` | Wraps provider `fetch` to capture literal request bodies. |
| `CLINE_CAPTURE_DIR` | filesystem path | unset | Explicit output directory for capture files. |
| `CLINE_CAPTURE_CLEANUP` | `on`, `off` | `on` | Prunes old capture files. Set `off` to keep local files. |
| `CLINE_CAPTURE_MAX_PREVIEW_BYTES` | positive integer | `65536` | Full-mode payload preview byte cap. |
| `CLINE_DATA_DIR` | filesystem path | unset | Fallback base directory. Captures write to `CLINE_DATA_DIR/provider-request-captures`. |

If neither `CLINE_CAPTURE_DIR` nor `CLINE_DATA_DIR` is set, capture no-ops. This
prevents prompt content from being written into a repository working tree by
accident.

## Output

Capture writes one JSON file per captured stage:

```text
${CLINE_CAPTURE_DIR}/<captureId>.<captureStage>.<attempt>.provider-request.json
```

or, when only `CLINE_DATA_DIR` is set:

```text
${CLINE_DATA_DIR}/provider-request-captures/<captureId>.<captureStage>.<attempt>.provider-request.json
```

Files are written atomically through a temporary file and same-directory rename,
so consumers should ignore `*.tmp`. `captureId` comes from
`GatewayStreamRequest.metadata.captureId` when present; otherwise the SDK derives
a stable ID from request correlation metadata. `attempt` increments when the same
stage is captured more than once for a request, such as provider retries.

When `CLINE_CAPTURE_CLEANUP` is on, the SDK opportunistically prunes capture
files older than 24 hours. Consumers may also delete files after processing them.
Set `CLINE_CAPTURE_CLEANUP=off` when you need to keep local capture files for
manual inspection.

Each record includes:

- `timestamp`
- `captureStage`: `ai_sdk_prompt` or `wire_request`
- `attempt`
- `mode`: `summary` or `full`
- `correlation`: copied from `GatewayStreamRequest.metadata`, plus provider and model IDs
- `summary`: byte counts, estimated tokens, hashes, role counts, largest messages, reasoning/tool-result counts
- `payload`: only in `full` mode, truncated to `CLINE_CAPTURE_MAX_PREVIEW_BYTES`

Wire capture intentionally records URL, method, and body only. It does not record
headers, so authorization values are not written to capture files.

## Example

```bash
export CLINE_DATA_DIR="$(mktemp -d)"
export CLINE_CAPTURE_PROVIDER_REQUEST=summary
export CLINE_CAPTURE_WIRE=true

cline --provider openrouter --model openai/gpt-4o-mini "Say hello"

ls "$CLINE_DATA_DIR/provider-request-captures"
```

For an internal investigation where full request bodies are expected:

```bash
export CLINE_DATA_DIR="$(mktemp -d)"
export CLINE_CAPTURE_PROVIDER_REQUEST=full
export CLINE_CAPTURE_WIRE=true
export CLINE_CAPTURE_MAX_PREVIEW_BYTES=1000000
# Optional: keep files after consumers process them.
# export CLINE_CAPTURE_CLEANUP=off
```

## Correlation

The capture module reads `GatewayStreamRequest.metadata` and copies it into each
record. A plugin can stamp this metadata from a `beforeModel` hook:

```text
beforeModel hook
  returns options.metadata = { captureId, sessionId, runId, conversationId, iteration }
        |
        v
agents/core hook composition deep-merges metadata
        |
        v
GatewayStreamRequest.metadata
        |
        v
provider-request-capture.ts writes per-stage files keyed by captureId
```

The Weave tracing plugin uses this path to join local provider captures onto the
matching model span, but the SDK capture files are useful without Weave too.

## Coverage

This capture path is currently wired into the AI SDK provider adapter in
`ai-sdk.ts`. Providers that bypass `createAiSdkProvider(...)` will not emit
`ai_sdk_prompt` or `wire_request` records until they get equivalent
instrumentation.
