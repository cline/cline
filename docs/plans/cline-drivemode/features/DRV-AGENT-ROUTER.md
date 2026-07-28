# DRV-AGENT-ROUTER · Route utterances among seated agents

Back to [README](../README.md). Design: [10-agent-router.md](../10-agent-router.md), [ARD-0012](../ard/ARD-0012-agent-router.md). Plan: [share-and-router/PLAN.md](../share-and-router/PLAN.md).

## Problem / user value

In a multi-agent room, the next message should reach the best seated agent without forcing manual recipient chips every time. Optionally, one message can split into fractions for different agents.

## Acceptance criteria

- Pure `planRoute` returns a `RoutePlan` of slices, each with a legal DRV-ADDRESS `addressSet` and reviewable `reasons[]`.
- Modes: `manual` | `suggest` | `auto`. Multi-agent default is `suggest`. Auto is opt-in; `lowConfidence` forces confirm.
- Hub delivers only via existing address enforcement. Empty route never widens to everyone.
- Fractions (`router.allowFractions`) default off.
- Does not seat agents (recruit), spawn specialists (team-opt), or choose LLM providers.
- Composer shows route preview chips in suggest mode before send.

## Dependencies

- [DRV-ADDRESS](DRV-ADDRESS.md), [DRV-ROSTER](DRV-ROSTER.md), [DRV-EVENTS](DRV-EVENTS.md), [DRV-TEAM-OPT](DRV-TEAM-OPT.md) for multi-seat, [DRV-RECRUIT](DRV-RECRUIT.md) for label index reuse, [DRV-PLATFORM-CONFIG](DRV-PLATFORM-CONFIG.md) for `router.*` facets.

## Surfaces touched

- `sdk/packages/shared/src/drive/` (RoutePlan schemas, facets)
- `sdk/packages/drive/src/router/` (planRoute, assertRouteLegal)
- `sdk/packages/core/src/hub/` (apply plan on send)
- `apps/cline-hub/src/webview/src/` (preview chips)

## Agent tasks

- [ ] Schemas + `assertRouteLegal` reject empty / unknown ids.
- [ ] Lexical seated scorer fixtures (two specialists).
- [ ] Suggest/auto wire on send path.
- [ ] Fraction splitter behind flag + transcript grouping by utteranceId.

## Risks

- Mis-route under lexical MVP. Mitigation. Suggest default; show reasons.
- Silent fan-out. Mitigation. Boundary assert + tests.
- Verb confusion with recruit. Mitigation. Separate feature ids and UI copy (“Deliver to” vs “Add to call”).
