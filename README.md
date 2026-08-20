# Cline Gateway UI

`gateway-ui` is a static, provider-neutral browser client for a remotely hosted
Cline server. The official UI and the user's server are separate deployments:

- The UI host serves only static HTML, CSS, JavaScript, fonts, and images.
- The browser connects directly to the user's authenticated `wss://` sidecar.
- The server address and token stay in that browser's local storage; the UI
  host does not receive or proxy them.
- Image and file attachments travel over the authenticated WebSocket and are
  materialized inside the selected session workspace by the server.

## Run locally

```bash
bun -F @cline/gateway-ui dev
```

## Build for any static host

```bash
bun -F @cline/gateway-ui build
```

Deploy `apps/gateway-ui/out/`. Each remote sidecar must expose `/transport`
over TLS and include the official UI origin in
`CLINE_SIDECAR_TRUSTED_ORIGINS`.
