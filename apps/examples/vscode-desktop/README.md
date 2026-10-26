# `apps/examples/vscode-desktop` — Cline Desktop inside VS Code (prototype)

Hosts the desktop app (`apps/examples/desktop-app`) inside a VS Code
extension. The desktop's backend (`sidecar/`) and webview (`webview/`) run
unmodified; this package only provides the shell: it spawns the backend,
serves the webview's static export, and answers the handful of "native"
commands with the `vscode` API.

```
┌─ VS Code ──────────────────────────────────────────────────────┐
│  extension host (Node)                 webview (vscode-webview://) │
│  ┌──────────────────────┐              ┌──────────────────────┐ │
│  │ src/extension.ts     │  postMessage │ desktop-app/webview  │ │
│  │ src/host-commands.ts │◄────────────►│ (Next static export) │ │
│  │ src/diff-provider.ts │              │ lib/host-shell.ts    │ │
│  │ src/backend.ts ──┐   │              │ lib/host-mode.ts     │ │
│  └──────────────────┼───┘              └──────────┬───────────┘ │
│                     │ spawn                        │ WebSocket   │
│                     ▼                              ▼             │
│          desktop-app/sidecar/index.ts  ◄── ws://127.0.0.1:PORT   │
│          (bun; talks to the Cline Hub)                           │
└────────────────────────────────────────────────────────────────┘
```

## Run

```bash
bun install && bun run build:sdk               # once, repo root
cd apps/examples/vscode-desktop
bun run build                                   # desktop webview export + extension
```

Then **F5** with this folder open in VS Code, or:

```bash
code --new-window --disable-extensions \
  --extensionDevelopmentPath=$PWD /path/to/some/project
```

Click **Cline Desktop** in the activity bar, or run **Cline Desktop: Open**
for an editor-tab panel. **Cline Desktop: Show Backend Logs** shows the
sidecar's output channel.

`clineDesktop.bunPath` / `clineDesktop.backendEntry` override how the backend
is launched (defaults: mise/Homebrew/PATH `bun` and the sibling
`desktop-app/sidecar/index.ts`). A compiled `cline` CLI works too — it is run
with `BUN_BE_BUN=1`, the same way the Tauri shell does.

## Host mode

The webview detects its shell via `webview/lib/host-mode.ts`:

| | desktop (Tauri) | vscode | web |
|---|---|---|---|
| quit / relaunch app | ✓ | — | — |
| integrated terminal | ✓ | — (use VS Code's) | — |
| in-webview Files / Changes panes | ✓ | — (use the Explorer) | ✓ |
| file diffs | changes pane | **VS Code diff editor** | changes pane |
| "open in editor" | external editor | **VS Code tab** | external editor |
| theme / font size | app setting | **follows VS Code** | app setting |
| keybindings | Settings → Keybindings | **VS Code keybindings** | Settings |
| app icon / auto-update | ✓ | — | — |

UI code branches on `useHostCapabilities()` (never on `mode === "vscode"`),
so adding another host is a matter of describing what it has.

### Host ↔ webview protocol (`webview/lib/host-shell.ts`)

- webview → host: `{ type: "cline-host-command", id, command, args }` for the
  commands listed in `HOST_COMMANDS` (`src/host-commands.ts`). Everything
  else goes to the sidecar over its WebSocket exactly as on the desktop.
- host → webview: `{ type: "cline-host-action", action }` for
  `new-session | command-bar | open-settings | focus-input`, bound to VS Code
  keybindings in `package.json`.

### Diffs

`open_file_diff { path, oldText, newText, status }` opens `vscode.diff` with
the "before" blob from a `cline-diff:` content provider and the real file on
the right (so edits are live). Turn receipts in the chat call this instead
of opening the changes pane.

## Dev helpers

- `bun run scripts/preview-server.ts` serves `dist/webview` in a plain
  browser tab with the same HTML rewriting the extension uses — handy for
  debugging boot problems with real devtools.
- `scripts/build-webview.ts` copies the Next export and patches Turbopack's
  hardcoded `/_next/` chunk base so lazy chunks load from the extension's
  resource root.

## Known gaps

- Not packaged as a `.vsix`; runs from the repo checkout.
- Settings pages are designed for a wide window; the editor-tab panel is a
  better fit than the sidebar for Providers/Customize.
- Backend startup needs `bun` (or a compiled `cline` CLI). When the CLI hosts
  the Hub directly, `src/backend.ts` becomes "run `cline`, read its endpoint".
