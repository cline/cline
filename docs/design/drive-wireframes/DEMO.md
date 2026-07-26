# Drive UX demo runbook

Click-through surfaces for the Drive / Drivecode stack. Hub owns room state via `call_*` ops on the Cline hub writer. WebRTC, recruit ranking, and RosterPack runtime are not implemented.

## Surfaces

| Surface | Kind | How to open |
|---|---|---|
| Drive tab HTML | Throwaway prototype (locked IA) | Open [`drive-tab-discord-slack.html`](drive-tab-discord-slack.html) in a browser |
| Overview canvas | Cursor `.canvas.tsx` + HTML twin | Open [drivecode-overview.canvas.tsx](/home/ubuntu/.cursor/projects/workspace/canvases/drivecode-overview.canvas.tsx) beside chat, or [`overview-canvas.html`](overview-canvas.html) |
| Hub Chat Drive Stage | Shared Stage from hub room | `bun -F @cline/cline-hub dev` → `http://127.0.0.1:8787` → Connect → Chat → **Join call** |
| CLI Drive teaser | Local TUI flags | `bun run cli -i` then `Ctrl+Shift+D` / status-bar Drive control |

## Drive Mode share screen (production Join path)

### Run

```bash
bun run build:sdk
bun -F @cline/cline-hub dev
```

Open **`http://127.0.0.1:8787`** → Connect → Chat → **Join call**.

Pipeline:

```text
browser → dashboard :8787 → HubUIClient → ws://127.0.0.1:25463/hub
  call_join (sessionId) / call_record_work / call_set_stage / call_get_room / …
  ← room.snapshot / room.event
Stage cards + sharer + pin come from roomSnapshot (shared screen).
```

### Fixture vs live room cards

| Mode | When | What you see |
|---|---|---|
| **UI fixture cards** | `drive.demo` and no live room / no stageable tools | Demo badge + edit/command/test from `DRIVE_DEMO_FIXTURE` |
| **Hub room cards** | Join call (live room) | Cards from `roomSnapshot.stage.cards` via `call_record_work` (agent tools bridged when session is linked) |
| **Offline local** | No room; session has tools | Local `stageReducer` over private tool events only |

### Live smoke (share handoff)

1. **Join call** — seats You + partner; Stage opens; `call_join` passes `sessionId`.
2. **Agent tools** — completed edit/command/test tools → `call_record_work` → Stage cards update for every participant from the room snapshot.
3. **Reload / late peek** — `call_get_room` hydrates cards; dead room (`room_not_found`) clears Drive UI with “Room ended. Join again.”
4. **You take stage** — pick **selection** / **file** / **terminal**; real pin content renders on Stage; agent deck dims.
5. **Agent takes stage** — pin cleared via `call_set_stage` with `pin: null`; agent cards return as primary.

### Share controls

- **Agent takes stage** / **You take stage** → hub `call_set_stage`. You share requires a pin kind (selection text, file path, or terminal output).
- Leave call → `call_leave`. Rooms are in-memory only (hub restart ends the room).

## HTML Drive tab / Overview / CLI

Primary IA demo remains the HTML Drive tab prototype. Drive tab **route** in hub is Slice C (out of scope for this share-screen pass). CLI Drive teaser is still a parity stub (`Ctrl+Shift+D`).

## Ship stack

Canonical tip tracks Drive Mode share-screen work on `cursor/drive-share-production-b019`. Prior: [#13](https://github.com/hhalperin/cline-drivecode/pull/13) room MVP, [#12](https://github.com/hhalperin/cline-drivecode/pull/12) Stage Slice A.
