# Device architecture comparison

- **Baseline:** commit `defee6f86`: device SDK under
  `sdk/packages/device`, standalone bridge app, dashboard-owned bridge lifecycle.
- **Hub service:** `bee/hub-device-service`: a separate device SDK repository, with one
  Node device service owned by the shared hub daemon.

The hardware protocol and firmware behavior are unchanged. Typed prompts,
voice input, avatars, board profiles, and M5Launcher packaging remain available.

## Try either branch

Stop the dashboard and the existing device bridge before switching. Stop the
shared hub with `bun run cli hub stop`. Then select a branch and run:

```sh
bun install
bun run build:sdk
bun -F @cline/cline-hub build:webview
bun run cli dashboard
```

The baseline has **Start bridge**. The new branch starts devices with the hub
and shows a **Devices** panel with pairing, endpoints and connected devices.
**Enable devices** / **Disable devices** affect the shared hub service. Closing
any app leaves the device service running; stopping the hub closes it.

The hardware endpoint remains on port 25470. The browser client has been removed.
Only run one variant at a time, or configure different `CLINE_DEVICE_PORT` values.
The service stores pairing records under `<Cline data directory>/devices/`; pair
existing hardware once on this branch. No firmware update is needed.

## Standalone hardware SDK

The SDK is maintained in [cline/device-sdk](https://github.com/cline/device-sdk).
For local development, keep its checkout beside Cline (`../device-sdk` relative
to the Cline repository root), run its `bun install` and `bun run build`, then
run `bun install` in Cline to refresh the local `@cline/device` dependency.
It includes protocol types, firmware, board profiles, avatar assets, tests, and
build tooling. It has no dependency on any agent package.

## Shared host API

CLI, desktop and VS Code can use their authenticated `HubUIClient`:

```ts
const state = await client.devices();
const paired = await client.devices("pair");
const unsubscribe = client.subscribeDevices((state) => {
  // Render endpoints, connection state, devices, and pairing code.
});
```

The underlying commands are `device.status`, `device.start`, `device.stop`, and
`device.pair`; updates use `device.changed`. The dashboard consumes this API.
Dedicated device panels in desktop and VS Code can be added independently.
