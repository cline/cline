# ARD-0002: Canonical knowledge YAML; derived graph projection

## Status

Proposed

## Metadata

- Date: 2026-07-25
- Deciders: Drivecode planning (cline-drivemode)
- Related: PRD 6, ARD-0001
- Inspired by: BRIEF canonical `BRIEF.md` vs `latest/*` artifacts; harrison-site content YAML → emitted site/graph views

## Context

Each agent needs a knowledge database (portfolio graph). Options for source of truth:

1. Only a binary/SQLite/JSON graph edited by tools.
2. Only free-form markdown with no schema.
3. Human-editable canonical YAML (catalog, nodes, edges) plus a **compiled** `graph.json` under `.derived/`.
4. Live NetworkX/graphify process as source of truth (claude-drive thread-graph pattern).

## Decision

**Option 3.**

1. **Canonical** files under `.driveagent/<slug>/knowledge/` (`catalog.yaml`, `nodes/`, `edges.yaml`, optional `private/`).
2. **Derived** outputs under `.driveagent/<slug>/.derived/` (`graph.json`, optional shards/audits). Never hand-edit derived files; compile overwrites them.
3. **Schemas** validate canonical files (fail lint on unknown edge kinds, dangling refs).
4. **Deterministic compile** (stable key order) so diffs are reviewable if derived artifacts are committed.
5. **Commit policy:** Prefer committing canonical YAML. Derived `graph.json` may be committed for CI recruit tests or ignored locally; both are valid (same fork BRIEF documents for `latest/`).
6. **Do not** use claude-drive’s per-thread graphify store as this portfolio store. Thread routing graphs and agent portfolio graphs are different products; fusing them creates the wrong retention and identity model.

## Graph MVP shape

Node kinds: `capability`, `case`, `constraint`, `artifact`, `concept`.
Edge kinds: `has_capability`, `applied_in`, `requires`, `conflicts_with`, `related_to`, `learned_from`.

`applied_in` is the direct analog of personal-site `skills[].applied` on projects.

## Compile contract

Inputs: `catalog.yaml` + `nodes/**` + `edges.yaml` (and optional `private/` only if explicitly included by a private compile flag; default compile **excludes** `private/`).

Output: `.derived/graph.json` with `{ version, agentSlug, nodes[], edges[], compiledAt }` and stable sort by id.

Recruit ([DRV-RECRUIT](../features/DRV-RECRUIT.md)) reads compiled graphs only, never raw private notes.

Inject into a turn (P3+) uses graduated retrieval: labels and short summaries by default; full node bodies only when selected. Inject audit records node ids ([ARD-0004](ARD-0004-gated-learn-privacy.md)).

## Consequences

**Positive**

- Human-reviewable portfolios (git-friendly).
- Tooling moat in compile/lint/audit (BRIEF lesson: artifacts > format alone).
- Clear privacy split (`private/` gitignored).

**Negative**

- Authors must learn a small schema.
- Compile step must be wired into save/CI or profiles show stale derived views.

## Alternatives considered

- **SQLite-only** — Faster query, worse human authorship and PR review.
- **Markdown-only wiki** — Flexible, weak recruit ranking and validation.
- **Graphify as SoT** — Good for code/thread graphs; wrong default for authored agent portfolios; optional later scorer only (PRD P4).

## References

- PRD 6
- BRIEF dot-agents layout and lessons learned (invest in artifacts layer)
- harrison-site skills catalog + project edges
