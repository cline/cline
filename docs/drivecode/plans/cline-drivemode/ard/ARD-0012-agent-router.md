# ARD-0012: Agent router for multi-agent rooms

## Status

Accepted

## Metadata

- Date: 2026-07-27
- Deciders: Drivecode planning (cline-drivemode)
- Related: [DRV-ADDRESS](../features/DRV-ADDRESS.md), [DRV-RECRUIT](../features/DRV-RECRUIT.md), [DRV-TEAM-OPT](../features/DRV-TEAM-OPT.md), [DRV-AGENT-ROUTER](../features/DRV-AGENT-ROUTER.md), [10-agent-router.md](../10-agent-router.md), [share-and-router/PLAN.md](../share-and-router/PLAN.md)

## Context

Manual address chips (DRV-ADDRESS) do not scale when several agents are seated. Recruit answers who to seat. Team-opt answers who to spawn. Neither answers who should receive *this* utterance (or a fraction of it).

## Decision

1. **AgentRouter** is a pure `@cline/drive` function `planRoute` → `RoutePlan` of `RouteSlice[]`.
2. Each slice carries a valid **DRV-ADDRESS** `addressSet`. Hub delivery stays the single enforcement path. Never silent-widen empty → everyone.
3. **Modes:** `manual` | `suggest` | `auto`. Default for multi-agent rooms is `suggest`. Auto is opt-in; low confidence falls back to suggest.
4. **Fractions** (multi-slice) are off by default until a dedicated gate.
5. **MVP scorer** is lexical/tag over seated agents’ capability labels (recruit spirit, seated-only). Optional LLM rerank later behind a facet.
6. Router does **not** seat, spawn, or pick LLM providers.

## Consequences

**Positive**

- Clear verb separation (seat vs deliver vs spawn).
- Testable pure core; UI is projection of RoutePlan.
- Compatible with existing address chips.

**Negative**

- Lexical MVP can mis-route; suggest mode keeps a human in the loop.
- Fraction splitting is easy to get wrong (hence default off).

## Alternatives considered

- Manual chips only — rejected as sole multi-agent answer.
- LLM on every send — deferred as optional P2.
- Silent fan-out to all agents — rejected (DRV-ADDRESS).

## Links

- [10-agent-router.md](../10-agent-router.md)
- [share-and-router/PLAN.md](../share-and-router/PLAN.md)
