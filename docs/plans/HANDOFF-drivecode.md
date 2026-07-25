# Drivecode handoff

## Problem

Drivecode should make Cline feel like a pair-programming call with recruitable agents, shared work, and clear room context. The product north star is a Drive tab with Discord-style information architecture, Slack-like chrome, pair-call interactions, and the cline.bot visual brand.

The planning set is broad. The implementation is still an MVP UI scaffold. The next session needs one entry point that separates accepted constraints, proposed design, partial code, and unresolved work.

## Requirements

Keep these constraints:

- The Cline hub at `ws://127.0.0.1:25463` is the single writer for Drive room state.
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

The phase 1 package decision remains open. Until Harrison answers it, use the reversible default in the Open Decision section.

## State so far

### Product and interaction plans

- `docs/plans/cline-drivemode/00-vision.md` defines the Drive tab, pair-call experience, and staged product direction.
- `docs/plans/cline-drivemode/01-architecture.md` defines the room model, the hub boundary, and the event-first architecture.
- `docs/plans/cline-drivemode/05-workflows.md` contains 39 user workflows. It maps them to features and calls out gaps.
- `docs/plans/cline-drivemode/06-platform-config.md` defines the 34-facet platform inventory, `RosterPack`, `AgentProfile`, ownership, privacy, and phases.
- `docs/plans/cline-drivemode/features/` contains the DRV feature plans.
- `docs/plans/cline-drivemode/TASK-GRAPH.md` orders phases and acceptance gates.
- `docs/plans/cline-drivemode/AGENT-RUNBOOK.md` explains how the next agent should select, implement, and verify tasks.
- `docs/plans/cline-drivemode/prd/prd-driveagent-portfolio.md` defines Driveagent portfolios, knowledge graphs, and recruit.
- `docs/plans/cline-drivemode/ard/` records the proposed decisions for Driveagent home, canonical graph data, recruit, RosterPack, and gated learning.
- `docs/plans/cline-drivemode/examples/driveagent-pair-partner/` is the concrete agent-home and graph fixture.

### Drivecode SDK plan

- `docs/plans/drivecode-sdk/00-discovery-omnigent.md` records the Omnigent-inspired meta-harness research.
- `docs/plans/drivecode-sdk/01-problem-and-scope.md` defines the portability problem and scope.
- `docs/plans/drivecode-sdk/02-architecture.md` defines the host port, capability descriptor, policies, and conformance kit.
- `docs/plans/drivecode-sdk/03-phased-plan.md` provides verifiable implementation phases.
- `docs/plans/drivecode-sdk/04-relationship-to-cline-drivecode.md` explains how the harness relates to the Cline SDK and the cline-drivecode product.
- `docs/plans/drivecode-sdk/decisions.tsv` is the decision trail for that plan.

The current plan treats the meta-harness role and the planned `@cline/drive` kernel as one package. It does not create a parallel runtime. The harness proposes operations, the Cline host commits them through the hub, and the webview or CLI projects resulting events.

### Wireframes and brand

- `docs/design/drive-wireframes/DRIVE-TAB.md` records the Discord information architecture inside Slack-like single-workspace chrome.
- `docs/design/drive-wireframes/drive-tab-discord-slack.html` is the primary interactive Drive tab prototype.
- `docs/design/drive-wireframes/CLINE-BRAND-TOKENS.md` records the palette, typography, spacing, borders, and radii measured from cline.bot.
- `docs/design/drive-wireframes/index.html` contains the earlier Chat-based variants. Its banner marks them as superseded where appropriate.
- `docs/design/drive-wireframes/variant-a.png`, `variant-b.png`, and `variant-c.png` are reference captures for the earlier variants.

Open either HTML prototype directly from File Explorer. PowerShell can also open them:

```powershell
Start-Process .\docs\design\drive-wireframes\drive-tab-discord-slack.html
Start-Process .\docs\design\drive-wireframes\index.html
```

### Partial phase 1 implementation

The working branch includes an MVP UI scaffold, not production-complete:

- `apps/cline-hub/src/webview/src/drive/DriveCallChrome.tsx` provides the first call chrome.
- `apps/cline-hub/src/webview/src/drive/types.ts` defines the local UI types.
- `apps/cline-hub/src/webview/src/drive/types.test.ts` covers those type helpers.
- `apps/cline-hub/src/webview/src/Chat.tsx` wires the first Drive state, persona hint, and stage snippet into Chat.
- `apps/cli/src/tui/components/status-bar.tsx` shows Drive status.
- `apps/cli/src/tui/hooks/use-root-keyboard.ts` adds the `Ctrl+Shift+D` interaction.
- `apps/cli/src/tui/components/dialogs/help-dialog.tsx`, `session-context.tsx`, `chat-view.tsx`, and `status-bar.test.ts` complete the early CLI wiring.

This code does not yet implement hub-owned Drive rooms, reconnect convergence, a Drive tab route, recruit, RosterPack seating, or Driveagent loading.

### Top gaps

- `DRV-GATES` still needs an action taxonomy, expiry rules, and an owner for the approval UI.
- Hub reconnect needs acceptance criteria and degraded-state UX under `DRV-ROOM-MVP`.
- Revise-not-restart needs a kernel acceptance criterion that preserves useful work after an interruption.
- Multi-room focus needs a product rule for whether an unfocused room is only a view or remains an active runtime.

### Prior art and external context

- Cursor Drive prior art lives at `C:\Users\harri\Documents\dev\profiles\ai-secretagent\active\cursor-drive`.
- Claude Drive prior art lives at `C:\Users\harri\Documents\dev\profiles\ai-secretagent\active\claude-drive`.
- The overview canvas lives outside this repository at `C:\Users\harri\.cursor\projects\c-Users-harri-Documents-dev-profiles-ai-secretagent-active-cursor-drive\canvases\cline-drivecode-overview.canvas.tsx`.
- The canvas is not in git. The next session must open it from that absolute path.
- This handoff lives on branch `docs/drivecode-handoff`.

## Core tension

Drive needs a portable domain and policy layer without becoming a second agent runtime. Putting the package in this monorepo gives phase 1 direct access to Cline types, hub operations, tests, and release checks. Extracting it too early would add versioning and adapter work before another host proves that boundary.

The implementation must also keep `AgentProfile` separate from agent behavior. Profiles may change display name and visual identity. They must not become a second home for prompts, tools, skills, providers, or model selection.

## Open Decision (needs Harrison)

Should `drivecode-sdk` live as `sdk/packages/drivecode` or `@cline/drivecode` inside this monorepo in phase 1, or as a separate `drivecode-sdk` repo that cline-drivecode consumes?

Recommended default. Put it in the monorepo first for delivery speed and direct conformance testing. Extract it only when a second host needs the package.
