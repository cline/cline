# 12 · Drive performance architecture

Back to [README](README.md). Related: [share-and-router/PLAN.md](share-and-router/PLAN.md).

## Goal

Measure Drive compute/memory cost, then optimize via architecture (cache, batch, async, parallel, bounds) — not micro-guesses.

## Baseline probes (fill during execution)

| Probe | Method | Baseline | After |
|---|---|---|---|
| Hub heap after join | `process.memoryUsage().heapUsed` | TBD | TBD |
| Mermaid produce cold | `produceMermaidShowArtifact` ms | TBD | TBD |
| Mermaid produce warm | cache hit ms | TBD | TBD |
| Director rank 100 shows | `rankShowBacklog` ms | TBD | TBD |
| Webview messages[] growth | count after N turns | TBD | TBD |

## Implemented so far

- Mermaid producer content-hash **SVG cache** (`produceMermaid.ts`)
- Voice stack **memoized by topology fingerprint** (`createVoiceStack`)
- Director **spotlight hysteresis** via sticky show ids (hold policy)

### Adaptive guardrails milestone (draft)

The first long-horizon guardrail milestone is being delivered incrementally on
`feature/adaptive-performance-guardrails`.

Implemented in the current draft:

- A versioned, validated resource-policy contract in `@cline/shared`.
- Hardware-derived core policy resolution with finite hard limits, environment
  and SDK overrides, and source attribution for resolved values.
- Lifecycle-owned, observe-only process memory and event-loop diagnostics on
  `ClineCore.diagnostics`.
- Count, aggregate-byte, and single-item admission limits for pending prompts.
- Count and message-byte admission limits for queued team runs.
- One physical execution lane per teammate while independent teammates retain
  team-wide parallelism.
- Physical team-run cancellation that holds scheduler capacity until the
  underlying execution settles and rejects late terminal-state overwrites.

Still required before the milestone is complete:

- Lightweight agent streaming snapshots that do not clone full transcripts.
- Bounded WebSocket delivery, coalescing, slow-consumer handling, and inbound
  payload limits.
- Wiring all queue and transport limits to the resolved resource policy.
- Long-transcript, slow-client, and session-churn soak fixtures.

The monitor is deliberately observe-only at this stage. Dynamic concurrency
changes require measured baselines and hysteresis; deploying an uncalibrated
feedback loop could make throughput less predictable rather than safer.

### Policy precedence

Resource values resolve in this order:

1. Finite hard safety limit.
2. Explicit SDK override.
3. Validated environment override.
4. Hardware-derived default.
5. Built-in fallback.

Power users can raise normal defaults, but no queue, concurrency value, or
memory budget may resolve to infinity. Durable conversation data is not deleted
in response to memory pressure; this milestone limits admission and hot runtime
work instead.

## Next optimizations (ordered)

1. Coalesce `drive.room.changed` broadcasts (16–50ms)
2. Blob/object URL LRU + revoke on sticky replace
3. Chat transcript window / virtualization if message growth dominates
4. Optional worker for heavy SVG if hub CPU blocks sessions

## Principles

- Foundational: measure before C2+ changes
- Minimize reader load: keep producers in one module
- Outcome-oriented: delete dual webview/hub truth when ops land
