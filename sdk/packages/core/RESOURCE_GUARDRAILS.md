# Adaptive Resource Guardrails

`@cline/core` resolves one versioned resource policy for each `ClineCore`
instance and passes it to local runtime, team-run, and Hub transport owners.
Direct construction of those owners resolves the same safe defaults.

## Resolution and Precedence

Values resolve in this order:

1. explicit `resourcePolicy` options
2. `CLINE_RESOURCE_*` environment variables
3. hardware-derived or fixed defaults

Every numeric value is rounded to an integer and clamped to a finite hard
range. `cline.diagnostics.policy.sources` reports whether each effective value
came from `explicit`, `environment`, `hardware`, or `default` input.

## Default Budgets

| Area | Default |
| --- | --- |
| Parallelism | available hardware parallelism |
| Process memory budget | 50% of physical memory |
| Heap memory budget | 80% of the JavaScript heap-size limit |
| Diagnostics | enabled; 5 s samples; 20 ms event-loop resolution |
| Pending prompts | 100 items; 1 MiB total; 256 KiB per item |
| Team runs | `min(8, max(1, floor(parallelism / 2)))` concurrent; 100 queued; 256 KiB per message |
| WebSocket delivery | 256 KiB soft watermark; 1 MiB hard watermark; 5 s congestion grace; 1 s close grace |
| WebSocket ingress | 1 MiB per payload |
| Streaming | 32 ms flush interval; 64 KiB batch budget |

The process-memory, heap-memory, and streaming values are policy and
diagnostic budgets. They are not process kill switches. Admission and
WebSocket budgets are actively enforced as described below.

## Overload Behavior

- Pending prompts that exceed the item, total estimated-byte, or single-item
  limit are rejected with `PendingPromptAdmissionError` and code
  `PENDING_PROMPT_ADMISSION_REJECTED`.
- Team-run messages that exceed the per-message limit, or runs that would
  exceed the bounded queue, are rejected with `TeamRunAdmissionError`.
  Dispatch also respects the global concurrent-run budget and serializes runs
  per teammate.
- Replaceable WebSocket snapshots are coalesced after the soft watermark.
  Lower-priority replaceable entries may be dropped to admit higher-priority
  work without exceeding the hard watermark.
- Persistent hard WebSocket pressure requests close code `1013` after the
  congestion grace period and physically terminates the socket after the close
  grace period.
- Oversized inbound WebSocket payloads are rejected before command handling.
- High-frequency agent runtime events carry lightweight snapshots without the
  retained transcript. The explicit `AgentRuntime.snapshot()` API continues to
  return the complete message history.
- Closing a browser Hub socket releases its session subscriptions, client
  registrations, outbound queue, and event listeners.

## Environment Overrides

All byte values are decimal integer byte counts.

| Variable | Controls |
| --- | --- |
| `CLINE_RESOURCE_MAX_PARALLELISM` | global parallelism budget |
| `CLINE_RESOURCE_PROCESS_MEMORY_LIMIT_BYTES` | process memory budget |
| `CLINE_RESOURCE_HEAP_MEMORY_LIMIT_BYTES` | heap memory budget |
| `CLINE_RESOURCE_DIAGNOSTICS_ENABLED` | diagnostics sampling (`true`/`false`, `1`/`0`, `yes`/`no`, or `on`/`off`) |
| `CLINE_RESOURCE_DIAGNOSTICS_INTERVAL_MS` | diagnostics sample interval |
| `CLINE_RESOURCE_EVENT_LOOP_RESOLUTION_MS` | event-loop delay resolution |
| `CLINE_RESOURCE_PENDING_PROMPT_MAX_ITEMS` | pending-prompt count |
| `CLINE_RESOURCE_PENDING_PROMPT_MAX_BYTES` | total pending-prompt bytes |
| `CLINE_RESOURCE_PENDING_PROMPT_MAX_ITEM_BYTES` | per-prompt bytes |
| `CLINE_RESOURCE_TEAM_RUN_MAX_CONCURRENT` | concurrent team runs |
| `CLINE_RESOURCE_TEAM_RUN_MAX_QUEUED` | queued team runs |
| `CLINE_RESOURCE_TEAM_RUN_MAX_MESSAGE_BYTES` | team-run message bytes |
| `CLINE_RESOURCE_WS_SOFT_WATERMARK_BYTES` | outbound coalescing watermark |
| `CLINE_RESOURCE_WS_HARD_WATERMARK_BYTES` | outbound hard watermark |
| `CLINE_RESOURCE_WS_CONGESTION_GRACE_MS` | time at hard pressure before close |
| `CLINE_RESOURCE_WS_CLOSE_GRACE_MS` | time between close and termination |
| `CLINE_RESOURCE_WS_MAX_INBOUND_PAYLOAD_BYTES` | inbound payload bytes |
| `CLINE_RESOURCE_STREAMING_FLUSH_INTERVAL_MS` | streaming flush interval |
| `CLINE_RESOURCE_STREAMING_MAX_BATCH_BYTES` | streaming batch budget |

The dashboard Hub keeps its existing `CLINE_HUB_WS_*` variables as
application-specific overrides over these central defaults.

## Diagnostics

Use `cline.diagnostics.getSnapshot()` for the latest process memory and event
loop sample, `sample()` for an immediate sample, and `subscribe(listener)` for
periodic updates. Call the returned unsubscribe function when the observer is
no longer needed. `cline.dispose()` stops sampling and clears observers.

## Deterministic Soak Coverage

Normal unit tests exercise bounded, repeatable long-run fixtures rather than
wall-clock benchmarks:

- 20,000 retained transcript messages across 2,000 streamed deltas
- 25,000 replaceable snapshots queued behind a slow client
- 200 socket lifecycles with 20 session subscriptions each

These fixtures assert retained state and payload boundaries. They intentionally
do not assert elapsed time or exact heap usage, which would make CI results
machine-dependent.