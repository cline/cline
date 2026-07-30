# Drivecode handoff

## Problem

Drivecode should make Cline feel like a pair-programming call with recruitable agents, shared work, and clear room context. The product north star is a Drive tab with Discord-style information architecture, Slack-like chrome, pair-call interactions, and the cline.bot visual brand.

**Current agent work (2026-07-30):** finish harness leverage on draft [PR #58](https://github.com/hhalperin/cline-drivecode/pull/58). Detailed continuation brief: [plans/drivecode-sdk/07-agent-handoff.md](plans/drivecode-sdk/07-agent-handoff.md).

## Requirements

Keep these constraints:

- The Cline hub is the single writer for Drive room state (discovery / `ensureDetachedHubServer`; do not hardcode ports).
- Do not add a second daemon or default anything to `:7891`.
- Use Bun. Do not use npm, yarn, or pnpm in this repository.
- Keep privacy-strict defaults. Do not persist audio or transcripts without an explicit and visible debug setting.
- Build the stage from typed events first. WebRTC and remote media come later.
- `RosterPack` is a Drive seating preset. It is not Cline `Team`, which remains the runtime execution group.
- `AgentProfile` is an appearance overlay on Cline's configured agent.
- Keep prompts, tools, skills, provider settings, and model IDs in Cline-owned agent configuration or `.driveagent/<slug>/` source that compiles into it.
- Do not fork `ConfiguredAgent` into Drive-owned prompt storage.
- Do not modify Cursor or VS Code chrome through DOM injection.
- Do not create a second agent registry or a second runtime path.

The phase 1 package decision is **closed** by [cline-drivemode/decisions/DEC-package-location.md](plans/cline-drivemode/decisions/DEC-package-location.md): `@cline/drive` in this monorepo. Extract only when a second host needs the package.

Leadership planning wave entry. [cline-drivemode/LEADERSHIP-BRIEF.md](plans/cline-drivemode/LEADERSHIP-BRIEF.md). Phase 0 entry checklist. [cline-drivemode/CHECKLIST-phase0-entry.md](plans/cline-drivemode/CHECKLIST-phase0-entry.md).

## State so far

### Active engineering track

| Item | Status |
|---|---|
| Show backlog director (slices 1–7 + S) | **On main** (merged #55) |
| `createDriveHarness` + webview `reduceRoom` fold | **On main** (merged #56) |
| Hub join / raise-hand / address / stage / mode via harness | **On PR #58** (join + raise-hand); address/stage/mode already on main |
| Thin `drive.show.*` onto harness (break import cycle) | **Next** — see [07-agent-handoff.md](plans/drivecode-sdk/07-agent-handoff.md) |
| Phase-2 `expandRosterPack` / `capPreset` / `resolveAddress` | Not started |
| Leverage checklist | [plans/drivecode-sdk/06-sdk-leverage.md](plans/drivecode-sdk/06-sdk-leverage.md) |

Branch: `cursor/drive-harness-remaining-1929`. After SDK edits: `bun run build:sdk`.

### Product and interaction plans

- `docs/drivecode/plans/cline-drivemode/00-vision.md` defines the Drive tab, pair-call experience, and staged product direction.
- `docs/drivecode/plans/cline-drivemode/01-architecture.md` defines the room model, the hub boundary, and the event-first architecture.
- `docs/drivecode/plans/cline-drivemode/05-workflows.md` contains 45 user workflows (incl. Group I SDLC / requirements leadership). It maps them to features and calls out gaps.
- `docs/drivecode/plans/cline-drivemode/06-platform-config.md` defines the 34-facet platform inventory, `RosterPack`, `AgentProfile`, ownership, privacy, and phases.
- `docs/drivecode/plans/cline-drivemode/features/` contains the DRV feature plans.
- `docs/drivecode/plans/cline-drivemode/show-backlog-director/` is the dependency-mapped implementation plan for planned Show backlog + director (enqueue → rank → present → script); feature [DRV-SHOW-BACKLOG](plans/cline-drivemode/features/DRV-SHOW-BACKLOG.md). **Implementation of listed slices is on main** — treat plans as reference, not a greenfield backlog.
- `docs/drivecode/plans/cline-drivemode/TASK-GRAPH.md` orders phases and acceptance gates.
- `docs/drivecode/plans/cline-drivemode/AGENT-RUNBOOK.md` explains how the next agent should select, implement, and verify tasks.
- `docs/drivecode/plans/cline-drivemode/prd/prd-driveagent-portfolio.md` defines Driveagent portfolios, knowledge graphs, and recruit.
- `docs/drivecode/plans/cline-drivemode/ard/` records the decisions for Driveagent home, canonical graph data, recruit, RosterPack, and gated learning (see status board).
- `docs/drivecode/plans/cline-drivemode/examples/driveagent-pair-partner/` is the concrete agent-home and graph fixture.
- `docs/drivecode/plans/cline-drivemode/LEADERSHIP-BRIEF.md` is the SE/PM planning wave that closes contradictions and names Phase 0 entry criteria.
- `docs/drivecode/plans/cline-drivemode/SYSTEMS-ANALYSIS.md` is the end-to-end systems analysis (context, interfaces, NFRs, as-is/to-be, delivery slices).

### Drivecode SDK plan

- `docs/drivecode/plans/drivecode-sdk/00-discovery-omnigent.md` records the Omnigent-inspired meta-harness research.
- `docs/drivecode/plans/drivecode-sdk/01-problem-and-scope.md` defines the portability problem and scope.
- `docs/drivecode/plans/drivecode-sdk/02-architecture.md` defines the host port, capability descriptor, policies, and conformance kit.
- `docs/drivecode/plans/drivecode-sdk/03-phased-plan.md` provides verifiable implementation phases.
- `docs/drivecode/plans/drivecode-sdk/04-relationship-to-cline-drivecode.md` explains how the harness relates to the Cline SDK and the cline-drivecode product.
- `docs/drivecode/plans/drivecode-sdk/06-sdk-leverage.md` is the live leverage checklist (harness vs `@cline/sdk`).
- `docs/drivecode/plans/drivecode-sdk/07-agent-handoff.md` is the **detailed session handoff** for the current PR track.
- `docs/drivecode/plans/drivecode-sdk/decisions.tsv` is the decision trail for that plan.

The harness proposes operations, the Cline host commits them through the hub, and the webview or CLI projects resulting events (`reduceRoom` — one fold).

### Wireframes and brand

- `docs/drivecode/design/drive-wireframes/DRIVE-TAB.md` records the Discord information architecture inside Slack-like single-workspace chrome.
- `docs/drivecode/design/drive-wireframes/drive-tab-discord-slack.html` is the primary interactive Drive tab prototype.
- `docs/drivecode/design/drive-wireframes/CLINE-BRAND-TOKENS.md` records the palette, typography, spacing, borders, and radii measured from cline.bot.
- `docs/drivecode/design/drive-wireframes/index.html` contains the earlier Chat-based variants. Its banner marks them as superseded where appropriate.
- Prefer the in-repo overview canvas: [docs/drivecode/design/drive-wireframes/overview-canvas.html](./design/drive-wireframes/overview-canvas.html). Click-through runbook: [DEMO.md](./design/drive-wireframes/DEMO.md).

### Implementation (no longer “scaffold only”)

Hub-owned rooms, Show backlog wire commands, Drive webview chrome, and CLI Drive surfaces exist on main. Entry points:

- Hub webview Drive: `apps/cline-hub/src/webview/src/drive/` (`useDriveSession`, `foldRoomSnapshot`, stage/roster/show UI)
- Hub handlers: `sdk/packages/core/src/hub/server/handlers/drive-*.ts`
- Harness: `sdk/packages/drive/src/harness.ts`
- Product screenshots: `docs/drivecode/assets/`

### Top gaps

- Thin hub `drive.show.*` onto harness without circular imports ([07-agent-handoff.md](plans/drivecode-sdk/07-agent-handoff.md) §5).
- Phase-2 pure helpers: `expandRosterPack`, `applySeatSourceDelta`, `capPreset`, `resolveAddress`; durable `addRosterPack`.
- `DRV-GATES` v1 action taxonomy enums landed (`sdk/packages/shared/src/drive/gates.ts`); still needs expiry rules and an owner for the approval UI.
- Hub reconnect needs acceptance criteria and degraded-state UX under `DRV-ROOM-MVP`.
- Revise-not-restart needs a kernel acceptance criterion that preserves useful work after an interruption.
- Multi-room focus needs a product rule for whether an unfocused room is only a view or remains an active runtime.

## Demo

Open [docs/drivecode/design/drive-wireframes/DEMO.md](./design/drive-wireframes/DEMO.md) for HTML, hub Chat, CLI, and overview canvas steps. Live hub rooms use `bun run --cwd apps/cline-hub dev` / `bun run cli -i` with provider credentials; demo adapters stay behind composition-root flags (`CLINE_DEMO_*`, `?demoPlans=1`) — see root `AGENTS.md`.

## Core tension

Drive needs a portable domain and policy layer without becoming a second agent runtime. Putting the package in this monorepo gives phase 1 direct access to Cline types, hub operations, tests, and release checks. Extracting it too early would add versioning and adapter work before another host proves that boundary.

The implementation must also keep `AgentProfile` separate from agent behavior. Profiles may change display name and visual identity. They must not become a second home for prompts, tools, skills, providers, or model selection.

## Decision (Accepted 2026-07-29)

**Package location — Accepted.** See [cline-drivemode/decisions/DEC-package-location.md](plans/cline-drivemode/decisions/DEC-package-location.md).

**ARD-0000…0013 + DEC bundle — Accepted** via human `accept all` (2026-07-29). ARD-0014 (Chat-fork lifecycle) later Accepted on main.

Board: [cline-drivemode/ard/ARD-0000-status-board.md](plans/cline-drivemode/ard/ARD-0000-status-board.md).
