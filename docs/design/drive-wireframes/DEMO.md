# Drive UX demo runbook

Click-through surfaces for the Drive / Drivecode stack. Hub owns room state via `call_*` ops on the Cline hub writer. WebRTC, recruit ranking, and RosterPack runtime are not implemented.

## Surfaces

| Surface | Kind | How to open |
|---|---|---|
| Drive tab HTML | Throwaway prototype (locked IA) | Open [`drive-tab-discord-slack.html`](drive-tab-discord-slack.html) in a browser |
| Overview canvas | Cursor `.canvas.tsx` + HTML twin | Open [drivecode-overview.canvas.tsx](/home/ubuntu/.cursor/projects/workspace/canvases/drivecode-overview.canvas.tsx) beside chat, or [`overview-canvas.html`](overview-canvas.html) |
| Hub Chat Drive Stage | Hub `call_join` + fixture/live Stage | `bun -F @cline/cline-hub dev` → `http://127.0.0.1:8787` → Connect → Chat → **Join call** |
| CLI Drive teaser | Local TUI flags | `bun run cli -i` then `Ctrl+Shift+D` / status-bar Drive control |

## Hub Chat Stage + room (Slices A/B)

### Run

```bash
bun run build:sdk
bun -F @cline/cline-hub dev
```

Open **`http://127.0.0.1:8787`** → Connect → Chat → **Join call**.

Pipeline:

```text
browser → dashboard :8787 → HubUIClient → ws://127.0.0.1:25463/hub
  call_join / call_set_stage / call_mute / call_set_mode
  ← room.snapshot / room.event
Stage cards still project session tool_event (Slice A) while room owns sharer/pin (Slice B).
```

### Fixture vs live cards

| Mode | When | What you see |
|---|---|---|
| **UI fixture cards** | `drive.demo` and no stageable tools yet | Demo badge + edit/command/test from `DRIVE_DEMO_FIXTURE` |
| **Live tool cards** | Session has editor/apply_patch/run_commands events | Live badge; `stageReducer` over tool events |
| **Hub room** | Join call | `call_join` seats You + partner; mute/mode/stage go through hub |

### Share controls

- **Agent takes stage** / **You take stage** → `call_set_stage` (hub-owned). You share includes a structured selection pin.
- Leave call → `call_leave`; room object persists on the hub.

## HTML Drive tab / Overview / CLI

Primary IA demo remains the HTML Drive tab prototype. Drive tab **route** in hub is Slice C. CLI Drive teaser is still a parity stub (`Ctrl+Shift+D`).

## Ship stack

Canonical tip: [#12](https://github.com/hhalperin/cline-drivecode/pull/12). Independent: [#5](https://github.com/hhalperin/cline-drivecode/pull/5), [#3](https://github.com/hhalperin/cline-drivecode/pull/3). Superseded stack PRs #2/#4/#6/#10 are closed.
