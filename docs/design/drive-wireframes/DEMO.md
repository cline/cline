# Drive UX demo runbook

Click-through surfaces for the Drive / Drivecode stack. Everything here is **scaffold or throwaway prototype** unless a note says otherwise. Hub-owned rooms, WebRTC, recruit ranking, and RosterPack runtime are not implemented.

## Surfaces

| Surface | Kind | How to open |
|---|---|---|
| Drive tab HTML | Throwaway prototype (locked IA) | Open [`drive-tab-discord-slack.html`](drive-tab-discord-slack.html) in a browser |
| Overview canvas | In-repo replacement for the old Windows-only Cursor canvas | Open [`overview-canvas.html`](overview-canvas.html) |
| Hub Chat Drive chrome | Local UI fixture (`demo: true`) | Run hub webview; click **Join call** (Stage opens with fixture cards) |
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

Five pages that replace `cline-drivecode-overview.canvas.tsx` (Architecture, Workflows, Platform/Config, Drive-tab, SDK).

- In-repo twin: [`overview-canvas.html`](overview-canvas.html)
- Live Tldraw session canvas id: `mn6fgbfw` (Cursor Tldraw MCP)

## Hub Chat fixture

Files: `apps/cline-hub/src/webview/src/drive/{demoFixture.ts,DriveCallChrome.tsx,types.ts}` and `Chat.tsx`.

1. From repo root (after `bun install` and `bun run build:sdk`):

```bash
bun -F @cline/cline-hub start
# or your usual hub webview / desktop host that loads the hub Chat surface
```

2. In Chat, click **Join call**.
3. Demo mode (`drive.demo === true` by default) opens Stage with edit / command / test cards from `DRIVE_DEMO_FIXTURE`.
4. Exercise mute, raise hand (aborts in-flight send), and sub-mode chips.
5. Leave call clears stage and hand.

This does **not** write hub room state. The "Demo fixture" badge on the stage header marks that boundary.

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
