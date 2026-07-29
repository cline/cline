# Share-screen canvas — companion

Explains the interactive canvas at
[`docs/design/drive-wireframes/share-screen-canvas.html`](../../../design/drive-wireframes/share-screen-canvas.html).
Open that file directly in a browser (`file://…`) — it is self-contained, needs no
build step, and loads only Google Fonts from a CDN.

## What the canvas is

A three-layer map of the **share-screen** slice of cline-drivemode (Drive / Drivecode).
"Share screen" here is **not pixels**: an agent shares by emitting *typed work events*
(edit / command / test / plan) that render as **cards** on a shared surface called
**Spotlight** — the hub wire protocol still calls it `stage`. The hub daemon is the
single writer of room state; clients mutate through `call_*` ops and receive
`room.snapshot` broadcasts. The canvas lays out nodes grouped by three layers, draws
**plan → code** and **doc → code** edges, and marks the three gaps that keep the live
loop from running.

Interactions: click any node to trace its edges and neighbors; click a legend chip to
filter by maturity; click a gap card (or an index row) to jump to and focus a node.

## The three-layer map

| Layer | What it holds | Reads as |
|---|---|---|
| **1 · Plans & vision** | What share-screen *should* be — vision, MVP slices, the share-and-router master plan, Spotlight/A2A, demo-share, feature specs | The plan is ahead of the code |
| **2 · Product documentation** | What is shipped and how to run it, cited to code — the drivecode reference, the demo runbook, architecture, the overview canvas + brand tokens, demo flags | Shippable / accurate today |
| **3 · Code & current status** | Schemas → pure policies → hub handlers → webview, color-coded by maturity | Foundation solid; the webview wire is the gap |

## Maturity legend

Every node is color-coded by one of five levels:

- **locked** — frozen foundation; changing it is a breaking change.
- **implemented** — built and shippable/tested.
- **partial** — real code exists but is incomplete or not the primary path.
- **planned** — specified in a plan, with little or no code yet.
- **gap** — the specific missing wire that breaks the live share-screen loop.

## The three highlighted gaps

The highest-leverage share-screen work. All three live in the hub webview; the hub
*receive* side (`drive-room-handlers.ts`) and the wire frames
(`webview-protocol.ts`) already exist — the webview simply never calls them.

- **Gap A — Chat "Join call" does not post `call_join`.** `Chat.tsx` drives local Drive
  UI state (via `useDriveSession`) on Join; it never sends the `call_join` frame, so no
  hub room is created and no `room.snapshot` is shared.
- **Gap B — the canonical `Spotlight.tsx` is built + tested but NOT mounted.** Chat
  renders `StickyStagePane` (the local Drive layer). `Spotlight.tsx` has a passing
  branch test (`Spotlight.branch.test.ts`) but zero importers.
- **Gap C — human pin → `call_set_stage` is unwired.** `pinDefaults.ts`
  (`buildHumanPinDefaults`) builds selection / file / terminal pins, but "Spotlight me"
  never emits `call_set_stage`, so the hub never owns the human sharer pointer.

## Referenced files (one line each)

### Layer 1 · Plans & vision

- [`docs/plans/cline-drivemode/00-vision.md`](../00-vision.md) — north star; "share screen = structured state, not pixels"; Spotlight vs `stage`.
- [`docs/plans/cline-drivemode/MVP-UI-SHARED-SCREEN.md`](../MVP-UI-SHARED-SCREEN.md) — Slice A/B/C plan with the "have / missing" table that names the gaps.
- [`docs/plans/cline-drivemode/features/DRV-STAGE.md`](../features/DRV-STAGE.md) — acceptance criteria for the Spotlight/stage projection.
- [`docs/plans/cline-drivemode/features/DRV-SHARE.md`](../features/DRV-SHARE.md) — structured human share (selection / file / terminal pin); bidirectional share.
- [`docs/plans/cline-drivemode/share-and-router/PLAN.md`](../share-and-router/PLAN.md) — canonical architecture: dual backlog, DirectorScript, Spotlight priority, mute ⟂ deafen, A2A.
- [`docs/plans/cline-drivemode/share-and-router/README.md`](../share-and-router/README.md) — index for the share-and-router plan cluster.
- [`docs/plans/cline-drivemode/11-spotlight-a2a.md`](../11-spotlight-a2a.md) — Spotlight biases show backlog / say / TTS voice; mute ⟂ deafen; A2A.
- [`docs/plans/cline-drivemode/09-demo-share.md`](../09-demo-share.md) — share modes `structured | demo | pixel`; `drive_demo_frame` artifacts.
- [`docs/plans/cline-drivemode/ard/ARD-0011-demo-share-track.md`](../ard/ARD-0011-demo-share-track.md) — decision record for the demo-share track.
- [`docs/plans/cline-drivemode/features/DRV-DEMO-SHARE.md`](../features/DRV-DEMO-SHARE.md) — feature spec for demo-share artifact cards.
- [`docs/plans/cline-drivemode/features/DRV-CALL-STRIP.md`](../features/DRV-CALL-STRIP.md) — call strip share/now-next/interrupt controls.
- [`docs/plans/cline-drivemode/features/DRV-NARRATION.md`](../features/DRV-NARRATION.md) — narration policy (decisions, not keystrokes).
- [`docs/plans/cline-drivemode/features/DRV-CAPTIONS.md`](../features/DRV-CAPTIONS.md) — live captions spec (Phase 3 voice).
- [`docs/plans/cline-drivemode/features/DRV-PARTICIPANT-SHEET.md`](../features/DRV-PARTICIPANT-SHEET.md) — participant roster sheet.
- [`docs/plans/cline-drivemode/features/DRV-DRIVE-TAB.md`](../features/DRV-DRIVE-TAB.md) — Drive tab IA (Slice C primary mount).
- [`docs/plans/cline-drivemode/features/DRV-PIP.md`](../features/DRV-PIP.md) — PiP partner companion (planned).
- [`docs/plans/cline-drivemode/ard/ARD-0006-pip-partner-companion.md`](../ard/ARD-0006-pip-partner-companion.md) — decision record for the PiP companion.
- [`docs/plans/cline-drivemode/01-architecture.md`](../01-architecture.md) — hub single-writer boundary and client projections.
- [`docs/plans/cline-drivemode/02-research-streaming.md`](../02-research-streaming.md) — streaming research; pixels are an anti-pattern for the agent stage.
- [`docs/plans/cline-drivemode/04-future-multi-user.md`](../04-future-multi-user.md) — deferred multi-human / WebRTC media plane.

### Layer 2 · Product documentation

- [`docs/drivecode/README.md`](../../../drivecode/README.md) — authoritative product+code map; `StageState = {sharer, pin, cards}`; hub ops; "Not implemented" list.
- [`docs/design/drive-wireframes/DEMO.md`](../../../design/drive-wireframes/DEMO.md) — runnable demo runbook for the production Join / share-handoff path.
- [`docs/drivecode/architecture.md`](../../../drivecode/architecture.md) — architecture diagrams behind the drivecode reference.
- [`docs/design/drive-wireframes/overview-canvas.html`](../../../design/drive-wireframes/overview-canvas.html) — the self-contained HTML canvas whose style this canvas mirrors.
- [`docs/design/drive-wireframes/CLINE-BRAND-TOKENS.md`](../../../design/drive-wireframes/CLINE-BRAND-TOKENS.md) — measured Cline brand tokens (dark bg, purple `#9F58FA`, DM Sans / Schibsted / Space Grotesk).
- [`docs/design/drive-wireframes/DRIVE-TAB.md`](../../../design/drive-wireframes/DRIVE-TAB.md) — Drive tab decision record + throwaway prototype notes.
- [`apps/drivecode-demo/README.md`](../../../../apps/drivecode-demo/README.md) — `CLINE_DEMO_*` / `?demoPlans` flag reference; demo adapters at composition roots only.

### Layer 3 · Code & current status

- [`sdk/packages/shared/src/drive/room.ts`](../../../../sdk/packages/shared/src/drive/room.ts) — **locked** share-screen shapes: `StageState`, `StageSharer`, `StagePin`, `StageCard`.
- [`sdk/packages/shared/src/hub.ts`](../../../../sdk/packages/shared/src/hub.ts) — **locked** wire command names (`call_join`, `call_set_stage`, `call_record_work`, `drive.spotlight.set`, …).
- [`sdk/packages/shared/src/drive/share.ts`](../../../../sdk/packages/shared/src/drive/share.ts) — `ShareMode` (`structured|demo|pixel`) and `DemoArtifactRef` schemas.
- [`sdk/packages/shared/src/drive/director.ts`](../../../../sdk/packages/shared/src/drive/director.ts) — `ShowBacklogItem`, `DirectorScript`, `StageDirectorState`, `AgentMediaBag` schemas.
- [`sdk/packages/shared/src/drive/roomLive.ts`](../../../../sdk/packages/shared/src/drive/roomLive.ts) — `DriveRoomLiveState` (spotlight id, mute/deafen, director snapshot).
- [`sdk/packages/shared/src/drive/events.ts`](../../../../sdk/packages/shared/src/drive/events.ts) — drive events including `conversation.narration`.
- [`sdk/packages/drive/src/reduceRoom.ts`](../../../../sdk/packages/drive/src/reduceRoom.ts) — pure room fold + `projectStage()`, the portable kernel.
- [`sdk/packages/drive/src/director/rankBacklogs.ts`](../../../../sdk/packages/drive/src/director/rankBacklogs.ts) — `rankShowBacklog` / `advanceScriptBeat` spotlight-aware ranking.
- [`sdk/packages/drive/src/room/participantControls.ts`](../../../../sdk/packages/drive/src/room/participantControls.ts) — `setSpotlight()` and mute/deafen policy helpers.
- [`sdk/packages/core/src/hub/collaboration/room.ts`](../../../../sdk/packages/core/src/hub/collaboration/room.ts) — `DriveRoomStore`: in-memory rooms, session↔room link, stage mutations.
- [`sdk/packages/core/src/hub/collaboration/work-from-tool.ts`](../../../../sdk/packages/core/src/hub/collaboration/work-from-tool.ts) — tool events → work records → stage cards.
- [`sdk/packages/core/src/hub/server/handlers/drive-room-handlers.ts`](../../../../sdk/packages/core/src/hub/server/handlers/drive-room-handlers.ts) — hub handlers for `call_join`, `call_set_stage`, `call_record_work`, mute, mode (receive side ready).
- [`sdk/packages/core/src/hub/server/handlers/drive-handlers.ts`](../../../../sdk/packages/core/src/hub/server/handlers/drive-handlers.ts) — `drive.spotlight.set`, mute/deafen, `drive.show.present`, mermaid producer.
- [`apps/cline-hub/src/server/drive-calls.ts`](../../../../apps/cline-hub/src/server/drive-calls.ts) — relays `call_*` frames from the webview protocol to the hub.
- [`apps/cline-hub/src/webview-protocol.ts`](../../../../apps/cline-hub/src/webview-protocol.ts) — declares the `call_join` / `call_set_stage` / `call_get_room` webview frames.
- [`apps/cline-hub/src/server/agent-events.ts`](../../../../apps/cline-hub/src/server/agent-events.ts) — bridges completed agent tools → `call_record_work`.
- [`apps/cline-hub/src/webview/src/drive/stageReducer.ts`](../../../../apps/cline-hub/src/webview/src/drive/stageReducer.ts) — `projectStageCardsFromToolEvents` / `projectStageFromMessages` offline projection.
- [`apps/cline-hub/src/webview/src/drive/Spotlight.tsx`](../../../../apps/cline-hub/src/webview/src/drive/Spotlight.tsx) — **Gap B**: canonical events-first Spotlight surface, built but not mounted.
- [`apps/cline-hub/src/webview/src/drive/Spotlight.branch.test.ts`](../../../../apps/cline-hub/src/webview/src/drive/Spotlight.branch.test.ts) — passing branch test for the canonical Spotlight.
- [`apps/cline-hub/src/webview/src/drive/StickyStagePane.tsx`](../../../../apps/cline-hub/src/webview/src/drive/StickyStagePane.tsx) — the local Drive layer Chat renders today.
- [`apps/cline-hub/src/webview/src/drive/DriveCallChrome.tsx`](../../../../apps/cline-hub/src/webview/src/drive/DriveCallChrome.tsx) — Chat Join / stage-on-off / call strip chrome.
- [`apps/cline-hub/src/webview/src/drive/useDriveSession.ts`](../../../../apps/cline-hub/src/webview/src/drive/useDriveSession.ts) — local session state (bank + fixture + persisted UI); never posts `call_join`.
- [`apps/cline-hub/src/webview/src/drive/demoFixture.ts`](../../../../apps/cline-hub/src/webview/src/drive/demoFixture.ts) — `DRIVE_DEMO_FIXTURE` offline demo cards.
- [`apps/cline-hub/src/webview/src/Chat.tsx`](../../../../apps/cline-hub/src/webview/src/Chat.tsx) — **Gap A**: main in-call surface; Join does not post `call_join`; imports `StickyStagePane`, not `Spotlight`.
- [`apps/cline-hub/src/webview/src/drive/pinDefaults.ts`](../../../../apps/cline-hub/src/webview/src/drive/pinDefaults.ts) — **Gap C**: `buildHumanPinDefaults`; pin never wired to `call_set_stage`.
- [`apps/cline-hub/src/webview/src/components/views/drive-view.tsx`](../../../../apps/cline-hub/src/webview/src/components/views/drive-view.tsx) — shipped Drive sidebar tab home.

## Style

The canvas mirrors [`overview-canvas.html`](../../../design/drive-wireframes/overview-canvas.html)
and the tokens in [`CLINE-BRAND-TOKENS.md`](../../../design/drive-wireframes/CLINE-BRAND-TOKENS.md):
dark background `#0A0A0A`, brand purple `#9F58FA`, hairline `0.8px` strokes, `9px`
radius, and the DM Sans / Schibsted Grotesk / Space Grotesk type stack. Maturity colors
reuse brand tokens: locked = purple `#9F58FA`, implemented = green `#2BCC28`,
partial = blue `#5487C8`, planned = amber `#E0A458`, gap = pink `#F53969`.
