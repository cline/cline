# Web Terminal POC

A proof-of-concept web-based terminal emulator that feels native. Launches a local server, opens your browser, and gives you a real terminal at `localhost:3000` -- full TUI support (vim, htop, less), no input delay, proper scrollback, the works.

Built by studying how VS Code's integrated terminal works under the hood. Every design decision below is traced back to VS Code's source code.

## Quick Start

```bash
cd web-terminal-poc
npm install
npm start          # Opens browser automatically
# or
NO_OPEN=1 npm start  # Don't auto-open browser
PORT=8080 npm start   # Use a different port
```

## What Makes It Feel Native

Most web terminals feel janky. Here's why, and what this POC does differently.

### 1. Binary WebSocket Transport

**The problem:** Most web terminals send text WebSocket frames. Every frame goes through UTF-8 validation on both sides. Terminal output often contains partial UTF-8 sequences (data arrives in arbitrary chunks), which causes encoding errors or data corruption.

**The fix:** Binary WebSocket frames (`ArrayBuffer`). No encoding/decoding overhead, no partial-sequence issues. Data passes through byte-for-byte.

```
// What most tutorials do (WRONG):
ws.send(ptyOutput)                    // Text frame, UTF-8 validation
terminal.write(event.data)            // String decode

// What this POC does (RIGHT):
ws.send(buffer, { binary: true })     // Binary frame, zero overhead
terminal.write(new Uint8Array(data))  // Direct binary write
```

**Where VS Code does this:** `terminalProcess.ts` sends binary data over its IPC channel. The transport layer never touches text encoding.

---

### 2. Data Buffering (5ms Coalescing)

**The problem:** A PTY generates many small writes. Running `ls -la /usr/bin` produces hundreds of individual write events, each 10-200 bytes. Without buffering, each becomes a separate WebSocket frame and a separate `terminal.write()` call. The per-message overhead (framing, event dispatch, parse cycle, render) dominates, causing visible lag.

**The fix:** Buffer PTY output and flush every 5ms. Hundreds of tiny writes merge into one large WebSocket frame.

```javascript
// server.mjs - Data buffering
ptyProcess.onData((data) => {
  dataBuffer.push(Buffer.from(data, "utf-8"));
  if (bufferTimer === null) {
    bufferTimer = setTimeout(flushBuffer, 5); // 5ms, matches VS Code
  }
});
```

**Why 5ms?** VS Code uses exactly 5ms in `TerminalDataBufferer` (`src/vs/platform/terminal/common/terminalDataBuffering.ts`). It's fast enough to feel instant (human perception threshold is ~13ms) but long enough to coalesce most burst writes.

**Impact:** Running `seq 1 100000` goes from thousands of WebSocket frames to dozens. The difference is night and day.

---

### 3. Flow Control (Backpressure)

**The problem:** Run `cat /dev/urandom | xxd` and the PTY dumps megabytes per second. Without flow control, the server keeps sending, the browser queues it all in memory, and the tab crashes (OOM).

**The fix:** Client-side acknowledgment protocol, modeled after VS Code's `acknowledgeDataEvent()`.

```
How it works:
1. Server sends PTY data via WebSocket
2. Client writes to xterm.js with terminal.write(data, callback)
3. callback fires when xterm has PARSED the data (not just queued it)
4. Client tracks total parsed bytes
5. Every 100KB, client sends an "ack" message to server
6. Server tracks unacked bytes
7. If unacked > 5MB, server pauses the PTY (pty.pause())
8. When unacked drops below 2.5MB, server resumes (pty.resume())
```

**Why the write callback matters:** `terminal.write()` is async. Data goes into a parse queue. The callback tells you when parsing is done and the data is reflected in the buffer. If you ack immediately on receipt (before parsing), you're lying about how much the client has actually processed.

**Where VS Code does this:** `terminalProcessManager.ts` has `acknowledgeDataEvent()` with `FlowControlConstants.CharCountAckSize = 100000`.

---

### 4. WebGL Renderer

**The problem:** xterm.js has three renderers:
- **DOM renderer** - One DOM element per character. Absurdly slow for large buffers.
- **Canvas renderer** - 2D canvas, decent but CPU-bound.
- **WebGL renderer** - GPU-accelerated via texture atlas. Fast.

Most tutorials don't mention the WebGL addon. The default canvas renderer works fine for small amounts of output but visibly lags on fast-scrolling content.

**The fix:** Load the WebGL addon, with graceful fallback.

```javascript
try {
  const webglAddon = new WebglAddon();
  webglAddon.onContextLoss(() => {
    webglAddon.dispose(); // Fall back to canvas
  });
  terminal.loadAddon(webglAddon);
} catch (e) {
  // Canvas renderer as fallback
}
```

**Why handle context loss?** WebGL contexts can be lost when the browser reclaims GPU resources (tab backgrounded, system sleep, etc.). VS Code handles this in `xtermTerminal.ts` with the exact same pattern.

---

### 5. TERM=xterm-256color

**The problem:** TUI apps (vim, htop, less, tmux) query the `TERM` environment variable to decide what escape sequences to use. If `TERM` is wrong or unset:
- vim renders in "dumb" mode (no syntax highlighting, no cursor movement)
- htop won't start at all
- Colors are limited to 8 or missing entirely
- Mouse reporting doesn't work

**The fix:** Set `name: "xterm-256color"` in the node-pty spawn options. This sets the `TERM` env var in the child process.

```javascript
const ptyProcess = pty.spawn(shell, [], {
  name: "xterm-256color",    // <-- This is the TERM value
  env: {
    ...process.env,
    COLORTERM: "truecolor",  // Advertise 24-bit color
  },
});
```

**Why "xterm-256color"?** xterm.js implements the xterm terminal type. The "256color" variant tells apps they can use the full 256-color palette. `COLORTERM=truecolor` further advertises 24-bit RGB color support.

---

### 6. Resize Pipeline

**The problem:** When the browser window resizes, TUI apps need to know the new terminal dimensions. Without this, vim keeps rendering for the old size, leaving garbled output and misaligned UI.

The full pipeline has 5 steps. Miss any one and it breaks:

```
Browser window resizes
  --> (debounced 100ms) FitAddon.fit()
    --> calculates new cols/rows from container pixel dimensions
      --> terminal.resize(cols, rows) fires onResize event
        --> WebSocket control message: {"type":"resize","cols":120,"rows":40}
          --> pty.resize(120, 40) sends SIGWINCH to child process
            --> TUI app re-queries size via ioctl(TIOCGWINSZ) and redraws
```

**Why debounce?** Each resize triggers:
1. xterm buffer reflow (rewraps all lines for new width - expensive for wide buffers)
2. A SIGWINCH signal to the child process
3. A complete redraw from the TUI app

During a window drag, resize fires 60+ times per second. 100ms debounce (matching VS Code's `terminalResizeDebouncer.ts`) reduces this to ~10 resizes.

**Why ResizeObserver?** `window.resize` doesn't fire for all container size changes. Opening browser dev tools, toggling a sidebar, or programmatic layout changes won't trigger it. `ResizeObserver` catches everything.

---

### 7. onBinary Handler

**The problem:** Mouse-enabled TUI apps (vim with mouse, htop, midnight commander) send mouse position reports using escape sequences. Some of these use raw binary encoding that isn't valid UTF-8. xterm.js provides two events:
- `onData` - UTF-8 string data (keyboard input, paste)
- `onBinary` - Raw binary data (mouse reports in certain modes)

If you only handle `onData`, mouse clicks in TUI apps silently break.

**The fix:**

```javascript
terminal.onBinary((data) => {
  const buffer = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    buffer[i] = data.charCodeAt(i) & 0xff;
  }
  ws.send(buffer); // Binary frame
});
```

---

### 8. convertEol: false

**The problem:** xterm.js has a `convertEol` option that converts `\n` to `\r\n`. Some tutorials enable this "to fix line breaks." This completely destroys TUI rendering because the PTY already handles line endings correctly. Adding extra `\r` characters causes double-spaced output and broken cursor positioning.

**The rule:** Never enable `convertEol` when connected to a PTY. The PTY's line discipline handles all newline translation.

---

### 9. Instant Scrolling (smoothScrollDuration: 0)

**The problem:** xterm.js supports smooth scrolling animation via `smoothScrollDuration`. Any value > 0 adds a visible animation when the terminal scrolls. This feels nice in a text editor but terrible in a terminal, where `cat` output should appear instantly.

**The fix:** `smoothScrollDuration: 0` (the default, but worth being explicit about).

---

### 10. scrollOnUserInput: true

**The problem:** If you scroll up to read earlier output, then start typing, the viewport stays scrolled up. You're typing blind. This is the single most complained-about behavior in web terminals.

**The fix:** `scrollOnUserInput: true` (also the default, but critical to not accidentally disable).

---

### 11. Container Sizing

**The problem:** FitAddon calculates terminal dimensions from the container's pixel dimensions. If the container has `height: auto` or no explicit sizing, FitAddon returns `{cols: 2, rows: 1}` -- a useless terminal.

**The fix:** The container must have explicit dimensions before `terminal.open()` and `fitAddon.fit()` are called.

```css
#terminal-container {
  position: absolute;
  inset: 0;            /* Fill viewport */
  padding: 8px 12px;   /* FitAddon accounts for padding */
}
```

**Why padding matters:** FitAddon reads the container's computed padding and subtracts it from available space before calculating cols/rows. The 8px/12px values match VS Code's terminal padding.

---

### 12. VS Code Theme Colors

Using VS Code's exact ANSI color palette makes the terminal immediately feel familiar to developers. The theme in this POC is extracted directly from VS Code's dark theme defaults:

```javascript
theme: {
  background: "#1e1e1e",
  foreground: "#cccccc",
  cursor: "#aeafad",
  selectionBackground: "#264f78",
  // ... full ANSI color table
}
```

---

## Architecture

```
+-----------------------------------------------------------+
|  Browser                                                   |
|                                                            |
|  xterm.js Terminal                                         |
|    +-- WebglAddon (GPU rendering)                          |
|    +-- FitAddon (auto-sizing)                              |
|    +-- WebLinksAddon (clickable URLs)                      |
|    +-- Unicode11Addon (CJK/emoji widths)                   |
|    +-- SearchAddon (Ctrl+F search)                         |
|                                                            |
|  Custom WebSocket handler                                  |
|    +-- Binary frames for terminal data                     |
|    +-- Text frames for control messages (resize, ack)      |
|    +-- Flow control acknowledgment every 100KB             |
|    +-- terminal.write(data, callback) for backpressure     |
+-----------------------------+-----------------------------+
                              |
                         WebSocket
                     (binary + text frames)
                              |
+-----------------------------+-----------------------------+
|  Node.js Server (server.mjs)                               |
|                                                            |
|  Express                                                   |
|    +-- Static file server (xterm.js from node_modules)     |
|    +-- Serves public/index.html                            |
|                                                            |
|  WebSocket Server (/ws)                                    |
|    +-- Binary frames --> pty.write() (user input)          |
|    +-- Text frames --> control handler (resize, ack)       |
|                                                            |
|  PTY Manager                                               |
|    +-- node-pty with TERM=xterm-256color                   |
|    +-- 5ms data buffering (coalesces small writes)         |
|    +-- Flow control (pause/resume on backpressure)         |
|    +-- pty.onData --> buffer --> binary WebSocket frame     |
+-----------------------------------------------------------+
```

### Why Not Use the AttachAddon?

xterm.js ships an `AttachAddon` that wires a WebSocket directly to the terminal. It's great for demos but missing three things required for a native feel:

1. **No flow control** -- fast output (e.g., `cat /dev/urandom`) will OOM the browser
2. **No control channel** -- no way to send resize events alongside terminal data
3. **No reconnection** -- no state save/restore when the WebSocket drops

This POC uses a custom WebSocket handler that separates data (binary frames) from control (text frames with JSON).

---

## How VS Code Does It

VS Code's terminal is a three-layer architecture. This POC flattens it into two layers (browser + server) since we don't need the process isolation that VS Code requires for extension sandboxing.

### VS Code's Three Layers

| Layer | VS Code Component | POC Equivalent |
|-------|-------------------|----------------|
| **Frontend** | `xtermTerminal.ts` - xterm.js config, addon loading | `public/index.html` |
| **Frontend** | `terminalInstance.ts` - I/O pipeline, resize debouncing | `public/index.html` (WebSocket handler) |
| **Process Manager** | `terminalProcessManager.ts` - flow control, lifecycle | `server.mjs` (WebSocket handler) |
| **PTY Host** | `ptyService.ts` + `terminalProcess.ts` - node-pty, data buffering | `server.mjs` (PTY manager) |

### Key VS Code Source Files

| File | What We Learned |
|------|----------------|
| `terminalDataBuffering.ts` | 5ms coalescing interval for PTY output |
| `terminalProcessManager.ts` | Flow control via `acknowledgeDataEvent()`, 100KB ack size |
| `xtermTerminal.ts` | WebGL addon loading pattern, context loss handling |
| `terminalResizeDebouncer.ts` | 100ms horizontal resize debounce |
| `terminalProcess.ts` | `TERM=xterm-256color`, `COLORTERM=truecolor` |

---

## WebSocket Protocol

The POC uses a simple protocol that separates data from control using WebSocket frame types:

### Binary Frames = Terminal Data

```
Client --> Server: User input (keystrokes, paste)
Server --> Client: PTY output (command results, TUI rendering)
```

No framing, no headers, no length prefixes. Just raw bytes. This is the lowest-overhead approach possible.

### Text Frames = Control Messages (JSON)

**Client --> Server:**

```json
{"type": "resize", "cols": 120, "rows": 40}
{"type": "ack", "bytes": 100000}
```

**Server --> Client:**

```json
{"type": "exit", "exitCode": 0, "signal": null}
```

### Why Two Frame Types?

Alternatives considered:
- **Multiplexing with length-prefix framing**: Adds parsing complexity and overhead on every message
- **Separate WebSocket for control**: Extra connection, synchronization headaches
- **In-band escape sequences**: Would conflict with actual terminal escape sequences

WebSocket natively supports binary vs text frame types. Using this built-in distinction gives us a zero-overhead control channel.

---

## Common Pitfalls (and How This POC Avoids Them)

### "My terminal is laggy when I type fast"

**Cause:** Each keystroke echo generates a separate WebSocket frame + `terminal.write()` call. The per-call overhead (JS event dispatch, xterm parse cycle, render) adds up.

**Fix:** 5ms data buffering on the server coalesces multiple echo characters into one frame.

### "vim/htop/less doesn't work"

**Cause:** Wrong `TERM` value (or unset), missing resize events, or `convertEol: true`.

**Fix:** `name: "xterm-256color"` in node-pty options, full resize pipeline, `convertEol: false`.

### "Running `cat /dev/urandom` crashes the tab"

**Cause:** No flow control. Server sends faster than the browser can render.

**Fix:** Ack-based flow control. Server pauses PTY when client falls behind.

### "Scrollback disappears after reconnect"

**Cause:** Terminal state is in-memory. WebSocket reconnect creates a fresh terminal.

**Fix (not in POC, see Future Work):** Use `SerializeAddon` to snapshot terminal state, store on server, restore on reconnect. VS Code does this with `persistentSessionScrollback`.

### "Colors look wrong"

**Cause:** Missing `COLORTERM=truecolor` or incomplete ANSI color theme.

**Fix:** Set `COLORTERM=truecolor` in PTY env, provide full 16-color ANSI palette in xterm.js theme.

### "Mouse doesn't work in TUI apps"

**Cause:** Only handling `onData`, not `onBinary`. Some mouse position reports use non-UTF8 encoding.

**Fix:** Handle both `onData` and `onBinary` events.

### "Terminal is tiny / wrong size on load"

**Cause:** Calling `fitAddon.fit()` before `terminal.open()`, or container has no explicit dimensions.

**Fix:** Call `open()` first (so xterm can measure font metrics), then `fit()`. Container must have explicit width/height.

---

## xterm.js Addon Reference

| Addon | What It Does | Why We Use It |
|-------|-------------|---------------|
| **@xterm/addon-fit** | Calculates cols/rows from container pixel size | Auto-sizing on window resize |
| **@xterm/addon-webgl** | GPU-accelerated rendering via WebGL2 texture atlas | Performance on fast output |
| **@xterm/addon-web-links** | Detects and makes URLs clickable | Expected UX in modern terminals |
| **@xterm/addon-search** | Ctrl+F search through terminal buffer | Finding text in scrollback |
| **@xterm/addon-unicode11** | Correct character width for Unicode 11 (CJK, emoji) | Proper layout with non-ASCII text |

### Addons Not Used But Worth Knowing

| Addon | What It Does | When You'd Need It |
|-------|-------------|-------------------|
| **@xterm/addon-serialize** | Serialize buffer to VT sequences or HTML | Session persistence / reconnection |
| **@xterm/addon-image** | Inline images (Sixel, iTerm, Kitty protocols) | Displaying images in terminal |
| **@xterm/addon-clipboard** | System clipboard via OSC 52 | When apps request clipboard access |

---

## Configuration Reference

Every xterm.js option used in this POC, with rationale:

```javascript
{
  // --- Core ---
  allowProposedApi: true,          // Required for some addons

  // --- Font ---
  fontFamily: "'Cascadia Code', ..., monospace",  // Monospace stack with fallbacks
  fontSize: 13,                    // VS Code default. Smaller risks subpixel issues
  lineHeight: 1.0,                 // Tight line spacing, like a real terminal
  letterSpacing: 0,                // No extra spacing

  // --- Cursor ---
  cursorBlink: true,               // Makes terminal feel "alive"
  cursorStyle: "bar",              // Modern default (VS Code uses bar)
  cursorWidth: 1,                  // Thin bar cursor

  // --- Scrollback ---
  scrollback: 10000,               // Generous history (VS Code default: 1000)
  scrollOnUserInput: true,         // Auto-scroll to bottom on keystroke
  smoothScrollDuration: 0,         // Instant scroll, no animation lag

  // --- Input ---
  convertEol: false,               // NEVER enable with PTY
  disableStdin: false,             // We want user input
  macOptionIsMeta: true,           // Option = Meta on Mac (for Alt shortcuts)
  macOptionClickForcesSelection: true, // Option+Click = select (not mouse report)
  wordSeparator: " ()[]{}',\"`",   // Double-click word selection boundaries

  // --- Rendering ---
  allowTransparency: false,        // Perf cost, not needed

  // --- Theme ---
  theme: { /* VS Code dark theme colors */ }
}
```

---

## File Structure

```
web-terminal-poc/
  server.mjs              Node.js server (Express + WebSocket + node-pty)
  public/
    index.html             Client (xterm.js + WebSocket handler)
  package.json             Dependencies
  INVESTIGATION.md         Deep-dive investigation report
  README.md                This file
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | Static file server for client assets |
| `ws` | WebSocket server |
| `node-pty` | Pseudo-terminal (PTY) for spawning shell processes |
| `open` | Auto-open browser on server start |
| `@xterm/xterm` | Terminal emulator frontend |
| `@xterm/addon-fit` | Auto-sizing |
| `@xterm/addon-webgl` | GPU-accelerated rendering |
| `@xterm/addon-web-links` | Clickable URLs |
| `@xterm/addon-search` | Buffer search |
| `@xterm/addon-unicode11` | Unicode width tables |

---

## Future Work

Things not in the POC but needed for production:

### Session Persistence
Snapshot terminal state with `SerializeAddon`, store on server, restore on WebSocket reconnect. VS Code stores 100 lines by default (`persistentSessionScrollback`).

### Multiple Terminals
Tab bar / split panes. Each terminal gets its own WebSocket connection and PTY. Server needs a session manager mapping connection IDs to PTY instances.

### Shell Integration
VS Code injects shell hooks (bash precmd/preexec, zsh, fish, PowerShell) that emit OSC 633 escape sequences. These enable:
- Command detection (know where each command starts/ends)
- Working directory tracking
- Exit code display (green/red markers)
- Command-based navigation in scrollback

This is the hardest thing to implement but provides the biggest UX improvement.

### Security
- Bind to `127.0.0.1` only (already default with Express)
- Session tokens to prevent unauthorized access
- HTTPS/WSS for non-localhost deployments
- Rate limiting to prevent abuse

### Theming
- Light/dark toggle
- Custom color scheme picker
- Font selection UI
- Sync with system dark mode preference

---

## Quick Reference Card

| What | Why | Where |
|------|-----|-------|
| Binary WebSocket | No UTF-8 encoding overhead | server.mjs:166, index.html:327 |
| 5ms data buffering | Reduce frame count 10-100x | server.mjs:86,190 |
| Flow control (ack) | Prevent OOM on fast output | server.mjs:77-80, index.html:220,330 |
| WebGL renderer | GPU-accelerated rendering | index.html:270 |
| `TERM=xterm-256color` | TUI app compatibility | server.mjs:132 |
| `COLORTERM=truecolor` | 24-bit color support | server.mjs:138 |
| Resize debounce 100ms | Prevent excessive reflow | index.html:435 |
| SIGWINCH via pty.resize() | Tell TUI apps about new size | server.mjs:228 |
| `onBinary` handler | Mouse support in TUI apps | index.html:403 |
| `convertEol: false` | Don't corrupt PTY output | index.html:196 |
| `smoothScrollDuration: 0` | Instant scroll | index.html:140 |
| `scrollOnUserInput: true` | Auto-scroll on keystroke | index.html:139 |
| Container `inset: 0` | Proper FitAddon calculation | index.html:30 |
| VS Code theme colors | Familiar appearance | index.html:146 |
