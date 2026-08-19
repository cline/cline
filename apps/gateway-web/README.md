# Gateway web

A browser client for the Phase 7 remote Gateway. It connects directly over
`ws://` (loopback development) or `wss://` (remote use), negotiates protocol v1,
lists bots and sessions, replays durable events, starts and steers runs, handles
tool approvals, and can interrupt or abort an active run.

The remote access token is kept only in React memory. It is never written to
local storage, cookies, logs, query parameters, or the Gateway URL. The URL and
assigned non-secret client ID are persisted for reconnect convenience.

```sh
bun install
bun -F @cline/gateway-web dev
```

Open `http://127.0.0.1:4174`, enter the Gateway WebSocket address and the
`remote-access` token provisioned on that Gateway. Browsers require `wss://`
when this app is served over HTTPS.

The token field may be left blank when `VITE_CLINE_GATEWAY_TOKEN` was set while
building or starting the web client. Vite embeds `VITE_*` values in client-side
JavaScript, so use this fallback only for a private build; public deployments
should require the user to enter the token at connection time.

Build static assets with:

```sh
bun -F @cline/gateway-web build
```

The resulting `dist/` directory can be hosted on any static HTTPS host. The
Gateway itself remains the sole backend and persistence authority.
