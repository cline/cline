# Handoff · cline-drivemode + Driveagent portfolio

**Reader.** Next agent or human picking up Drivecode / Driveagent work.  
**Repo.** `hhalperin/cline-drive` (local: `profiles/hhalperin/active/cline-drivecode`).  
**Date.** 2026-07-25.

## Problem

Drivecode needs to feel like joining a call with recruitable agents who have real portfolios (config + knowledge graph), not just a Chat toggle and a nameless pair partner. Planning and early UI landed across this tree; implementation of the kernel/homes/recruit path has not.

## Requirements

Must stay true:

- Hub `ws://127.0.0.1:25463` is the single writer of room state. No default second MCP on `:7891`.
- Bun only in this repo.
- Privacy-strict. No transcript/audio persistence without an explicit debug flag. No auto-dump of calls into agent knowledge.
- Drive tab is primary UX. Chat Join is a shortcut only.
- `Team` is Cline’s runtime word. Drive seating presets are `RosterPack`. Spoken “team” = pack displayName or recruit query text.
- `AgentProfile` is an appearance overlay. Prompts/tools/skills live in `.driveagent/<slug>/` (or compile from it), not in Drive facets.
- Events-first stage. WebRTC later.

Out of scope for the next “continue implementation” slice unless Harrison says otherwise:

- Shipping embeddings / graphify for recruit.
- Merging this into upstream `cline/cline` (this draft targets the fork).
- Committing the Cursor canvas file (lives outside the repo under `.cursor/projects/.../canvases/`).

## State so far

### Plans (canonical)

| Path | What |
|---|---|
| [`docs/plans/cline-drivemode/README.md`](README.md) | Plan index, feature table |
| [`00-vision.md`](00-vision.md) … [`06-platform-config.md`](06-platform-config.md) | Vision through platform facets |
| [`05-workflows.md`](05-workflows.md) | 39 workflows (incl. W-37 sheet, W-38 recruit, W-39 gated learn) |
| [`TASK-GRAPH.md`](TASK-GRAPH.md) | Phases 0–5 gates |
| [`prd/prd-driveagent-portfolio.md`](prd/prd-driveagent-portfolio.md) | **PRD 6** portfolio / graph / recruit |
| [`ard/`](ard/) | **ARD-0001…0004** (all Status: Proposed) |
| [`features/DRV-*.md`](features/) | Feature specs including `DRV-PARTICIPANT-SHEET`, `DRV-DRIVEAGENT-HOME`, `DRV-AGENT-GRAPH`, `DRV-RECRUIT` |
| [`examples/driveagent-pair-partner/`](examples/driveagent-pair-partner/) | Example home + BRIEF.md + sample graph |
| [`docs/plans/drivecode-sdk/`](../drivecode-sdk/) | Meta-harness discovery vs Omnigent (sibling plan set) |

### Design / wireframes

| Path | What |
|---|---|
| [`docs/design/drive-wireframes/DRIVE-TAB.md`](../../design/drive-wireframes/DRIVE-TAB.md) | Discord IA in Slack chrome decision |
| [`drive-tab-discord-slack.html`](../../design/drive-wireframes/drive-tab-discord-slack.html) | Interactive Drive-tab prototype (Cline brand tokens) |
| [`CLINE-BRAND-TOKENS.md`](../../design/drive-wireframes/CLINE-BRAND-TOKENS.md) | Measured from cline.bot |
| [`index.html`](../../design/drive-wireframes/index.html) | Historical A/B/C variants (superseded banner) |

### Partial implementation (early chrome only)

| Path | What |
|---|---|
| `apps/cline-hub/src/webview/src/drive/` | `types.ts`, `DriveCallChrome.tsx`, tests |
| `apps/cline-hub/src/webview/src/Chat.tsx` | Wires Drive UI state / persona hint / stage snippet |
| `apps/cli/src/tui/...` | Status bar Drive fields, Ctrl+Shift+D toggle, help entry |

**Not done.** `@cline/drive` package, hub room single-writer for Drive rooms, `.driveagent/` loader, recruit, participant sheet, RosterPack seating.

### Outside this repo (do not expect in the PR tree)

- Canvas: `C:\Users\harri\.cursor\projects\c-Users-harri-Documents-dev-profiles-ai-secretagent-active-cursor-drive\canvases\cline-drivecode-overview.canvas.tsx` (Architecture, Workflows, Platform/Config, Drive-tab demos).
- Sibling prior art: `ai-secretagent/active/{cursor-drive,claude-drive,briefs}`; personal graph pattern: `hhalperin/active/harrison-site`.

### Key decisions already locked in docs (Proposed ARDs)

1. **ARD-0001** — `.driveagent/<slug>/` is the agent home; compile into host runtime; not `.claude/`.
2. **ARD-0002** — Canonical knowledge YAML; derived `.derived/graph.json`.
3. **ARD-0003** — Recruit ranks; RosterPack stays curated; both under Add.
4. **ARD-0004** — Gated learn; no transcript dump.

Roster click = **Transcript | Profile** (W-37). Address-follows-focus only on Transcript.

## Core tension

**Overlay vs home.** Platform config forbade putting prompts in Drive facets. Driveagent homes reintroduce a full agent definition on disk. The compile bridge into Cline must stay the only runtime path, or you get two registries again. Next implementers should land schemas + compile tests before any profile UI that edits prompts in-sheet.

## Open Decision (needs Harrison)

**Accept ARD-0001 through ARD-0004 as written (including lexical-only recruit MVP and propose/accept learn), plus the leadership DEC bundle, or change one default before phase-0 schema work starts?**

Reply with one of: `accept all` | `change: <id and new default>`.

Defaults and board: [LEADERSHIP-BRIEF.md](LEADERSHIP-BRIEF.md), [ard/ARD-0000-status-board.md](ard/ARD-0000-status-board.md), [CHECKLIST-phase0-entry.md](CHECKLIST-phase0-entry.md).

Agent SoT and package location are **Recommended closed** (compile-from-`.driveagent/`; `@cline/drive` in monorepo). Overturn only via `change: …`.

## Suggested next slices (after the decision)

1. Clear [CHECKLIST-phase0-entry.md](CHECKLIST-phase0-entry.md).
2. Phase 0: `@cline/shared` Drive event + home/graph schemas; no-prompt assertion tests; `@cline/drive` scaffold + host port stub.
3. Phase 1: hub ops stub + Drive tab shell (replace webview-local-only state) + participant sheet chooser + gates feed-card MVP.
4. Wire example `examples/driveagent-pair-partner/` into a fixture test for compile.
5. Keep drivecode-sdk plan as the meta-harness track; see [../drivecode-sdk/05-alignment-with-driveagent.md](../drivecode-sdk/05-alignment-with-driveagent.md).

## How to resume

```text
Read: docs/plans/cline-drivemode/LEADERSHIP-BRIEF.md
Then:  SYSTEMS-ANALYSIS.md → HANDOFF.md → ard/ARD-0000-status-board.md → CHECKLIST-phase0-entry.md
Then:  prd/prd-driveagent-portfolio.md → features/DRV-DRIVEAGENT-HOME.md
Smoke: open docs/design/drive-wireframes/drive-tab-discord-slack.html in a browser
```