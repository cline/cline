# Share-Screen Canvas — Bootstrap reference

> Planner-authored reference for the `share-screen-canvas` orchestrate run. Every worker on this
> run clones a branch that already contains this file. **Read it first.** It is the curated map of
> the share-screen slice of cline-drivemode (Drivemode / Drivecode) so you do not have to re-discover
> the codebase. Paths are absolute against the repo root (`/workspace` in the clone).

## The one-paragraph mental model

Drivemode is a **call room** where a human and one or more agents pair-program. "Share screen" here is
**not pixels** — an agent shares its screen by emitting *typed work events* (edit / command / test / plan)
that render as **cards** on a shared surface called **Spotlight** (the wire protocol still calls it `stage`).
A human can also take the Spotlight with a *structured pin* (a selection / file / terminal reference).
The **hub daemon is the single writer** of room state; clients are read-only projections that mutate via
`call_*` ops and receive `room_snapshot` broadcasts. WebRTC / real pixel capture is explicitly deferred.
A future "simulated-live" track renders Cursor-style screenshot/clip artifacts driven by a **DirectorScript**
(say + sticky show beats) and a **show backlog**, biased by the current Spotlight participant.

## Current maturity (important — the plan is ahead of the code)

| Layer | Status |
|---|---|
| Vision + schemas (`@cline/shared` drive/*) | Locked / implemented |
| Pure policies (`@cline/drive`: `reduceRoom`, `projectStage`, `rankShowBacklog`, narration) | Implemented / partial |
| Hub handlers (`@cline/core`: `call_join`, `call_set_stage`, `call_record_work`, `drive.*`) | Implemented / partial |
| Canonical `Spotlight.tsx` webview component | Built + tested but **NOT mounted in Chat** |
| Hub Chat "Join call" wiring (`call_join` / `call_set_stage` from webview) | **Gap** — Chat behaves as local Drive layer (fixture + task bank + `StickyStagePane`) |
| Status Hub (`/status`, board / changelog / dependency-map) | Implemented (shippable) |
| Demo adapters (`@cline/drivecode-demo`) | Status/teams fixtures only — no share-screen fixture yet |
| CLI TUI Drive | Stub (status-bar "Drive on" toggle only; no Spotlight column) |
| Demo share (`drive_demo_frame`), narration-in-feed, captions, PiP | Schemas/partial or planned |

The highest-leverage share-screen gap: **Chat Join does not post `call_join`, `Spotlight.tsx` is not
mounted, and human pin → `call_set_stage` is not wired.** A "live demo" should make the Spotlight
share-screen loop *visible and runnable* without requiring an LLM credential.

## Plans & vision docs (read for the canvas)

- `docs/plans/cline-drivemode/00-vision.md` — naming, "share screen = structured state not pixels", phases.
- `docs/plans/cline-drivemode/MVP-UI-SHARED-SCREEN.md` — Slice A (`stageReducer`+`Stage.tsx`), Slice B (`call_set_stage`), Slice C (Drive tab mount). Lists have/missing.
- `docs/plans/cline-drivemode/share-and-router/PLAN.md` — canonical architecture: dual backlog (Do + Show), DirectorScript, Spotlight priority, per-agent media bags, mute ⟂ deafen, A2A. Phases 1–10.
- `docs/plans/cline-drivemode/share-and-router/README.md` — index.
- `docs/plans/cline-drivemode/09-demo-share.md` + `ard/ARD-0011-demo-share-track.md` — share modes `structured | demo | pixel`; `drive_demo_frame`.
- `docs/plans/cline-drivemode/11-spotlight-a2a.md` — spotlight participant biases show backlog / say / TTS; mute vs deafen; A2A.
- `docs/plans/cline-drivemode/ard/ARD-0005-status-hub.md` — Status Hub (accepted + implemented).
- `docs/plans/cline-drivemode/ard/ARD-0006-pip-partner-companion.md` + `features/DRV-PIP.md` — PiP companion (planned).
- Feature specs cluster: `features/DRV-STAGE.md`, `DRV-SHARE.md`, `DRV-DEMO-SHARE.md`, `DRV-CALL-STRIP.md`, `DRV-NARRATION.md`, `DRV-CAPTIONS.md`, `DRV-PARTICIPANT-SHEET.md`, `DRV-DRIVE-TAB.md`.
- Architecture context: `docs/plans/cline-drivemode/01-architecture.md`, `02-research-streaming.md`, `04-future-multi-user.md`.

## Product-facing docs

- `docs/drivecode/README.md` — authoritative product+code map (Status Hub, `buildDependencyMap`, Drive/Spotlight semantics, hub ops table, "not implemented" list).
- `docs/drivecode/architecture.md`, `docs/drivecode/native-vs-drivecode.md`, `docs/drivecode/skills-inventory.md`.
- `docs/design/drive-wireframes/DEMO.md` — **runnable demo runbook** for the share-screen Join path.
- `docs/design/drive-wireframes/DRIVE-TAB.md`, `CLINE-BRAND-TOKENS.md`, `overview-canvas.html`, `drive-tab-discord-slack.html`, `index.html`.
- `apps/drivecode-demo/README.md` — `CLINE_DEMO_*` / `?demoPlans` flag reference.
- `AGENTS.md` → "Drive / Status Hub (product surfaces)" section (ports, demo flags, build prereqs).

## Code implementation (read for the canvas + demo)

SDK `@cline/shared` (`sdk/packages/shared/src/`):
- `drive/room.ts` — `StageState`, `StageSharer`, `StagePin`, `StageCard` (core share-screen shapes).
- `drive/share.ts` — `ShareMode` (`structured|demo|pixel`), `DemoArtifactRef`, structured share payloads.
- `drive/director.ts` — `ShowBacklogItem`, `DirectorScript`, `StageDirectorState`, `AgentMediaBag`.
- `drive/roomLive.ts` — `DriveRoomLiveState` (spotlight id, mute/deafen, director snapshot).
- `drive/events.ts` — drive events incl. `conversation.narration`.
- `status/dependency-map.ts` — `buildDependencyMap()`.
- `hub.ts` — hub command names (`call_join`, `call_set_stage`, `call_record_work`, `drive.spotlight.set`, ...).

SDK `@cline/drive` (`sdk/packages/drive/src/`):
- `reduceRoom.ts` — pure room fold + `projectStage()`.
- `director/rankBacklogs.ts` — `rankShowBacklog`, `advanceScriptBeat`.
- `director/showTemplates.ts`, `room/participantControls.ts` (`setSpotlight()`), `narrationPolicy.ts`, `router/planRoute.ts`.

SDK `@cline/core` (`sdk/packages/core/src/hub/`):
- `collaboration/room.ts` — `DriveRoomStore` (in-memory rooms, session↔room link, stage mutations).
- `collaboration/work-from-tool.ts` — tool events → work records → stage cards.
- `server/handlers/drive-room-handlers.ts` — `call_join`, `call_set_stage`, `call_record_work`, mute, mode.
- `server/handlers/drive-handlers.ts` — `drive.spotlight.set`, mute/deafen, `drive.show.present`, mermaid artifact.
- `drive-producers/produceMermaid.ts`, `client/ui-client.ts` (subscriptions).

Hub app `apps/cline-hub/src/`:
- `server/drive-calls.ts`, `server/drive-commands.ts`, `server/agent-events.ts` (tool→`call_record_work`), `server/hub.ts`, `webview-protocol.ts`.
- webview `webview/src/drive/Spotlight.tsx` (canonical Spotlight UI — not yet mounted in Chat), `stageReducer.ts` (`projectStageCardsFromToolEvents` / `projectStageFromMessages`), `DriveCallChrome.tsx`, `StickyStagePane.tsx` (what Chat renders today), `useDriveSession.ts`, `types.ts`, `pinDefaults.ts` (`buildHumanPinDefaults`), `demoFixture.ts` (`DRIVE_DEMO_FIXTURE`), `DriveRoomChrome.tsx`, `voice/DriveMicBar.tsx`.
- webview `webview/src/Chat.tsx` (main in-call surface; Join + stage split), `components/views/drive-view.tsx` (Drive tab home), `components/views/status-view.tsx`, `App.tsx` (composition root; `readDrivecodeDemoHubBootstrap()`).

CLI TUI `apps/cli/src/tui/`: `root.tsx` (composition root), `status/*` (`StatusSnapshotSource` port + adapters), `views/status-view.tsx`, `contexts/session-context.tsx` (`toggleDrive`), `components/status-bar.tsx`.

Demo `apps/drivecode-demo/src/`: `cli-env.ts` (`readDrivecodeDemoCliBootstrap`), `hub-query.ts` (`readDrivecodeDemoHubBootstrap`), `drive-plans-demo-status-source.ts`, `drive-plans-demo-teams-source.ts`, `plan-tasks-fixture.ts`.

## Ports & demo bootstrap (do not read env flags in views — only composition roots)

- `StatusSnapshotSource` (CLI): live = hub adapter; demo = `DrivePlansDemoStatusSnapshotSource` behind hub fallback when `CLINE_DEMO_STATUS_PLANS=1`.
- `StatusTeamsSource` (hub): live = `HubStatusTeamsSource`; demo = `DrivePlansDemoTeamsSource` when `?demoPlans=1`.
- Env/query flags: `CLINE_DEMO_STATUS_PLANS`, `CLINE_DEMO_STATUS_LENS`, `CLINE_DEMO_OPEN_STATUS`, `CLINE_DEMO_DRIVE`, `CLINE_DISABLE_CLINE_PASS_NOTICE`; hub `?demoPlans=1`, `?statusMode=board|changelog|dependency-map`.

## Build / run / verify commands

- `bun install` at repo root. **`bun run build:sdk`** after any `@cline/shared|drive|core` edit (SDK packages resolve via compiled `dist/`; no hot reload).
- Hub dev + dashboard: `bun run --cwd apps/cline-hub dev` → open the **printed** dashboard URL (never a hardcoded port) → Connect. Surfaces: Drive tab, Chat (Join call → Stage), `/status`.
- Status Hub dependency-map demo (no LLM needed): `<printed-dashboard-url>/status?demoPlans=1&statusMode=dependency-map`.
- CLI Drive/Status teaser: `CLINE_DEMO_DRIVE=1 CLINE_DEMO_STATUS_PLANS=1 CLINE_DEMO_OPEN_STATUS=1 CLINE_DEMO_STATUS_LENS=dependency-map CLINE_DISABLE_CLINE_PASS_NOTICE=1 bun run cli -i --key "$ANTHROPIC_API_KEY"`.
- GUI/screenshots: a virtual X display is live at `DISPLAY=:1`. Launch GUI/dev in `tmux`. Product screenshots live in `docs/assets/drivecode/` (e.g. `drive-call.png`, `drive-tab.png`, `status-*.png`).
- Hub webview tests: `bun --cwd apps/cline-hub test` (vitest) for `drive/*` reducers/components.

## Brand / visual reference (for the canvas)

Match the existing self-contained HTML canvas style at `docs/design/drive-wireframes/overview-canvas.html`:
dark bg `#0A0A0A`, brand purple `#9F58FA`, fonts DM Sans / Schibsted Grotesk / Space Grotesk. Tokens in
`docs/design/drive-wireframes/CLINE-BRAND-TOKENS.md`.
