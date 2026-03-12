/**
 * Web Terminal Server - POC
 *
 * Architecture (modeled after VS Code's terminal):
 *
 *   ┌------------------------------------------------------┐
 *   │  Browser (xterm.js)                                   │
 *   │                                                       │
 *   │  Terminal --> AttachAddon --> WebSocket (binary)      │
 *   │     │            │                                    │
 *   │  FitAddon    WebglAddon                               │
 *   └-------------------┬----------------------------------┘
 *                       │  Binary WebSocket frames
 *                       │  + JSON control messages
 *                       ▼
 *   ┌------------------------------------------------------┐
 *   │  Node.js Server                                       │
 *   │                                                       │
 *   │  WebSocketServer --> PtyManager                       │
 *   │       │                   │                           │
 *   │  Express (static)    node-pty (PTY process)           │
 *   │                           │                           │
 *   │                      Flow control                     │
 *   │                      Data buffering                   │
 *   └------------------------------------------------------┘
 *
 * KEY DESIGN DECISIONS (learned from VS Code source):
 *
 * 1. BINARY WEBSOCKET - We use binary frames (ArrayBuffer), not text.
 *    This avoids UTF-8 encode/decode overhead and handles raw terminal
 *    output (which can include partial UTF-8 sequences) correctly.
 *
 * 2. FLOW CONTROL - VS Code implements backpressure via
 *    acknowledgeDataEvent(). We replicate this: the server tracks
 *    unacknowledged bytes and pauses the PTY if the client falls behind.
 *    This prevents memory blowup on fast output (e.g., `cat /dev/urandom`).
 *
 * 3. DATA BUFFERING - Small PTY outputs are batched on a 5ms timer
 *    (matching VS Code's TerminalDataBufferer) to reduce WebSocket frame
 *    count. High-throughput scenarios benefit enormously from this.
 *
 * 4. RESIZE PROTOCOL - Resize messages are sent as JSON control frames
 *    (text WebSocket messages). PTY data is always binary frames.
 *    This avoids needing an in-band protocol.
 *
 * 5. SEPARATE CONTROL CHANNEL - Text frames = control (resize, etc.),
 *    Binary frames = terminal data. Clean separation, no framing overhead.
 */

import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import pty from "node-pty";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import open from "open";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Configuration -----------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3000", 10);
const SHELL = process.env.SHELL || "/bin/bash";
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Flow control constants - modeled after VS Code's FlowControlConstants.
 *
 * CHAR_COUNT_ACK_SIZE: After this many bytes are written to the WebSocket,
 * the server expects an acknowledgment from the client. If the client
 * falls behind by more than HIGH_WATER_MARK bytes, the PTY is paused.
 *
 * This prevents OOM when a process dumps megabytes of output faster than
 * the browser can render it.
 */
const FLOW_CONTROL = {
  CHAR_COUNT_ACK_SIZE: 100000, // Ack every 100KB
  HIGH_WATER_MARK: 5000000, // Pause PTY at 5MB unacked
};

/**
 * Data buffering interval - VS Code uses 5ms in TerminalDataBufferer.
 * Small PTY writes are coalesced into a single WebSocket frame.
 */
const DATA_BUFFER_INTERVAL_MS = 5;

// --- Express + HTTP Server ---------------------------------------------------

const app = express();

// Serve xterm.js from node_modules
app.use(
  "/xterm",
  express.static(join(__dirname, "node_modules/@xterm/xterm")),
);
app.use(
  "/xterm-addon-fit",
  express.static(join(__dirname, "node_modules/@xterm/addon-fit")),
);
app.use(
  "/xterm-addon-webgl",
  express.static(join(__dirname, "node_modules/@xterm/addon-webgl")),
);
app.use(
  "/xterm-addon-web-links",
  express.static(join(__dirname, "node_modules/@xterm/addon-web-links")),
);
app.use(
  "/xterm-addon-search",
  express.static(join(__dirname, "node_modules/@xterm/addon-search")),
);
app.use(
  "/xterm-addon-unicode11",
  express.static(join(__dirname, "node_modules/@xterm/addon-unicode11")),
);

// Serve the client HTML
app.use(express.static(join(__dirname, "public")));

const server = createServer(app);

// --- WebSocket Server --------------------------------------------------------

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("[server] New WebSocket connection");

  // -- Create PTY ----------------------------------------------------------
  const ptyProcess = pty.spawn(SHELL, [], {
    name: "xterm-256color", // TERM env var - critical for TUI apps
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd: process.env.HOME || process.cwd(),
    env: {
      ...process.env,
      COLORTERM: "truecolor", // Advertise 24-bit color support
      TERM_PROGRAM: "web-terminal", // Identify ourselves
    },
  });

  console.log(`[server] PTY spawned: PID ${ptyProcess.pid}, shell: ${SHELL}`);

  // -- Flow Control State --------------------------------------------------
  let unackedBytes = 0;
  let isPaused = false;

  // -- Data Buffering ------------------------------------------------------
  // Coalesce small PTY writes into larger WebSocket frames.
  // This is critical for performance - without it, each keystroke echo
  // generates a separate WebSocket frame + xterm.write() call.
  let dataBuffer = [];
  let bufferTimer = null;

  function flushBuffer() {
    if (dataBuffer.length === 0) return;

    // Concatenate all buffered chunks into one binary frame
    const totalLength = dataBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = Buffer.concat(dataBuffer, totalLength);
    dataBuffer = [];
    bufferTimer = null;

    if (ws.readyState === ws.OPEN) {
      ws.send(merged, { binary: true });

      // Track for flow control
      unackedBytes += merged.length;

      // Pause PTY if client is falling behind
      if (!isPaused && unackedBytes > FLOW_CONTROL.HIGH_WATER_MARK) {
        isPaused = true;
        ptyProcess.pause();
        console.log(
          `[server] PTY paused - unacked bytes: ${unackedBytes}`,
        );
      }
    }
  }

  // -- PTY -> WebSocket (output) -------------------------------------------
  ptyProcess.onData((data) => {
    // node-pty gives us a string, convert to Buffer for binary transport
    const chunk = Buffer.from(data, "utf-8");
    dataBuffer.push(chunk);

    // Schedule flush if not already scheduled
    if (bufferTimer === null) {
      bufferTimer = setTimeout(flushBuffer, DATA_BUFFER_INTERVAL_MS);
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(
      `[server] PTY exited: code=${exitCode}, signal=${signal}`,
    );
    // Flush any remaining data
    flushBuffer();
    // Send exit notification as control message
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode, signal }));
      ws.close();
    }
  });

  // -- WebSocket -> PTY (input + control) ----------------------------------
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      // Binary frame = user input -> forward to PTY
      ptyProcess.write(data.toString("utf-8"));
    } else {
      // Text frame = control message (JSON)
      try {
        const msg = JSON.parse(data.toString());
        handleControlMessage(msg);
      } catch (e) {
        console.error("[server] Bad control message:", e.message);
      }
    }
  });

  function handleControlMessage(msg) {
    switch (msg.type) {
      case "resize":
        // Resize PTY - this sends SIGWINCH to the child process
        if (msg.cols > 0 && msg.rows > 0) {
          ptyProcess.resize(msg.cols, msg.rows);
          console.log(`[server] PTY resized: ${msg.cols}x${msg.rows}`);
        }
        break;

      case "ack":
        // Client acknowledges it has processed data - flow control
        unackedBytes = Math.max(0, unackedBytes - (msg.bytes || 0));
        if (isPaused && unackedBytes < FLOW_CONTROL.HIGH_WATER_MARK / 2) {
          isPaused = false;
          ptyProcess.resume();
          console.log(
            `[server] PTY resumed - unacked bytes: ${unackedBytes}`,
          );
        }
        break;

      default:
        console.log(`[server] Unknown control message: ${msg.type}`);
    }
  }

  // -- Cleanup -------------------------------------------------------------
  ws.on("close", () => {
    console.log("[server] WebSocket closed, killing PTY");
    if (bufferTimer) clearTimeout(bufferTimer);
    ptyProcess.kill();
  });

  ws.on("error", (err) => {
    console.error("[server] WebSocket error:", err.message);
    if (bufferTimer) clearTimeout(bufferTimer);
    ptyProcess.kill();
  });
});

// --- Start Server ------------------------------------------------------------

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Web Terminal running at: ${url}\n`);

  // Auto-open browser
  if (process.env.NO_OPEN !== "1") {
    open(url).catch(() => {
      console.log("  Could not auto-open browser. Open the URL manually.");
    });
  }
});
