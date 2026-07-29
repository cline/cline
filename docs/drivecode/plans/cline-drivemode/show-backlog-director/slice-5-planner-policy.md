# Slice 5 · Planner policy (hub-side)

Back to [overview.md](overview.md). Depends on: [slice-3](slice-3-script-runner.md) + [slice-4](slice-4-do-show-link.md). Unlocks: seated planner agents later; feeds [slice-6](slice-6-producers.md).

## Goal

A **hub policy** (not a ConfiguredAgent seat yet) continuously enqueues Show (and optionally Do) items from templates and work signals so the stage appears planned ahead of / alongside coding.

## Tasks

| ID | Task | Depends on | Owner | Done when |
|---|---|---|---|---|
| 5.1 | Define `planShowIntents(input) → ShowBacklogItem[]` pure helper in `@cline/drive` (heuristic MVP: on plan-mode / first act → enqueue `arch.overview`; on test card → enqueue `doc.plan` or walkthrough; dedupe by templateId+room) | slice 2 item shape | `@cline/drive` | Unit tests for heuristics; no LLM ✓ |
| 5.2 | Hook `call_record_work` (and/or bank now-task change) to call planner → `drive.show.enqueue` internals → optional rate-limited `runShowDirectorTick` | 5.1, slice 2 | `@cline/core` | Completing a classified tool can enqueue ≤1 show per template with cooldown ✓ |
| 5.3 | Config knobs on live room or hub settings: `showPlanner: off \| heuristic`, `tickOnWork: boolean`, cooldown ms | 5.2 | shared + core + settings UI stub | Default `heuristic` in Drive rooms; off does nothing ✓ |
| 5.4 | Optional: enqueue a 2-beat script skeleton when arch diagram enqueued (attach script ids to shows) | 5.1, slice 3 | drive + core | Script attach + shows in one planner action ✓ |
| 5.5 | Observability: emit `drive.show.planned` with `scoreReasons` / planner reason string | 5.2 | core | Auditable why item appeared ✓ |
| 5.6 | Explicit non-goal gate: document that ConfiguredAgent “Backlog planner” YAML waits until this heuristic exits | — | docs | README points here ✓ |

## Dependency notes

- Needs slice 3 if planner attaches scripts; can ship 5.1–5.3 without scripts and add 5.4 after.
- Needs slice 4 if planner also seeds Do; Show-only planner can exit with 5.1–5.3 + slice 2 only — **prefer** full dep (3+4) so Do/Show stay coherent.
- Rate-limit to avoid backlog thrash ([share-and-router PLAN](../share-and-router/PLAN.md) risks).

## Non-goals

- LLM-authored diagrams (heuristic templates only).
- Seated screen-manager agent.
- Replacing reactive StageCards.

## Files likely

- `sdk/packages/drive/src/director/planShowIntents.ts` (new)
- `sdk/packages/core/src/hub/server/handlers/drive-room-handlers.ts` (`call_record_work`)
- `sdk/packages/drive/src/director/showTemplates.ts`
- Drive settings facet or room live flags

## Acceptance

- [x] With planner on: Join + act tool completion enqueues at least one show template within cooldown rules.
- [x] With planner off: no enqueue from work.
- [x] Tick still presents top ranked item; sticky updates without manual present button.

## Non-goal gate (ConfiguredAgent)

**Do not** land a seated ConfiguredAgent “Backlog planner” YAML until this heuristic policy exits and is exercised in Drive rooms. Prefer hub `planShowIntents` + `drive.planner.set` (see overview implementation guidance). Promote to a seated agent only after `teamOpt` / seatCap allow — mirrors share-and-router PLAN default MVP cast.

## Risks

- Noisy enqueue on every bash — classify via existing work categories; only plan/edit/test transitions enqueue.
