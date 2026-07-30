---
name: diagram-show
description: Produce and present Drive Show backlog diagram.* artifacts using SHOW_TEMPLATE_KIT convention-stable Mermaid, @cline/drive validateMermaidSource, and drive.show.* ops. Use when enqueueing or presenting architecture/data-flow/security diagrams on Spotlight — not for nest doc authoring (use diagram-first).
---

# Diagram-Show (Cline + Drive director)

Stage diagrams for Spotlight via the dual-backlog director. Sources come from the SDK kit and nest conventions — **never free-form invent**.

## SDK surfaces

| Piece | Location |
|---|---|
| Parse gate | `@cline/drive` `validateMermaidSource` / `assertMermaidSource` |
| Kit defaults | `SHOW_TEMPLATE_KIT`, `KIT_MERMAID_*`, `showItemFromTemplate` |
| Produce | `@cline/core` `produceMermaidShowArtifact` (throws `MermaidParseError`) |
| Present | `drive.show.present` / `drive.show.tick` / `drive.show.enqueue` |
| CLI check | `bun sdk/scripts/validate-mermaid.ts --source "…"` |

## Source bias (required)

1. Prefer kit `mermaidSource` from `showItemFromTemplate({ templateId: "arch.overview" | "flow.data" | "sec.network", … })`.
2. Prefer living fences in `docs/drivecode/architecture.md` when explaining product planes.
3. Honor `.claude/diagram-conventions.md` node IDs (`HubDaemon`, `ShowBacklog`, `MermaidProduce`, …).
4. Override args only with parse-valid Mermaid that still uses convention names.

## Workflow

```text
1. Choose templateId (arch.overview | flow.data | sec.network)
2. Build ShowBacklogItem via showItemFromTemplate (includes mermaidSource)
3. bun sdk/scripts/validate-mermaid.ts --source "<mermaidSource>"
4. drive.show.enqueue (+ optional presentNow) or drive.show.present
5. Fail closed on mermaid_parse_failed — do not stub invalid source onto StickyStagePane
```

Sample / dev path already exists: hub Settings “Present sample diagram” (`sampleShowPresent.ts`).

## Composition (diagram-first rules still apply)

≤20 nodes · typed edges · stable IDs · caption for say/sticky · one claim sentence.

## Not this skill

- Nest ARD / architecture doc authoring → **diagram-first**
- Feature implementation plans → visual-plan / DRV checklist
- Status Hub Dependency map → product UI (`buildDependencyMap`), not Show

## Planner note

Hub `planShowIntents` already maps signals → kit templates. Do not seat an LLM Diagrammer that invents Mermaid until the heuristic kit path is insufficient.
