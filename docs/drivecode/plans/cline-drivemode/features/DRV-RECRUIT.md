# DRV-RECRUIT · Rank agents (and suggest packs) for a need

Back to [README](../README.md). Phase 2–4 in [TASK-GRAPH](../TASK-GRAPH.md). Product: [PRD 6](../prd/prd-driveagent-portfolio.md). Decision: [ARD-0003](../ard/ARD-0003-recruit-and-roster-pack.md).

## Problem / user value

RosterPacks seat known crews. They do not answer “who should review this auth change?” Recruit queries portfolio graphs and returns ranked agents with reasons, optionally suggesting packs whose members cluster on the need. Spoken “add the cybersecurity team” still resolves to a pack display name when the user means a preset; recruit is the open-ended path.

## Acceptance criteria

- Hub (or kernel pure + hub FS) exposes `drive_recruit`:

```ts
recruit({
  need: string | { capabilities?: string[]; domains?: string[] },
  limit?: number,
  excludeSeated?: boolean,
}): RankedAgent[]
// { slug, displayName, score, reasons[], suggestedPackIds? }
```

- MVP scorer is lexical/tag over `catalog.yaml` + capability/case labels (harrison-site filter quality). No embeddings. No second daemon. Index is an in-memory scan of workspace (+ user) `.driveagent/**` homes, refreshed on home compile or explicit refresh.
- Reasons cite matched node/edge ids (reviewable), not opaque model prose.
- UI: Drive tab **Add → Recruit** (and optional composer `/recruit <need>`). Selecting a result calls existing seat ops; recruit never appends `participants[]` itself.
- Pack suggestions use [DRV-ROSTER-PACK](DRV-ROSTER-PACK.md) seat path (`room_add_roster_pack`). Multi-agent still gated by `teamOpt` / `seatCap`.
- Agents with empty graphs remain manually seatable; they rank at the bottom unless the need is empty (then stable slug order).
- Spoken “team” never creates a Drive type named Team ([ARD-0003](../ard/ARD-0003-recruit-and-roster-pack.md)).

## Dependencies

- [DRV-AGENT-GRAPH](DRV-AGENT-GRAPH.md), [DRV-DRIVEAGENT-HOME](DRV-DRIVEAGENT-HOME.md), [DRV-ROSTER](DRV-ROSTER.md), [DRV-ROSTER-PACK](DRV-ROSTER-PACK.md), [DRV-ROOM-MVP](DRV-ROOM-MVP.md), [DRV-TEAM-OPT](DRV-TEAM-OPT.md) for multi-seat.

## Surfaces touched

- `sdk/packages/drive/src/recruit/` (score, pure)
- `sdk/packages/core/src/hub/drive-recruit/`
- `apps/cline-hub/src/webview/src/drive/` (Recruit picker)

## Agent tasks

- [ ] Pure scorer + fixture graphs with deterministic ranking.
  - Owner package: `@cline/drive`
  - Verify: `bun -F @cline/drive test`
- [ ] Hub op + index refresh on compile.
  - Owner package: `@cline/core`
  - Verify: `bun -F @cline/core test:unit`
- [ ] Recruit picker seats via existing ops; respects seatCap.
  - Owner package: `@cline/cline-hub`
  - Done when: query “security” ranks fixture security agent above pair partner; multi-member seat still gated when flag off.

## Risks

- Fuzzy language fails lexical match. Mitigation. Document; P4 semantic optional. Suggest capability chips in UI.
- Recruit UI bypasses gates. Mitigation. Always seat through hub ops with capPreset / seatCap.
