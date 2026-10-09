# Device architecture comparison

- **Baseline:** `bee/cline-pet`, commit `defee6f86`: device SDK under
  `sdk/packages/device`, standalone bridge app, dashboard-owned bridge lifecycle.
- **Hub service:** `bee/hub-device-service`: standalone `device-sdk/`, with one
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

Default endpoints remain port 25470 for devices and 25471 for the HTTPS browser
pet. Only run one variant at a time, or configure different `CLINE_DEVICE_PORT`
and `CLINE_DEVICE_WEB_PORT` values. The new service stores pairing records under
`<Cline data directory>/devices/`; pair existing hardware once on this branch.
No firmware update is needed for the hub integration.

## Standalone hardware SDK

`device-sdk/` has its own package manifest, lockfile, TypeScript configuration,
license, tests, assets, browser pet, firmware, and a workflow ready for an
independent repository. Copy this directory outside the monorepo and run:

```sh
bun install --frozen-lockfile
bun run build
bun test
bun run firmware
```

The monorepo currently includes it as a workspace package named `@cline/device`.
It has no dependency on any agent package. No new remote repository is created.

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
