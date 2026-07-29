# `@cline/drivecode-demo`

Status Hub **demo fixtures** and a **demo adapter** that implement the same
`StatusSnapshotSource` port as the live hub adapter.

## Not a plugin system

Demos are normal **adapters** that implement the same ports as the live hub
adapters (`StatusSnapshotSource` / teams source). Compose them at CLI / hub
entrypoints. Product views depend only on the port — not on this package.

## Usage

```ts
import {
	DrivePlansDemoStatusSnapshotSource,
	readDrivecodeDemoCliBootstrap,
	readDrivecodeDemoHubBootstrap,
} from "@cline/drivecode-demo";

const cli = readDrivecodeDemoCliBootstrap();
if (cli.useDemoStatusAdapter) {
	const source = new DrivePlansDemoStatusSnapshotSource();
	const snap = await source.load();
}

const hub = readDrivecodeDemoHubBootstrap(window.location.search);
```

## Env / query (edge only)

| Edge | Flag | Effect |
|------|------|--------|
| CLI | `CLINE_DEMO_STATUS_PLANS=1` | Use demo status adapter |
| CLI | `CLINE_DEMO_STATUS_LENS=board\|dependency-map` | Initial Status lens |
| CLI | `CLINE_DEMO_OPEN_STATUS=1` | Auto-open Status dialog |
| CLI | `CLINE_DEMO_DRIVE=1` | Start with Drive active |
| Hub | `?demoPlans=1` | Use demo teams fixture |
| Hub | `?demoShareScreen=1` | Mount simulated share-screen Spotlight demo on `/drive` |
| Hub | `?statusMode=board\|changelog\|dependency-map` | Initial Status mode |

`load()` on the demo adapter never reads env or query — only the bootstrap
helpers do.
