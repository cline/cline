---
name: diagram-first
description: Renders architecture, schema, orchestration, and ADR structure as validated Mermaid — diagram first, not prose walls. Use for Status/Drive/director nest docs, op topology, decision trees, and system maps. Not for general feature PR plans (use visual-plan) or Show stage enqueue (use diagram-show). Invokes @cline/drive validateMermaidSource via bun sdk/scripts/validate-mermaid.ts.
---

# Diagram-First (Cline)

Prose describes; diagrams *show*. Structural content — flow, sequence, hierarchy, state, relationships — leads with Mermaid. This is a **Cline project skill** backed by `@cline/drive` parse rules, not a Claude Code plugin.

Project conventions: [`.claude/diagram-conventions.md`](../../../.claude/diagram-conventions.md)

## When to use

| Use this skill | Use something else |
|---|---|
| Architecture, data pipeline, schema/ER, agent orchestration, ADR decision tree | Feature PR plans → **visual-plan** (if installed) or DRV checklist |
| Nest docs under `docs/drivecode/` with shape | Show backlog present → **diagram-show** |
| Op topology / director plane diagrams | Status Hub runtime task edges → Dependency map UI |

## Shape test

Before prose: does content have **order**, **connections**, **state**, or **quantity**? If yes → diagram first. Caption ≤5 bullets for what the diagram cannot carry. Never narrate arrows.

## Composition rules

1. Diagram first, caption second.
2. ~20 nodes max; ≤2 subgraph levels; one fence per diagram.
3. `LR` for flow, `TD` for hierarchy/decisions.
4. Stable IDs — honor `.claude/diagram-conventions.md`.
5. Edit existing fences **in place** (reviewable diffs).
6. Edge labels = payload **types**, not verbs.
7. Blind spots → **Open questions** list; do not silently invent nodes.
8. No fake-precision `gantt` dates (repo rule: no timeframes in plans).

## Defaults by artifact

| Artifact | Default |
|---|---|
| Architecture | `flowchart` with subgraphs; critical-path `sequenceDiagram` if needed |
| Data pipeline | `flowchart LR` with typed edges |
| Orchestration | Topology flowchart + one representative sequence |
| Schema / contract | `erDiagram` / `classDiagram` |
| ADR | Decision-tree flowchart or `quadrantChart` |

Templates: [references/patterns.md](references/patterns.md). Gotchas: [references/gotchas.md](references/gotchas.md).

## Deliverable gate

After drafting nest Mermaid, run:

```bash
bun sdk/scripts/validate-mermaid.ts path/to/doc.md
```

Grade: **parse-validated** (structural, same as `@cline/drive` `validateMermaidSource`). Nest stays **Tier A** fenced markdown (no CDN Tier-B HTML by default).

State the grade truthfully. Silence about grade is failure.

## Inline self-check

- Type matches shape · ≤20 nodes · edges name contracts · one name per component
- Caption adds only what the diagram cannot · no invented dates · living edit in place
- Provenance caption when ground-truthed from code

## Drive / director note

Living architecture for Status / Room / Director planes lives in `docs/drivecode/architecture.md`. Do not conflate Status Dependency map with Show sticky diagrams. For stage `diagram.*` items, load **diagram-show**.
