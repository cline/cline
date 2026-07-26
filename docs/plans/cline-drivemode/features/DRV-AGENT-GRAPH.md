# DRV-AGENT-GRAPH · Per-agent portfolio knowledge graph

Back to [README](../README.md). Phase 2+ in [TASK-GRAPH](../TASK-GRAPH.md). Product: [PRD 6](../prd/prd-driveagent-portfolio.md). Decision: [ARD-0002](../ard/ARD-0002-agent-graph-canonical-derived.md).

## Problem / user value

Recruitment and profile “what does this agent know?” need a typed portfolio, not a bag of notes. The personal site pattern (skills catalog + project `skills[].applied` + graph lens) is the UX bar. Each `.driveagent/<slug>/knowledge/` is that database for one agent.

## Acceptance criteria

- Canonical under `knowledge/`:
  - `catalog.yaml` — controlled vocabulary for capability labels
  - `nodes/` — files or shards by kind
  - `edges.yaml` — typed edges
  - `private/` — gitignored durable notes
- Derived under `.derived/graph.json` only. Hand-edits overwritten on compile. Deterministic key order.
- Node kinds (MVP): `capability`, `case`, `constraint`, `artifact`, `concept`.
- Edge kinds (MVP): `has_capability`, `applied_in`, `requires`, `conflicts_with`, `related_to`, `learned_from`.
- Lint fails on unknown kinds, dangling refs, or `learned_from` payloads that embed raw transcript text.
- Profile Knowledge section lists capabilities and cases (`applied_in`) from compiled graph; optional mini lens later.
- Empty graph is valid. Agent remains seatable.
- Not the claude-drive thread graphify store. Portfolio ≠ thread routing ([ARD-0002](../ard/ARD-0002-agent-graph-canonical-derived.md)).

## Dependencies

- [DRV-DRIVEAGENT-HOME](DRV-DRIVEAGENT-HOME.md), [DRV-PARTICIPANT-SHEET](DRV-PARTICIPANT-SHEET.md). [DRV-RECRUIT](DRV-RECRUIT.md) consumes the compile. Gated learn: [ARD-0004](../ard/ARD-0004-gated-learn-privacy.md).

## Surfaces touched

- `sdk/packages/shared/src/drive/graph/` (schemas)
- `sdk/packages/drive/src/graph/` (compile + lint, pure)
- `apps/cline-hub/src/webview/src/drive/` (Knowledge section)

## Agent tasks

- [ ] Schemas + lint fixtures (good graph, dangling edge, transcript-in-edge fails).
  - Owner package: `@cline/shared` / `@cline/drive`
  - Verify: package tests
- [ ] Compile canonical → `.derived/graph.json`.
  - Owner package: `@cline/drive` + hub write of derived only via compile op
- [ ] Profile Knowledge list from compiled graph.
  - Owner package: `@cline/cline-hub`
  - Done when: fixture agent shows two capabilities and one case.

## Risks

- Authors skip schema and paste prose. Mitigation. Lint in CI / on save; catalog required for capability labels used in edges.
- Accidental retention. Mitigation. ARD-0004; lint blocks transcript bodies on edges.
