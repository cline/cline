# DRV-SHOW-BACKLOG · Planned Show backlog + director tick

Back to [README](../README.md). Architecture: [share-and-router/PLAN.md](../share-and-router/PLAN.md). Implementation slices: [show-backlog-director/](../show-backlog-director/).

## Problem / user value

Reactive work cards mirror what the agent already did. Pairing feels live when the stage also shows **planned** explanations (diagrams, walkthroughs, plan cards) ranked and advanced by a director — appear-live without WebRTC.

## Acceptance criteria

- [x] Product path can present a Show item into `StickyStagePane` (not tests-only).
- [x] `drive.show.enqueue` + rank tick present top `ShowBacklogItem` via existing `rankShowBacklog`.
- [x] DirectorScript can advance with sticky hold while caption/`say` updates.
- [x] Do enqueue + promote can **create** Show items from templates.
- [x] Hub planner policy (heuristic) can enqueue Show from work/plan signals with rate limits.
- [x] Producers exist for mermaid (done), plan card, code walkthrough; snapshot fail-closed or live.
- [x] Spotlight floor and stage sharer converge; Join auto-opens Stage; human pin from roster; single tool→card classifier.
- [x] Router suggest on Drive send updates `addressSet`; show tick prefers addressed owners.

## Dependencies

- [DRV-STAGE](DRV-STAGE.md), [DRV-SHARE](DRV-SHARE.md), [DRV-CHAT-FORK](DRV-CHAT-FORK.md), [DRV-DEMO-SHARE](DRV-DEMO-SHARE.md), [DRV-CALL-STRIP](DRV-CALL-STRIP.md), [DRV-PRIVACY](DRV-PRIVACY.md).
- Landed: director schemas, `drive.show.present`, mermaid producer, StickyStagePane, fork claim/promote.

## Surfaces touched

- `sdk/packages/shared/src/drive/director.ts`, `hub.ts`
- `sdk/packages/drive/src/director/**`
- `sdk/packages/core/src/hub/server/handlers/**`, `drive-producers/**`
- `apps/cline-hub/src/webview/src/drive/**`

## Agent tasks (slice map)

| Slice | Plan | Depends on |
|---|---|---|
| 1 Present trigger | [slice-1](../show-backlog-director/slice-1-present-trigger.md) | Landed present path |
| 2 Enqueue + rank tick | [slice-2](../show-backlog-director/slice-2-enqueue-rank-tick.md) | Slice 1 |
| 3 Script runner | [slice-3](../show-backlog-director/slice-3-script-runner.md) | Slice 2 |
| 4 Do↔Show link | [slice-4](../show-backlog-director/slice-4-do-show-link.md) | Slice 2 + forks |
| 5 Planner policy | [slice-5](../show-backlog-director/slice-5-planner-policy.md) | Slices 3 + 4 |
| 6 Extra producers | [slice-6](../show-backlog-director/slice-6-producers.md) | Slice 2 (+5 preferred) |
| 7 Router wire | [slice-7](../show-backlog-director/slice-7-router-wire.md) | Slice 2 |
| S Stage chrome | [slice-S](../show-backlog-director/slice-S-spotlight-converge.md) | Parallel; S3 after S1 |

## Risks

- Backlog thrash from planner — cooldowns and category gates.
- Dual spotlight planes until slice S — rank may disagree with Spotlight header. **Mitigated:** S1 converges sharer → live spotlight.
- Treating fixture demos as production gate — use [testing.md](../show-backlog-director/testing.md) live path.
