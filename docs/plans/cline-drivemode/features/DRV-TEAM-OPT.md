# DRV-TEAM-OPT · Optional specialist agents (flagged)

Back to [README](../README.md). Phase 4 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

Sometimes the pair partner should pull in a specialist. "Let me get the test expert to look at this flake." A second agent joins the room as a `specialist`, does a bounded job, reports on the stage, and leaves. This is the first step from pair to more-than-one, gated behind a flag because the MVP promise is one partner.

## Three nearby things that are not each other

This feature sits between two neighbours it is regularly confused with. The distinction is load-bearing, so it is stated here rather than inferred.

| Thing | What it is | Who creates it | Where |
|---|---|---|---|
| **Cline `Team`** | Runtime execution group: lead, teammates, mailbox, mission log, outcomes | A lead agent, mid-session, via `team_spawn_teammate` | `sdk/packages/shared/src/team/schema.ts`, `sdk/packages/core/src/extensions/tools/team/` |
| **DRV-TEAM-OPT specialist** (this feature) | One extra seat in a Drive room, requested by the partner, bounded job, cascade-dismissed | The pair partner, at runtime, behind this flag | `seatSources: { kind: "spawn", parentId }` |
| **`RosterPack`** | A human-curated seating preset with a name, added to a call in one action | A human, ahead of the call | [DRV-ROSTER-PACK](DRV-ROSTER-PACK.md), facet `roster.pack` |

Drive identifiers never contain `Team`; that word belongs to Cline's runtime construct. A pack is not a parent, so pack members are peers with no cascade between them, while a spawned specialist names its parent and cascades. Full rationale in [06-platform-config.md](../06-platform-config.md#naming-rosterpack-not-teampack-not-team).

## Acceptance criteria

- Behind a config flag (default off), the pair partner can seat one `specialist` agent in the room.
- Seating a specialist **requires** isolation capability ([DRV-ISOLATION](DRV-ISOLATION.md)); otherwise the op fails with a typed, visible error.
- The specialist's capability preset never exceeds the partner's (readonly default, per the operator-hierarchy rule).
- The specialist appears in the roster and on the call strip. Its work events render on the stage only when it holds the stage pointer.
- Dismissing the partner cascades to its specialists.
- With the flag off, the roster cap from DRV-PARTNER-MVP still holds (its test keeps passing).
- The flag also governs `roster.seatCap`, so a multi-member [RosterPack](DRV-ROSTER-PACK.md) cannot seat past it. Pack authoring ships in phase 2 without this flag; seating more than one agent never does.
- A specialist seat records `seatSources: { kind: "spawn", parentId }`. Cascade dismiss walks that edge. A participant also claimed by a pack or a manual seat survives the cascade, because a seat leaves only when its source set empties.

## Dependencies

- Phase 2 gate complete. DRV-ROOM-MVP (roster and stage pointer already model this), DRV-STAGE. [DRV-ROSTER-PACK](DRV-ROSTER-PACK.md) shares the `seatSources` refcount and the `capPreset` path.
- **[DRV-ISOLATION](DRV-ISOLATION.md) is a hard dependency.** `teamOpt` must not seat a second agent when isolation is unavailable (fail closed).

## Surfaces touched

- `sdk/packages/core/src/hub/collaboration/` (roster flag, cascade dismiss)
- `sdk/packages/drive/src/` (specialist spawn policy)
- `apps/cline-hub/src/webview/src/components/CallStrip.tsx` (second participant chip)

## Agent tasks

- [ ] Add the flag and roster seat with preset capping and cascade dismiss, keeping the flag-off cap test green.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hub/collaboration/roster.ts`, tests
  - Verify: `bun -F @cline/core test:unit`
  - Done when: capping, cascade, and flag-off tests all pass.
- [ ] Implement the spawn policy in the kernel. When the partner may propose a specialist, and the bounded-task contract it hands over.
  - Owner package: `@cline/drive`
  - Files likely: `sdk/packages/drive/src/specialist.ts`, tests
  - Verify: `bun -F @cline/drive test`
  - Done when: the policy emits a proposal event the user approves before seating (high-impact action gate).
- [ ] Render the second participant. Roster chip, stage-pointer handoff, and return.
  - Owner package: `@cline/cline-hub`
  - Files likely: `CallStrip.tsx`, `Stage.tsx`
  - Verify: `bun -F @cline/cline-hub test`, live smoke with the flag on
  - Done when: a specialist's bounded job is visible start to finish and dismissal cleans up.

## Risks

- Scope gravity. Team features are seductive and can eat the MVP. Mitigation. Flag off by default, one specialist max, and the phase 4 gate requires the single-partner experience to remain unchanged with the flag off.
