# Drive UX demo runbook

Click-through surfaces for the Drive / Drivecode stack. Everything here is **scaffold or throwaway prototype** unless a note says otherwise. Hub-owned rooms (`call_*`), WebRTC, recruit ranking, and RosterPack runtime are not implemented.

## Surfaces

| Surface | Kind | How to open |
|---|---|---|
| Drive tab HTML | Throwaway prototype (locked IA) | Open [`drive-tab-discord-slack.html`](drive-tab-discord-slack.html) in a browser |
| Overview canvas | Cursor `.canvas.tsx` + HTML twin | Open [drivecode-overview.canvas.tsx](/home/ubuntu/.cursor/projects/workspace/canvases/drivecode-overview.canvas.tsx) beside chat, or [`overview-canvas.html`](overview-canvas.html) |
| Hub Chat Drive Stage | Fixture **or** live `tool_event` projection | `bun -F @cline/cline-hub dev` → `http://127.0.0.1:8787` → Connect → Chat → **Join call** |
| CLI Drive teaser | Local TUI flags | `bun run cli -i` then `Ctrl+Shift+D` / status-bar Drive control |

## HTML Drive tab

Primary IA demo. Discord-style rooms and roster inside Slack-like hub chrome.

1. Open `docs/design/drive-wireframes/drive-tab-discord-slack.html`.
2. Try chrome keys `1` / `2` and accent keys `3` / `4`.
3. Join / Leave, mute, raise hand, plan|agent|ask|debug.
4. Click roster members for per-agent transcripts; click the call for the room thread.
5. Address chips / `Alt+1..5` (Everyone, RosterPack, Adam, Riley, Sam).
6. Stage on/off; Agent / You take stage; `S` or **Cycle stage cards** for last-event-wins decks.
7. Send a steer line and watch it land in the transcript and stage.

Scaffold vs locked: interactions are client-seeded JS. Domain shape and IA decisions live in [`DRIVE-TAB.md`](DRIVE-TAB.md).

## Overview canvas

Open beside chat:

- [Drivecode overview](/home/ubuntu/.cursor/projects/workspace/canvases/drivecode-overview.canvas.tsx)
- [MVP shared screen](/home/ubuntu/.cursor/projects/workspace/canvases/drive-mvp-shared-screen.canvas.tsx)

HTML twin: [`overview-canvas.html`](overview-canvas.html)

## Hub Chat Stage (Cline-wired Slice A)

Files:

- `apps/cline-hub/src/webview/src/drive/stageReducer.ts` — last-event-wins `toolEvents` → `StageCard[]`
- `apps/cline-hub/src/webview/src/drive/Stage.tsx` — sharer label + ai-elements cards
- `apps/cline-hub/src/webview/src/drive/{demoFixture.ts,DriveCallChrome.tsx,types.ts}` + `Chat.tsx`

### Run

From repo root:

```bash
bun run build:sdk
bun -F @cline/cline-hub dev
```

Open **`http://127.0.0.1:8787`** → Connect → Chat → **Join call** (Stage opens in demo mode).

Pipeline (no extra daemon):

```text
browser → dashboard :8787 → HubUIClient → ws://127.0.0.1:25463/hub → ClineCore
                                                                      ↓
                                                              tool_event stream
                                                                      ↓
                                                         stageReducer → Stage.tsx
```

### Fixture vs live

| Mode | When | What you see |
|---|---|---|
| **UI-only fixture** | `drive.demo === true` (default) **and** no stageable session tools yet | Demo badge + edit / command / test cards from `DRIVE_DEMO_FIXTURE`. No LLM key required. |
| **Live Stage** | Session has `editor` / `apply_patch` / `run_commands` (etc.) tool events | Live badge; cards from `stageReducer` over the same `tool_event` stream Chat already handles. Needs a provider credential (`ANTHROPIC_API_KEY` / `CLINE_API_KEY` / hub provider settings). |

Live path overrides the fixture as soon as stageable tools appear, even while `demo` stays true.

### Call strip (client-only share stub)

- **Agent takes stage** / **You take stage** flip a local `stageSharer` label and (for You) a selection pin stub.
- This is **not** hub `call_set_stage` (Slice B). Leave call resets the stub to agent.

### Smoke checklist

1. Join call → Stage on with fixture cards (no key).
2. Mute / raise hand / sub-mode chips still work.
3. Toggle Agent / You take stage → header sharer label updates.
4. With a provider key: send a turn that edits a file or runs a command/test → Stage cards update from live tools.
5. Leave call clears stage layout and sharer stub.

## CLI Drive teaser

Parity stub only.

1. `bun run cli -i`
2. `Ctrl+Shift+D` toggles Drive on/off (see `apps/cli/src/tui/hooks/use-root-keyboard.ts`).
3. Status bar shows Drive state (`apps/cli/src/tui/components/status-bar.tsx`).
4. Help dialog documents Join / leave.

No stage panel or roster in the TUI yet.

## Ship stack (into main)

Agent prep is done: Bugbot #7/#8/#9 folded into parents; #1 closed as superseded by #2. You still need to **undraft + merge**:

1. [#2](https://github.com/hhalperin/cline-drivecode/pull/2) → main
2. [#4](https://github.com/hhalperin/cline-drivecode/pull/4) → main
3. [#6](https://github.com/hhalperin/cline-drivecode/pull/6) → main

Independent anytime: [#5](https://github.com/hhalperin/cline-drivecode/pull/5), [#3](https://github.com/hhalperin/cline-drivecode/pull/3).
