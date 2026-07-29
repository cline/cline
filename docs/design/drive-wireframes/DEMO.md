# Drive UX demo runbook

Click-through surfaces for the Drive / Drivecode stack. Hub owns room state via `call_*` ops on the Cline hub writer. WebRTC, recruit ranking, and RosterPack runtime are not implemented.

## Surfaces

| Surface | Kind | How to open |
|---|---|---|
| Drive tab HTML | Throwaway prototype (locked IA) | Open [`drive-tab-discord-slack.html`](drive-tab-discord-slack.html) in a browser |
| Overview canvas | Cursor `.canvas.tsx` + HTML twin | Open `drivecode-overview.canvas.tsx` from your Cursor canvases beside chat, or [`overview-canvas.html`](overview-canvas.html) |
| Hub Chat Drive Spotlight | Shared Spotlight from hub room | `bun -F @cline/cline-hub dev` → open the printed dashboard URL → Connect → Chat → **Join call** |
| Status Hub Dependency map | Live team tasks, or Drive plan fixture | printed dashboard URL + `/status?demoPlans=1&statusMode=dependency-map` |
| CLI Drive teaser | Local TUI flags | `bun run cli -i` then `Ctrl+Shift+D` / status-bar Drive control (`CLINE_DEMO_DRIVE=1` starts with Drive on) |
| CLI Status Hub | Board + dependency map dialog | `CLINE_DEMO_STATUS_PLANS=1 CLINE_DEMO_OPEN_STATUS=1 bun run cli -i` (`CLINE_DEMO_STATUS_LENS=dependency-map` for the map) |

## Drive Mode share screen (production Join path)

### Run

```bash
bun run build:sdk
bun -F @cline/cline-hub dev
```

Open the dashboard URL printed by `bun -F @cline/cline-hub dev` → Connect → Chat → **Join call**.

Pipeline:

```text
browser → dashboard (auto-picked listen port) → HubUIClient → hub (discovered)
  call_join (sessionId) / call_record_work / call_set_stage / call_get_room / …
    ← room.snapshot / room.event
Spotlight cards + sharer + pin come from roomSnapshot (shared screen).
The wire field is still `stage`; every surface says Spotlight.
```

### Fixture vs live room cards

| Mode | When | What you see |
|---|---|---|
| **UI fixture cards** | `drive.demo` and no live room / no stageable tools | Demo badge + edit/command/test from `DRIVE_DEMO_FIXTURE` |
| **Hub room cards** | Join call (live room) | Cards from `roomSnapshot.stage.cards` via `call_record_work` (agent tools bridged when session is linked) |
| **Offline local** | No room; session has tools | Local `stageReducer` over private tool events only |

### Live smoke (share handoff)

1. **Join call** — seats You + partner; Spotlight opens; `call_join` passes `sessionId`.
2. **Agent tools** — completed edit/command/test tools → `call_record_work` → Spotlight cards update for every participant from the room snapshot.
3. **Reload / late peek** — `call_get_room` hydrates cards; dead room (`room_not_found`) clears Drive UI with “Room ended. Join again.”
4. **Spotlight me** — pick **selection** / **file** / **terminal**; real pin content renders in the Spotlight; agent deck dims.
5. **Spotlight agent** — pin cleared via `call_set_stage` with `pin: null`; agent cards return as primary.

### Share controls

- **Spotlight agent** / **Spotlight me** → hub `call_set_stage`. You share requires a pin kind (selection text, file path, or terminal output).
- Leave call → `call_leave`. Rooms are in-memory only (hub restart ends the room).

## HTML Drive tab / Overview / CLI

Primary IA demo remains the HTML Drive tab prototype. Drive tab **route** in hub is Slice C (out of scope for this share-screen pass). CLI Drive teaser is still a parity stub (`Ctrl+Shift+D`).

## Ship stack

Canonical tip tracks Drive Mode share-screen work on `cursor/drive-share-production-b019`. Prior: [#13](https://github.com/hhalperin/cline-drivecode/pull/13) room MVP, [#12](https://github.com/hhalperin/cline-drivecode/pull/12) Spotlight (then Stage) Slice A.
