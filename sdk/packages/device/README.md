# @cline/device

Reusable Cline device SDK, with no agent-runtime or host-app dependency.

- `src/`: device wire protocol, message types, limits, and parser.
- `firmware/`: ESP-IDF application and reusable model, transport, board, UI,
  and application components.
- `firmware/devices/`: isolated board profiles for Waveshare e-paper, round
  Waveshare AMOLED, and M5Stack Cardputer ADV.
- `assets/avatars/`: shared versioned avatar catalog, TXT frames, and GIFs.

The host app remains in [`apps/device-bridge`](../../../apps/device-bridge).
It owns hub sessions, transcription providers, pairing storage, LAN servers,
and browser UI. It consumes this SDK through `@cline/device` imports; dashboard
embedding continues to use `@cline/device-bridge`'s runtime and status exports.

## TypeScript API

```ts
import { parseDeviceMessage, PROTOCOL_VERSION } from "@cline/device";
import type { DeviceToBridge, BridgeToDevice } from "@cline/device";

const command: DeviceToBridge | undefined = parseDeviceMessage(rawText);
```

The root export is browser-compatible and has no Node or Bun dependencies.
`@cline/device/assets` is a separate Node entry point exporting `AVATAR_ROOT`
and `FIRMWARE_ROOT`, absolute paths to the resources distributed with this
package. `@cline/device/assets/manifest.json` exports the avatar catalog.

Cardputer ADV supports voice and typed prompts. Press **T** to open its scrolling
editor, **Enter** to send, **Backspace** to delete, and **Fn+Esc** to cancel.
**N**, then **T**, starts a new session; `cloud session <prompt>` runs in the cloud.
Drafts are capped at `MAX_PROMPT_LENGTH` (384) and clear only on acknowledgement.
The protocol exports `PromptTarget` and `PromptResult` for both input paths.

Build from the SDK workspace before using the package:

```bash
cd sdk
bun -F @cline/device build
bun -F @cline/device test
bun -F @cline/device typecheck
bun -F @cline/device validate:assets
```

## Firmware

From the repository root, use the interactive device menu:

```bash
# Activate your installed ESP-IDF environment first.
source ~/esp/esp-idf-v5.5.2/export.sh
bun run device
```

Select the board, then build, flash, open the monitor, configure firmware, or
export a Cardputer M5Launcher app. Flash and monitor actions detect USB serial
ports; you can refresh detection or enter a port manually. `q` cancels a menu.
`bun run device --list` prints supported boards without starting a build.

The script always runs ESP-IDF in the firmware project with the selected board's
build directory. Plain `idf.py flash` is blocked: select a board explicitly and use its matching
build directory. The menu sets both for you.
For Cardputer with M5Launcher, choose **Build M5Launcher app**, copy the generated
`.bin` to the SD card, and install it in Launcher. A direct firmware flash replaces
the launcher and its installed firmware.


Firmware is a standalone ESP-IDF 5.5.2+ project; TypeScript compilation is not
required for `idf.py` builds. From the repository root after activating ESP-IDF:

```bash
bun sdk/packages/device/firmware/tools/build.ts waveshare-s3-epaper-154 build
bun sdk/packages/device/firmware/tools/build.ts waveshare-s3-175c build
bun sdk/packages/device/firmware/tools/build.ts m5stack-cardputer-adv launcher
```

Add `-p /dev/cu.YOUR_PORT flash monitor` for direct flashing. The Cardputer
`launcher` action produces only the app image for M5Launcher installation.
Each board builds into `firmware/build/<board>` with its own configuration.

See [board profiles](firmware/devices/README.md) for hardware, launcher setup,
and adding boards. See [avatar catalog](assets/avatars/README.md) for selecting
versions and formats per target. Firmware builds compile the selected catalog
variant automatically; generated sprite arrays stay in the board build directory.

## Distribution

The package includes compiled TypeScript, avatar assets, firmware sources,
board profiles, and build tools. It excludes firmware build outputs, downloaded
ESP-IDF components, and host credentials. CLI packaging assembles the bridge's
browser UI with SDK avatars into its `device-web` directory; development servers
mount the avatars directly from this package. Assets have one source in the SDK.
