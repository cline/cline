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

### Adaptive guardrails milestone (complete)

The first long-horizon guardrail milestone landed on `main` in
[PR #32](https://github.com/hhalperin/cline-drivecode/pull/32). Operational
defaults and overload behavior are documented in
[`sdk/packages/core/RESOURCE_GUARDRAILS.md`](../../../../sdk/packages/core/RESOURCE_GUARDRAILS.md).

Implemented:

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
- Lightweight agent streaming snapshots that do not clone full transcripts.
- Bounded WebSocket delivery, coalescing, slow-consumer handling, and inbound
  payload limits.
- Wiring all queue and transport limits to the resolved resource policy.
- Long-transcript, slow-client, and session-churn soak fixtures.

Deterministic coverage exercises 20,000 retained transcript messages across
2,000 deltas, 25,000 replaceable snapshots behind a slow client, and 200 socket
lifecycles with 20 session subscriptions each. These are retained-state and
payload-boundary tests, not machine-dependent wall-clock benchmarks.

The monitor is deliberately observe-only at this stage. Dynamic concurrency
changes require measured baselines and hysteresis; deploying an uncalibrated
feedback loop could make throughput less predictable rather than safer.

### Policy precedence

Resource values resolve in this order:

1. Explicit SDK override.
2. Validated environment override.
3. Hardware-derived or built-in default.
4. Finite hard clamp applied to the selected value.

Power users can raise normal defaults, but no queue, concurrency value, or
memory budget may resolve to infinity. Durable conversation data is not deleted
in response to memory pressure; this milestone limits admission and hot runtime
work instead.

## Next optimizations (ordered)

First fill the five baseline probes above. Then, only where measurements justify
the change:

1. Coalesce `drive.room.changed` broadcasts (16–50ms).
2. Add a blob/object URL LRU and revoke URLs on sticky replacement.
3. Window or virtualize the Chat transcript if message growth dominates.
4. Move heavy SVG work to an optional worker if Hub CPU blocks sessions.

## Principles

- Foundational: measure before C2+ changes
- Minimize reader load: keep producers in one module
- Outcome-oriented: delete dual webview/hub truth when ops land
