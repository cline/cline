# Slice 7 · Router wire (optional)

Back to [overview.md](overview.md). Depends on: [slice-2](slice-2-enqueue-rank-tick.md) (rank already biases addressed owners). Related: [DRV-AGENT-ROUTER](../features/DRV-AGENT-ROUTER.md), [10-agent-router.md](../10-agent-router.md).

## Goal

Call pure `planRoute` on human send so `addressSet` / assignee feeds Show ranking and Do assignee hints — suggest mode first.

## Tasks

| ID | Task | Depends on | Owner | Done when |
|---|---|---|---|---|
| 7.1 | On composer submit in Drive room, compute `planRoute` from seated cards + utterance | — | `@cline/drive` + hub webview/core | RoutePlan returned; suggest UI chip |
| 7.2 | Apply addressSet from accepted suggestion via existing address ops | 7.1 | hub | Rank tick prefers addressed owner’s shows |
| 7.3 | `assertDeliveryAllowed` on A2A/speak paths when mute/deafen set | 7.1 | core | Muted agent cannot narrate say beats |
| 7.4 | Auto mode behind flag (default off) | 7.2 | core | Flag off = suggest only |

## Dependency notes

- Not on the minimum vertical path.
- More valuable after multi-agent seats (Phase 4 team opt); still useful with one partner for address bias tests.

## Acceptance

- [ ] Suggest chip shows ranked seated agent; accepting updates address set.
- [ ] Show tick with two owners prefers addressed when priorities tie.

## Non-goals

- Embedding-based recruit rewrite.
- Replacing Drive roster with Team.
