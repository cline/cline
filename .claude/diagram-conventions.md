# Diagram conventions (cline-drivecode)

Project-owned name registry for Mermaid in Drive / Status / director docs and
`diagram.*` Show artifacts. Honor when editing nest architecture or producing
stage diagrams. Skill packages are read-only; amend this file when a correction
lands.

## Skill routing (Cline)

| Content | Skill / surface |
|---|---|
| Architecture, schema, orchestration, ADR decision trees, op topology | **`diagram-first`** (`.agents/skills/diagram-first`) |
| Show backlog `diagram.*` present / enqueue | **`diagram-show`** (`.agents/skills/diagram-show`) |
| Feature implementation plans, PR file maps | visual-plan / DRV checklist (not diagram-first) |
| Do sequencing / phase gates | TASK-GRAPH + DRV (flowchart OK; no date gantt) |
| Runtime task edges on Status Hub | Dependency map (`buildDependencyMap`) — not Show |

Parse gate + kit: `@cline/drive` (`validateMermaidSource`, `SHOW_TEMPLATE_KIT`).
CLI: `bun sdk/scripts/validate-mermaid.ts`.

Do not invent a second planning tree outside `docs/drivecode/`. Nest docs stay
Tier A (fenced Mermaid in markdown). No fake-precision schedules.

## Direction and hygiene

- Flow / pipelines: `flowchart LR`. Hierarchy / decisions: `flowchart TD`.
- ≤20 nodes; ≤2 subgraph levels; one fence per diagram; stable node IDs.
- Edge labels = payload **types** (not verbs). Caption ≤5 bullets; never narrate arrows.
- Living diagrams: edit fences in place; mark designed-vs-actual with dashed edges.
- Blind spots → **Open questions** on the doc; do not silently invent nodes.

## Canonical component names

| ID | Meaning |
|---|---|
| `HubDaemon` | Detached hub (`ensureDetachedHubServer`; discovery, not a hardcoded port) |
| `HubTransport` | `HubServerTransport` / WS command path |
| `StatusPlane` | Durable status log (`status.db`, `status.*`) |
| `StatusSvc` | `StatusService` |
| `RoomPlane` | Ephemeral Drive rooms (`RoomSnapshot` Map) |
| `DriveLive` | `DriveRoomLiveState` (spotlight, mute/deafen, director bags) |
| `DoBacklog` | Execution backlog (`DoBacklogItem`) |
| `ShowBacklog` | Presentation backlog (`ShowBacklogItem`) |
| `DirectorScript` | Sticky say+show beat list |
| `ShowPlanner` | Hub heuristic `planShowIntents` (not a seated agent by default) |
| `StickyStagePane` | Chat sticky stage consumer for presented shows |
| `StageCards` | Reactive work cards from tool completions (orthogonal to Show) |
| `DriveHarness` | `createDriveHarness` / `@cline/drive` pure fold |
| `ForkPromote` | `drive.fork.*` claim → promote → may create Show from template |
| `MermaidProduce` | `render_mermaid` / `produceMermaidShowArtifact` (parse-gated) |
| `DepMap` | Status Hub Dependency map (team tasks; not Show) |

Banned aliases in new diagrams: “screen share daemon”, port `:7891`, treating
`RosterPack` as Cline `Team`, conflating DepMap with ShowBacklog.

## Show / director sources

For `diagram.architecture` / `diagram.data_flow` / `diagram.network_security` /
`diagram.sequence`:

1. Prefer `SHOW_TEMPLATE_KIT` defaults + convention-stable `mermaidSource`.
2. Prefer nest living fences ([docs/drivecode/architecture.md](../docs/drivecode/architecture.md)) over free-form invent.
3. Parse-validate before present; fail closed (no silent stub of invalid Mermaid onto stage).

## Provenance caption

When a diagram is ground-truthed from code, caption one line of provenance
(e.g. `Source: sdk/packages/core/src/hub/driveShowRuntime.ts`).
