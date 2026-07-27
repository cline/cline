# Cline Hub

A browser dashboard for the local Cline hub. Open it to see who's connected, what sessions are running, drive a session from a chat box, and restart the hub when you need a fresh daemon.

## Capabilities

- live list of connected hub clients (from `HubUIClient.subscribeUI`)
- live list of active sessions with status, model, and titles
- click a session to view its message history and stream new assistant output
- start a new session from an initial prompt — workspace/provider/model are reused from the most recent session, or `CLINE_PROVIDER` / `CLINE_MODEL` env vars
- send messages to the selected session and watch chunks stream back
- **Restart Hub** button: gracefully stops the local detached hub and respawns a fresh one
- optional LAN/tunnel exposure gated by a shared `ROOM_SECRET`

The dashboard registers two clients with the hub: a `cline-hub-server` (via `ClineCore`) for driving sessions and a `cline-hub-server` (via `HubUIClient`) for the admin view.

## Run

```bash
cd apps/cline-hub
bun run start
```

Open <http://127.0.0.1:8787> and click **Connect**. The server will discover or spawn a local detached hub on startup; the hub endpoint is printed in the console and shown in the sidebar.

From the CLI, `cline dashboard` opens the running dashboard in the default
browser and exits. The local hub daemon owns the background dashboard process
when the hub is launched by the CLI; starting a new hub replaces the discovered
dashboard process. Use `cline dashboard restart` or `cline dashboard stop` for
manual lifecycle control.

For webview development with Vite hot reload:

```bash
cd apps/cline-hub
bun run dev
```

This starts the Vite webview server on <http://127.0.0.1:5173> and the hub dashboard on <http://127.0.0.1:8787>. Open the dashboard URL; the served page loads webview modules from Vite, so changes under `src/webview/src` hot reload without rebuilding. Use `CLINE_HUB_WEBVIEW_DEV_PORT` or `CLINE_HUB_WEBVIEW_DEV_HOST` to change the Vite bind address.

To start a brand-new session, the dashboard needs to know which provider and model to use. It picks them up automatically from the most recent session on the hub. If there are no recent sessions, set `CLINE_PROVIDER` and `CLINE_MODEL` in the environment before running.

## Configuration

Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind host for the dashboard. Use the default for same-machine development. Set `HOST=0.0.0.0` only when intentionally exposing the dashboard on a LAN/tunnel. |
| `CLINE_HUB_DASHBOARD_PORT` | `8787` | Dashboard HTTP/WebSocket port. |
| `PUBLIC_URL` | `http://<HOST>:<PORT>` (`127.0.0.1` when binding `0.0.0.0`) | URL printed for humans to open/copy. Set this to your LAN URL or tunnel URL. |
| `ROOM_SECRET` | unset | Shared invite secret required for browser WebSocket connections when `HOST` is non-local. |
| `WORKSPACE_ROOT` | current directory | Workspace passed to the hub on startup. |
| `CLINE_PROVIDER` | unset | Fallback provider id when no recent session is available to copy from. |
| `CLINE_MODEL` | unset | Fallback model id when no recent session is available to copy from. |

The server prints both the bind URL and the public/invite URL at startup. When `ROOM_SECRET` is set, the printed invite URL includes `?roomSecret=...`; the browser UI also lets you paste the secret manually.

Validate option parsing without starting a server:

```bash
bun run smoke:options
```

## LAN usage

Choose a strong room secret and bind explicitly to all interfaces:

```bash
cd apps/cline-hub
HOST=0.0.0.0 \
CLINE_HUB_DASHBOARD_PORT=8787 \
PUBLIC_URL=http://YOUR_LAN_IP:8787 \
ROOM_SECRET='use-a-long-random-secret' \
bun run start
```

Share the printed invite URL with another machine on the same LAN.

`ROOM_SECRET` is required for `HOST=0.0.0.0`; without it the dashboard exits before listening.

## Tunnel usage

Start the dashboard locally with an explicit secret:

```bash
cd apps/cline-hub
ROOM_SECRET='use-a-long-random-secret' bun run start
```

In another terminal, expose the local port with your tunnel provider, for example:

```bash
ngrok http 8787
```

Restart the dashboard with the tunnel URL as `PUBLIC_URL` so the printed invite URL is copyable:

```bash
PUBLIC_URL=https://YOUR-TUNNEL.example \
ROOM_SECRET='use-a-long-random-secret' \
bun run start
```

Share only the printed invite URL with trusted participants.

## Restarting the hub

Clicking **Restart Hub** in the sidebar:

1. Detaches the dashboard's `ClineCore` and `HubUIClient` from the current hub.
2. Calls `stopLocalHubServerGracefully()` to shut the local detached hub down.
3. Calls `ensureDetachedHubServer(workspaceRoot)` to spawn a fresh hub.
4. Reconnects and broadcasts the new hub state to every open browser tab.

Sessions running on the previous hub are stopped along with the hub. Other clients connected to that hub (CLI, VS Code, menubar) will see their connection drop and reconnect to the new daemon on next request.

## Security warning

This is an example dashboard, not a production admin tool. Exposing it on a LAN or tunnel lets anyone with the invite secret list clients/sessions on your hub, drive sessions, and restart the hub. Use a long random `ROOM_SECRET`, only share the URL with trusted participants, and stop the process when you are done. The hub and agent runtime remain owned by the host machine.
