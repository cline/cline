# DRV-ROSTER-PACK · Curated roster presets, added to a call in one action

Back to [README](../README.md). Phase 2 in [TASK-GRAPH](../TASK-GRAPH.md). Design in [06-platform-config.md](../06-platform-config.md).

> **Naming.** This feature was drafted as `DRV-TEAM-PACK`. It is `RosterPack` everywhere now. Cline already ships a runtime `Team` (`sdk/packages/shared/src/team/schema.ts`, tools under `sdk/packages/core/src/extensions/tools/team/`) with a lead, teammates, a mailbox, and outcomes. Any Drive identifier containing `Team` collides with it in grep, autocomplete, imports, and support threads. See [06-platform-config.md](../06-platform-config.md#naming-rosterpack-not-teampack-not-team).

## Problem / user value

Some work has a shape you reach for repeatedly. A security review wants the same three agents every time. Assembling them one at a time before every call is the friction that makes people not bother. A **RosterPack** is a human-curated list of agent profiles with a name — "Cybersecurity", "Review", "Pair" — that drops into a call in one action.

A pack is configuration, not runtime. It is a list of references and seat order, authored by a human ahead of time. Cline's `Team` is a runtime execution group spawned by a lead agent mid-session with a mailbox and outcomes. They are different lifecycles owned by different actors, and the naming rule above exists so nobody has to re-derive that.

## Acceptance criteria

- `RosterPack` carries `id`, `slug`, `displayName`, optional `description`, ordered `members[]` of `{ profileId, role, override? }`, and `addressable`.
- A pack carries **no** prompts, tools, or model ids — only profile references and appearance overrides. This is what makes export safe to commit or paste.
- `expandRosterPack` is pure and returns `{ proposals, missing, truncated }`. The kernel proposes; only the hub seats and broadcasts. No client appends to `participants[]`.
- Every seated participant carries `seatSources: SeatSource[]`, where a source is `{ kind: "manual" }`, `{ kind: "pack", packId }`, or `{ kind: "spawn", parentId }`. The set is never empty while seated.
- Adding a pack whose member is already seated adds a source, not a duplicate seat. Adding the same pack twice is a no-op. Both are asserted by tests.
- Removing a pack from the call drops that source from every participant. A participant leaves only when its source set empties. A member claimed by a second pack stays.
- Dismissing a member directly clears all its sources and cascades to its `spawn` children, per `cursor-drive:.cursor/rules/operator-hierarchy.mdc`. A pack is not a parent — its members are peers seated by a human.
- Deleting a pack from the library never evicts a live participant.
- Three entry points, one op (`room_add_roster_pack`): roster header **Add**, `/pack <slug>` in the composer, and a picker hotkey. The chord is documented here when implemented and must clear the host shortcut table via `validateKeybindings`.
- The result of an add is reported in one line covering `seated`, `alreadyPresent`, `missing`, and `truncated`. Partial success is the default (`roster.packAddPolicy = "partial-seat"`); one missing agent file does not refuse the pack.
- **Multi-agent gating is unchanged.** With `teamOpt.enabled` off, `seatCap` is 1: a single-member pack seats normally, a multi-member pack seats its first member and reports the rest as gated with a pointer to the flag. The [DRV-PARTNER-MVP](DRV-PARTNER-MVP.md) roster-cap test stays green.
- Addressing a pack (`{ mode: "pack", packId }`) resolves at send time to currently-seated participants carrying that source. An empty resolution is rejected at the boundary, never widened to everyone ([DRV-ADDRESS](DRV-ADDRESS.md)).
- Preset capping applies at seat time. A pack member's stored preset is intent; `capPreset(parent, child)` is the authority, specialists default `readonly`.

## Dependencies

- [DRV-PLATFORM-CONFIG](DRV-PLATFORM-CONFIG.md) (`roster.pack` is facet #9), [DRV-AGENT-PROFILE](DRV-AGENT-PROFILE.md) (members are profiles), [DRV-ROSTER](DRV-ROSTER.md) (add affordance and `seatSources` rendering), [DRV-ADDRESS](DRV-ADDRESS.md) (pack address mode), [DRV-ROOM-MVP](DRV-ROOM-MVP.md) (seating ops).
- Seating more than one agent additionally depends on [DRV-TEAM-OPT](DRV-TEAM-OPT.md)'s flag and, before that flag turns on, the `DRV-ISOLATION` gap named in [05-workflows.md](../05-workflows.md).

## Surfaces touched

- `sdk/packages/shared/src/drive/facets/` (`RosterPack`, `SeatSource` schemas)
- `sdk/packages/drive/src/facets/expand.ts` (`expandRosterPack`, `capPreset` — pure)
- `sdk/packages/core/src/hub/collaboration/` (`room_add_roster_pack`, `room_remove_roster_pack`, refcounted seat removal)
- `apps/cline-hub/src/webview/src/drive/` (pack library editor, add-to-call picker, `/pack` slash command)

## Agent tasks

- [ ] Add `RosterPack` and `SeatSource` schemas with the refs-only assertion.
  - Owner package: `@cline/shared`
  - Files likely: `sdk/packages/shared/src/drive/facets/schemas.ts`, tests
  - Verify: `bun -F @cline/shared test`
  - Done when: a pack round-trips, member order is preserved, and a fixture containing a prompt field fails strict parse.
- [ ] Implement `expandRosterPack` with partial expansion, cap truncation, and preset capping, all pure.
  - Owner package: `@cline/drive`
  - Files likely: `sdk/packages/drive/src/facets/expand.ts`, tests
  - Verify: `bun -F @cline/drive test`
  - Done when: a pack with one missing profile returns proposals plus `missing`, a cap of 1 returns `truncated: true`, and a `full` member under a `readonly` parent comes back capped.
- [ ] Implement refcounted seating and removal in the hub.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hub/collaboration/roster.ts`, tests
  - Verify: `bun -F @cline/core test:unit`
  - Done when: add-twice is a no-op, an overlapping member survives removing one of two packs, dismissing a member cascades to `spawn` children, and the flag-off cap test still passes.
- [ ] Build the pack library editor, the add-to-call picker, and `/pack`.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/drive/RosterPackLibrary.tsx`, `AddPackMenu.tsx`, composer wiring
  - Verify: `bun -F @cline/cline-hub test`, live smoke via `control-ui`
  - Done when: creating "Cybersecurity", adding it to a call, and removing it round-trips through the roster with the single-line result report, and the copy says **pack** everywhere.
- [ ] Add the `/Team|team_/` CI guard over Drive paths.
  - Owner package: repo tooling
  - Files likely: the existing lint or check script wired into `bun run check`
  - Verify: `bun run check` from `sdk/`
  - Done when: introducing `TeamPack` under `sdk/packages/drive/` fails the check, and Cline's own `team/` sources are untouched.

## Risks

- **The word "team" comes back.** Prose, UI copy, and a future agent will all reach for it. Mitigation. The CI substring guard is an acceptance criterion here, not a nice-to-have, and the glossary line lives in [DRV-TEAM-OPT](DRV-TEAM-OPT.md) and [DRV-ROSTER](DRV-ROSTER.md) where someone would look.
- **Packs smuggling multi-agent past its gate.** Shipping "add three agents at once" is exactly what [DRV-TEAM-OPT](DRV-TEAM-OPT.md) is flagged to prevent. Mitigation. Authoring is phase 2, seating more than one stays behind the existing flag and cap, and the flag-off test is in this feature's own criteria.
- **Refcount subtlety.** "I removed the pack and it's still here" is confusing the first time. Mitigation. The roster shows why a participant is seated, and the open fork records a force variant if the subtle behaviour proves wrong in practice.
