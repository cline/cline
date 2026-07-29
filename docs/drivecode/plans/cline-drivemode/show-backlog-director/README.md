# show-backlog-director · Implementation plan index

Backlog-oriented **Show** presentation for Drive Spotlight: enqueue → rank → produce → present → advance DirectorScript, while **Do** work runs in parallel (chat forks).

Canonical architecture: [share-and-router/PLAN.md](../share-and-router/PLAN.md). Feature checklist: [DRV-SHOW-BACKLOG](../features/DRV-SHOW-BACKLOG.md). Related: [DRV-CHAT-FORK](../features/DRV-CHAT-FORK.md), [DRV-DEMO-SHARE](../features/DRV-DEMO-SHARE.md), [DRV-SHARE](../features/DRV-SHARE.md), [11-spotlight-a2a.md](../11-spotlight-a2a.md).

| File | What |
|---|---|
| [overview.md](overview.md) | Goal, as-is inventory, dependency DAG, track map |
| [slice-1-present-trigger.md](slice-1-present-trigger.md) | Product path to `drive.show.present` → StickyStagePane |
| [slice-2-enqueue-rank-tick.md](slice-2-enqueue-rank-tick.md) | Enqueue Show + hub rank/present tick |
| [slice-3-script-runner.md](slice-3-script-runner.md) | DirectorScript sticky advance + captions |
| [slice-4-do-show-link.md](slice-4-do-show-link.md) | Do enqueue ↔ forks ↔ promote creates Show items |
| [slice-5-planner-policy.md](slice-5-planner-policy.md) | Hub planner policy enqueues Show from templates/work |
| [slice-6-producers.md](slice-6-producers.md) | Non-mermaid producers (plan card, walkthrough, snapshot) |
| [slice-7-router-wire.md](slice-7-router-wire.md) | Wire `planRoute` into send path (optional after core loop) |
| [slice-S-spotlight-converge.md](slice-S-spotlight-converge.md) | Parallel: converge stage sharer + live spotlight; auto-stage; classifier collapse |
| [testing.md](testing.md) | Verification matrix across slices |

**Locked defaults**

- Appear-live via planned Show backlog — not WebRTC.
- Hub policies before seating planner/screen-manager agents.
- One card-deck (reactive work cards) + sticky planned show coexist in Spotlight.
- Spotlight floor and stage content authority **converge** (see slice S).
- Join **auto-opens** Stage layout (slice S).
- Single shared tool→category classifier (slice S).

**Out of scope here**

- Pixel SFU / WebRTC.
- Seated ConfiguredAgent YAMLs for planner/screen manager (after slice 5 works as hub policy).
- TTS narrator binding (Phase 3 voice; captions in slice 3 are text-only).
- Replacing Now/Next (task bank) with Show director — they stay orthogonal.
