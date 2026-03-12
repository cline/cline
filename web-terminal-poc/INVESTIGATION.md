# Web Terminal Investigation Report

## Goal

Build a CLI tool that launches a web server + browser, displaying a terminal emulator at localhost that runs commands on the local machine. The terminal must feel **native** — no input delay, no lag, proper TUI support, persistent scrollback, the works.

## TL;DR

The answer is **xterm.js + node-pty + WebSocket with binary frames + flow control**. This is exactly what VS Code does, and it's battle-tested by millions of users. The POC in this directory implements the same architecture. Below is a detailed investigation of VS Code's terminal internals, common pitfalls, and why each design decision matters.

---

## Table of Contents

1. [VS Code Terminal Architecture](#1-vs-code-terminal-architecture)
2. [xterm.js Architecture](#2-xtermjs-architecture)
3. [Why Vibe-Coded Terminals Feel Bad](#3-why-vibe-coded-terminals-feel-bad)
4. [The Correct Architecture](#4-the-correct-architecture)
5. [Critical Implementation Details](#5-critical-implementation-details)
6. [POC Architecture](#6-poc-architecture)
7. [What the POC Implements](#7-what-the-poc-implements)
8. [Future Enhancements](#8-future-enhancements)
9. [Key Source Files Reference](#9-key-source-files-reference)

---

## 1. VS Code Terminal Architecture

VS Code's terminal is the gold standard for web-based terminal emulation. After deep-diving the source, here's how it works:

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Frontend (Browser/Webview)                     │
│                                                          │
│  XtermTerminal (xtermTerminal.ts)                        │
│    ├── xterm.js Terminal instance                        │
│    ├── WebglAddon (GPU rendering)                        │
│    ├── FitAddon (auto-sizing)                            │
│    ├── ShellIntegrationAddon (command tracking)          │
│    ├── SearchAddon, WebLinksAddon, etc.                  │
│    └── DecorationAddon (success/error markers)           │
│                                                          │
│  TerminalInstance (terminalInstance.ts)                   │
│    ├── Owns XtermTerminal                                │
│    ├── Manages input pipeline (onData → processManager)  │
│    ├── Manages output pipeline (processData → xterm)     │
│    └── Handles resize debouncing                         │
└───────────────────────────┬─────────────────────────────┘
                            │  IPC (ProxyChannel)
                            │  NOT WebSocket!
┌───────────────────────────┴─────────────────────────────┐
│  Layer 2: Process Manager                                │
│                                                          │
│  TerminalProcessManager (terminalProcessManager.ts)      │
│    ├── Lifecycle management (create, kill, restart)       │
│    ├── Flow control (acknowledgeDataEvent)               │
│    ├── Data filtering (SeamlessRelaunchDataFilter)       │
│    └── Reconnection logic                                │
└───────────────────────────┬─────────────────────────────┘
                            │  IPC (Named pipe / MessagePort)
┌───────────────────────────┴─────────────────────────────┐
│  Layer 3: PTY Host (separate Node.js process)            │
│                                                          │
│  PtyService (ptyService.ts)                              │
│    ├── Creates/manages PTY via node-pty                  │
│    ├── TerminalProcess wraps individual PTY instances     │
│    ├── TerminalDataBufferer (5ms batching)               │
│    ├── Heartbeat service (health monitoring)             │
│    └── Persistent session support (survive reloads)      │
└─────────────────────────────────────────────────────────┘
```

### Key Takeaways from VS Code

1. **PTY runs in a separate process** — Node.js event loop isn't blocked by UI
2. **Data is buffered at 5ms intervals** — reduces IPC/WebSocket message count
3. **Flow control prevents memory blowup** — client acks processed bytes
4. **Resize is debounced** — horizontal reflow is expensive, batched at 100ms
5. **WebGL rendering by default** — GPU-accelerated, orders of magnitude faster than DOM
6. **`TERM=xterm-256color`** — critical for TUI apps to use correct escape sequences
7. **`COLORTERM=truecolor`** — advertises 24-bit color support

---

## 2. xterm.js Architecture

xterm.js is the de facto standard for web terminal emulation (200+ projects, including VS Code, Hyper, Tabby).

### Core Components

| Component | Purpose |
|-----------|---------|
| **Terminal** | Main class. Parser, buffer management, input handling |
| **Buffer** | Circular list storing terminal lines (normal + alternate) |
| **Parser** | VT100/VT220/xterm escape sequence parser |
| **Renderer** | Canvas (default), WebGL (addon), DOM (legacy) |

### Critical Addons for Native Feel

| Addon | Why It's Needed |
|-------|----------------|
| **FitAddon** | Calculates cols/rows from container pixel dimensions |
| **WebglAddon** | GPU rendering — eliminates rendering lag on large buffers |
| **WebLinksAddon** | Clickable URLs (expected in modern terminals) |
| **Unicode11Addon** | Correct width calculation for CJK/emoji characters |
| **SearchAddon** | Ctrl+F search through scrollback |
| **SerializeAddon** | Save/restore terminal state for reconnection |

### xterm.js Data Flow

```
PTY Output (bytes)
    ↓
terminal.write(data, callback)     ← async! callback = "parsed"
    ↓
VT Parser (escape sequence processing)
    ↓
Buffer Update (circular list)
    ↓
Renderer (WebGL texture atlas → GPU draw)
    ↓
callback() fires                   ← NOW the data is "processed"
```

The callback in `terminal.write()` is crucial for flow control — it tells you when xterm has actually parsed the data, not just queued it.

---

## 3. Why Vibe-Coded Terminals Feel Bad

Here's a diagnosis of every common problem and the root cause:

### Problem: Input Delay / Laggy Typing

**Root causes:**
- **Text WebSocket frames**: Encoding/decoding UTF-8 on every keystroke adds latency. Use binary frames.
- **No data buffering**: Each PTY output byte becomes a separate WebSocket message + `terminal.write()` call. The overhead per message is constant — batching at 5ms intervals dramatically reduces it.
- **DOM renderer**: xterm.js defaults to canvas, which is fine, but many tutorials use the DOM renderer. DOM manipulation per character is ~100x slower than canvas.
- **Synchronous WebSocket handling**: If you `await` anything in the message handler, you stall the entire data pipeline.

### Problem: TUIs Don't Work (vim, htop, less, etc.)

**Root causes:**
- **Wrong TERM value**: If `TERM` isn't set to `xterm-256color` (or similar), TUI apps don't know what escape sequences to use. Many web terminals set `TERM=dumb` or omit it.
- **Missing resize/SIGWINCH**: TUI apps query terminal dimensions via `ioctl(TIOCGWINSZ)`. If you don't send resize events to the PTY, apps think the terminal is 80x24 forever. When the browser window resizes, the PTY must be told.
- **Missing `onBinary` handler**: Some mouse reports from TUI apps aren't valid UTF-8. Without `onBinary`, these get silently dropped, breaking mouse interaction.
- **`convertEol: true`**: This converts `\n` to `\r\n`, which completely breaks TUI rendering. The PTY handles line endings — don't touch them.

### Problem: Scrollback Disappears

**Root causes:**
- **Low or zero scrollback setting**: xterm.js defaults to 1000 lines, but some implementations set `scrollback: 0` for "performance".
- **Alternate buffer confusion**: Full-screen apps (vim, less) use the alternate buffer, which has no scrollback by design. When they exit, the normal buffer's scrollback should be restored. If your terminal instance is recreated on reconnect without restoring state, scrollback is lost.
- **Missing SerializeAddon**: On WebSocket reconnect, the terminal state is gone. Use SerializeAddon to snapshot and restore.

### Problem: Copy/Paste Broken

**Root causes:**
- **No clipboard handling**: Browser security requires explicit clipboard API usage
- **Selection not wired up**: xterm.js handles selection internally but you need to wire it to the clipboard
- **Bracketed paste mode not supported**: Modern shells use bracketed paste (`\e[200~...\e[201~`) to distinguish paste from typing. Use `terminal.paste()` instead of sending raw text.

### Problem: Colors Wrong / No Colors

**Root causes:**
- **Missing `COLORTERM=truecolor`**: Programs check this to decide whether to use 24-bit color
- **Wrong TERM**: `xterm-256color` vs `xterm` vs `dumb` — each supports different color depths
- **Theme not set**: xterm.js has a default theme, but if you only set `background` without setting ANSI colors, some programs look wrong

### Problem: Window Resize Breaks Layout

**Root causes:**
- **No resize debouncing**: Rapid resize events cause excessive reflow
- **FitAddon not used**: Manual cols/rows calculation is error-prone
- **Container has no explicit dimensions**: FitAddon measures the container. If it's `height: auto`, the calculation is wrong.
- **Missing ResizeObserver**: `window.resize` doesn't fire for all container size changes

---

## 4. The Correct Architecture

Based on VS Code's implementation, here's the architecture that works:

```
┌──────────────────────────────────────────────────────────┐
│  Browser                                                  │
│                                                           │
│  xterm.js Terminal                                        │
│    ├── WebglAddon (GPU rendering)                         │
│    ├── FitAddon (auto-sizing)                             │
│    ├── WebLinksAddon (clickable URLs)                     │
│    ├── Unicode11Addon (proper char widths)                │
│    └── SearchAddon (Ctrl+F)                               │
│                                                           │
│  Custom WebSocket handler (NOT AttachAddon)                │
│    ├── Binary frames for data (ArrayBuffer, not string)   │
│    ├── Text frames for control (resize, ack, exit)        │
│    ├── Flow control (ack every 100KB)                     │
│    └── terminal.write(data, callback) for backpressure    │
└──────────────────────┬───────────────────────────────────┘
                       │  WebSocket (binary)
┌──────────────────────┴───────────────────────────────────┐
│  Node.js Server                                           │
│                                                           │
│  WebSocket handler                                        │
│    ├── Binary frames → pty.write()                        │
│    ├── Text frames → control (resize, ack)                │
│    └── Protocol: binary = data, text = control JSON       │
│                                                           │
│  PTY Manager                                              │
│    ├── node-pty with TERM=xterm-256color                  │
│    ├── Data buffering (5ms coalescing)                    │
│    ├── Flow control (pause/resume on high water mark)     │
│    └── pty.onData → buffer → WebSocket binary frame       │
│                                                           │
│  Express (static file server for client assets)           │
└──────────────────────────────────────────────────────────┘
```

### Why Not AttachAddon?

The built-in `AttachAddon` is great for quick demos but lacks:
1. **Flow control** — no backpressure, fast output = OOM
2. **Control channel** — no way to send resize events
3. **Reconnection** — no state restoration
4. **Binary framing** — it supports binary but can't mix with text control frames

For a native-feeling terminal, you need a custom WebSocket handler.

---

## 5. Critical Implementation Details

### Binary WebSocket Transport

```javascript
// Server: PTY → WebSocket
ptyProcess.onData((data) => {
  const chunk = Buffer.from(data, "utf-8");
  ws.send(chunk, { binary: true });  // Binary frame, no text encoding overhead
});

// Client: WebSocket → Terminal
ws.onmessage = (event) => {
  if (event.data instanceof ArrayBuffer) {
    terminal.write(new Uint8Array(event.data));  // Direct binary, no decode step
  }
};
```

Why binary? Text frames require UTF-8 validation on both sides. Terminal output can contain partial UTF-8 sequences (data arrives in arbitrary chunks). Binary frames pass through as-is.

### Data Buffering (5ms Coalescing)

```javascript
// Server side
let dataBuffer = [];
let bufferTimer = null;

ptyProcess.onData((data) => {
  dataBuffer.push(Buffer.from(data));
  if (bufferTimer === null) {
    bufferTimer = setTimeout(() => {
      ws.send(Buffer.concat(dataBuffer), { binary: true });
      dataBuffer = [];
      bufferTimer = null;
    }, 5);
  }
});
```

Without this, a command like `ls -la /usr/bin` generates hundreds of tiny writes, each becoming a separate WebSocket frame. With 5ms batching, they merge into a few large frames.

### Flow Control

```
Client tracks: bytes written to terminal via terminal.write()
  → Every 100KB, sends ack to server

Server tracks: bytes sent minus bytes acked
  → If unacked > 5MB, pause PTY (pty.pause())
  → When unacked drops below 2.5MB, resume (pty.resume())
```

Without this, `cat /dev/urandom | xxd` will crash the browser tab by filling memory with unrendered data.

### Resize Pipeline

```
Window resize event
    ↓ (debounced 100ms)
fitAddon.fit()
    ↓ (calculates cols/rows from container pixels)
terminal.resize(cols, rows)
    ↓ (triggers onResize event)
WebSocket text frame: {"type": "resize", "cols": 120, "rows": 40}
    ↓
pty.resize(120, 40)
    ↓ (sends SIGWINCH to child process)
TUI app re-queries terminal size and redraws
```

Every step in this pipeline is necessary. Miss one and TUI apps render incorrectly.

### PTY Environment Variables

```javascript
const ptyProcess = pty.spawn(shell, [], {
  name: "xterm-256color",      // TERM — tells apps what escape sequences to use
  env: {
    ...process.env,
    COLORTERM: "truecolor",    // Advertises 24-bit color support
    TERM_PROGRAM: "web-terminal",
  },
});
```

`name: "xterm-256color"` sets the `TERM` env var. This is the single most important setting for TUI compatibility. Without it, apps like vim fall back to `dumb` mode.

---

## 6. POC Architecture

The POC in this directory (`server.mjs` + `public/index.html`) implements all of the above:

### Server (`server.mjs`)
- Express serves static files (xterm.js from node_modules, client HTML)
- WebSocketServer on `/ws` handles terminal connections
- node-pty spawns shell with proper TERM/COLORTERM
- 5ms data buffering matches VS Code's TerminalDataBufferer
- Flow control with ack/pause/resume

### Client (`public/index.html`)
- xterm.js with VS Code's exact theme colors
- WebGL renderer with canvas fallback
- FitAddon for auto-sizing
- Custom WebSocket handler with flow control
- Debounced resize with ResizeObserver
- Copy/paste via Ctrl+Shift+C/V and right-click
- Reconnection with exponential backoff

---

## 7. What the POC Implements

| Feature | Status | Notes |
|---------|--------|-------|
| Binary WebSocket transport | ✅ | No text encoding overhead |
| Data buffering (5ms) | ✅ | Coalesces small PTY writes |
| Flow control (ack/pause) | ✅ | Prevents OOM on fast output |
| WebGL renderer | ✅ | With canvas fallback |
| Proper TERM/COLORTERM | ✅ | xterm-256color + truecolor |
| Resize with SIGWINCH | ✅ | Debounced, uses ResizeObserver |
| TUI support | ✅ | vim, htop, less all work |
| Scrollback (10000 lines) | ✅ | Generous buffer |
| Copy/paste | ✅ | Ctrl+Shift+C/V + right-click |
| Mouse support (onBinary) | ✅ | For TUI mouse events |
| Clickable URLs | ✅ | WebLinksAddon |
| Unicode support | ✅ | Unicode11Addon |
| Search | ✅ | SearchAddon loaded |
| Reconnection | ✅ | Exponential backoff |
| Auto-open browser | ✅ | Opens on server start |
| VS Code theme | ✅ | Exact color values |

---

## 8. Future Enhancements

Things NOT in the POC but worth adding for production:

### Session Persistence
- Use SerializeAddon to snapshot terminal state
- On reconnect, restore buffer contents
- VS Code does this with `persistentSessionScrollback` (100 lines by default)

### Multiple Terminals
- Tab/split pane support
- Each terminal gets its own WebSocket + PTY
- Server needs a session manager

### Shell Integration
- VS Code injects shell hooks via OSC 633 sequences
- Enables: command detection, working directory tracking, exit code display
- Non-trivial to implement but massively improves UX

### Security
- Authentication (currently open to localhost)
- HTTPS/WSS support
- Session tokens
- Rate limiting

### Theming
- Light/dark theme toggle
- Custom color schemes
- Font selection UI

### Performance Monitoring
- Measure input-to-echo latency
- Track renderer FPS
- Monitor WebSocket message rate
- Alert on flow control activation

---

## 9. Key Source Files Reference

### VS Code Terminal Source (in `/home/user/vscode`)

| File | What It Does |
|------|-------------|
| `src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts` | xterm.js integration: options, addons, configuration |
| `src/vs/workbench/contrib/terminal/browser/terminalInstance.ts` | Terminal lifecycle, I/O pipeline, input/output wiring |
| `src/vs/workbench/contrib/terminal/browser/terminalProcessManager.ts` | Process lifecycle, flow control, reconnection |
| `src/vs/workbench/contrib/terminal/browser/terminalResizeDebouncer.ts` | Resize debouncing (100ms horizontal) |
| `src/vs/platform/terminal/node/ptyService.ts` | PTY host service, data buffering |
| `src/vs/platform/terminal/node/terminalProcess.ts` | node-pty wrapper |
| `src/vs/platform/terminal/common/terminalDataBuffering.ts` | 5ms data coalescing |
| `src/vs/workbench/contrib/terminal/browser/xterm/xtermAddonImporter.ts` | Lazy addon loading |

### xterm.js Source (in `/home/user/xterm.js`)

| File | What It Does |
|------|-------------|
| `typings/xterm.d.ts` | Complete public API (2232 lines) |
| `addons/addon-attach/src/AttachAddon.ts` | WebSocket integration (97 lines, simple reference) |
| `addons/addon-fit/src/FitAddon.ts` | Container dimension calculation |
| `addons/addon-webgl/src/WebglAddon.ts` | WebGL renderer switching |
| `src/browser/` | Browser rendering (74 files) |
| `src/common/` | Core emulation (92 files) |

---

## Appendix: Quick Reference — "What Made It Feel Native"

1. **Binary WebSocket** — eliminates UTF-8 encoding overhead
2. **5ms data buffering** — reduces WebSocket frame count by 10-100x
3. **Flow control** — prevents browser OOM on fast output
4. **WebGL renderer** — GPU-accelerated, handles large buffers without lag
5. **`TERM=xterm-256color`** — makes TUI apps work correctly
6. **`COLORTERM=truecolor`** — enables 24-bit color
7. **Resize debouncing + SIGWINCH** — smooth resize, correct TUI layout
8. **`onBinary` handler** — mouse support in TUI apps
9. **`convertEol: false`** — don't corrupt PTY line endings
10. **`smoothScrollDuration: 0`** — instant scroll, no perceived latency
11. **`scrollOnUserInput: true`** — auto-scroll to bottom on keystroke
12. **Proper container sizing** — `position: absolute; inset: 0` with padding
