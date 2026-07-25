# PRD · Drive success metrics

**Status.** Draft for leadership acceptance  
**Related.** [LEADERSHIP-BRIEF.md](../LEADERSHIP-BRIEF.md), PRD 6, TASK-GRAPH gates  
**Rule.** Metrics are verifiable signals, not timelines.

## Problem

Without measurable definition-of-done, “MVP feels good” becomes un-reviewable opinion. Privacy and dual-registry bugs also need CI-shaped product KPIs, not only prose.

## Goals

- Prove Drive tab + call feel beats Chat-only join for the target persona.
- Keep privacy and overlay invariants machine-checkable.
- Give recruit/gates something to optimize later without inventing vanity dashboards.

## Non-goals

- Real-user telemetry leaving localhost in MVP (DRV-PRIVACY).
- Growth/activation funnels for a public launch.
- Embedding quality benchmarks before lexical recruit ships.

## Metric set

### A. Call feel (Phase 1 gate companions)

| ID | Metric | How measured | Pass signal |
|---|---|---|---|
| M1 | Phase 1 smoke path completion | Manual/scripted `smoke-phase1.md` on hub webview | Path completes without wizard or second room |
| M2 | Time-to-first-send after Join | Local stopwatch / test timestamp from join broadcast → first user message ack | Feels instant; no blocking setup (qualitative bar: no extra screens) |
| M3 | Single-agent roster cap | Automated test with `teamOpt` off | Never seats a second agent |
| M4 | Rename/ink without reseat | Automated + UI observe | Next broadcast shows new appearance; no seat churn |

### B. Architecture / privacy invariants (CI)

| ID | Metric | How measured | Pass signal |
|---|---|---|---|
| M5 | No `:7891` listener in Drive tests | Process/port assertion in smoke | Always 0 |
| M6 | No prompts in Drive facet files | Lint/type test over fixture + generated samples | 0 violations |
| M7 | Event schema cannot carry raw audio / full transcript | `@cline/shared` assertion tests | Tests fail on violation |
| M8 | No transcript/audio artifacts after session | Post-session FS scan in privacy tests | 0 files outside allowed state dir; none when strict |

### C. Stage / interrupt (Phase 2)

| ID | Metric | How measured | Pass signal |
|---|---|---|---|
| M9 | Stage replay determinism | Reload webview mid-task; compare projection | Identical stage summary |
| M10 | Steer without cancel | Scripted mid-turn steer | Ack without hard cancel |
| M11 | Raise-hand pause-after-tool | Scripted interrupt during tool | Pauses after tool; resumes on redirect |

### D. Gates (when DRV-GATES UI lands)

| ID | Metric | How measured | Pass signal |
|---|---|---|---|
| M12 | Gate emit coverage | Unit: taxonomy tools always emit | 100% of v1 classes |
| M13 | Silent-retry rate after deny | Unit/integration | 0 retries of same tool without new user intent |
| M14 | Deny→replan narration | Fixture turn | Partner acknowledges block |

### E. Recruit (lexical MVP)

| ID | Metric | How measured | Pass signal |
|---|---|---|---|
| M15 | Precision@3 on fixture corpus | Golden needs → expected slugs in `examples/` + fixtures | ≥ leadership-set floor (start: 2/3 cases exact top-3 contain expected) |
| M16 | Empty-graph agents still manually seatable | Test | Seat succeeds; rank low |

### F. One product north-star question

**M0 (qualitative, required in Phase 1 review):**  
For a developer who already uses Cline Chat, does Drive make “work with a partner on a call” obvious within the smoke path without reading docs?

Record as pass/fail with one paragraph of evidence in the Phase 1 gate report. No survey machinery in MVP.

## Instrumentation constraints

- Prefer **tests and local smoke scripts** over phone-home telemetry.
- If debug metrics are logged, they inherit DRV-PRIVACY redaction and visible debug indicator.
- Do not store raw utterances to “compute” metrics.

## Rollout

1. M5–M8 bind to Phase 0/1 CI.  
2. M1–M4 bind to Phase 1 gate.  
3. M9–M11 bind to Phase 2 gate.  
4. M12–M16 bind when those features enter their phase gates.
