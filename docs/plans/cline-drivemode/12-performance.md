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

## Next optimizations (ordered)

1. Coalesce `drive.room.changed` broadcasts (16–50ms)
2. Blob/object URL LRU + revoke on sticky replace
3. Chat transcript window / virtualization if message growth dominates
4. Optional worker for heavy SVG if hub CPU blocks sessions

## Principles

- Foundational: measure before C2+ changes
- Minimize reader load: keep producers in one module
- Outcome-oriented: delete dual webview/hub truth when ops land
