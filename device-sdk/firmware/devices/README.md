# Device profiles

Use ESP-IDF **5.5.2+** and source its `export.sh`. From the repository root:

```sh
bun device-sdk/firmware/tools/build.ts waveshare-s3-175c build flash monitor
bun device-sdk/firmware/tools/build.ts waveshare-s3-epaper-154 build flash monitor
bun device-sdk/firmware/tools/build.ts m5stack-cardputer-adv build flash monitor
```

Each command applies `sdkconfig.defaults` followed by the selected
`devices/sdkconfig.cline-*` overlay and writes its configuration, dependency
lock and binaries to `build/<board>/`. A build rejects a mismatched board ID.
For pin adjustments on the e-paper board, use the same command with `menuconfig`.
You can also call IDF directly from the firmware directory:

```sh
idf.py -B build/waveshare-s3-175c -D CLINE_BOARD=waveshare-s3-175c build flash monitor
```

| Profile | Hardware | Surface |
| --- | --- | --- |
| `waveshare-s3-epaper-154` | ESP32-S3, 4 MB flash, SSD1681 200×200, FT6336 touch, ES8311 mic | Monochrome with partial/full refresh |
| `m5stack-cardputer-adv` | ESP32-S3, 8 MB flash, ST7789V2 240×135 LCD, TCA8418 keyboard, ES8311 mic | LVGL color with compact landscape layout |
| `waveshare-s3-175c` | ESP32-S3, 32 MB flash, octal 8 MB PSRAM, CO5300 466×466 round AMOLED, CST9217 touch, ES7210 dual mic | LVGL color with round-safe layout |

The AMOLED board uses Waveshare's 3.0.0 BSP and Espressif's LVGL adapter 0.6.4.
Pins, codec setup and touch transforms come from the vendor BSP, with the same
mirror settings used by Muse. Both microphones are mixed into 16 kHz mono PCM.
BOOT holds to record a new session; the on-screen microphone follows up, or
starts a new session after tapping **+ New**. PWR retains its hardware power
behavior. The speaker codec is initialized for the shared I2S bus but never
opened for playback. AMOLED display sleep retains touch wake and the network;
chip deep sleep is currently supported only by e-paper. The 32 MB profile uses
an 8 MB application partition, leaving room for larger assets and renderers.

Hardware references:

- [Waveshare AMOLED BSP](https://components.espressif.com/components/waveshare/esp32_s3_touch_amoled_1_75c/versions/3.0.0)
- [Waveshare 1.75C documentation](https://www.waveshare.com/wiki/ESP32-S3-Touch-AMOLED-1.75C)
- [Waveshare e-paper examples](https://github.com/waveshareteam/ESP32-S3-ePaper-1.54)
- Local Muse reference: `muse-gadget-sdk/esp32/components/muse/boards/board_waveshare_s3_175c.c`

## Architecture

```text
main/app_main.c                 initialization and input polling
components/cline_model/         protocol events shared across components
components/cline_app/           state machine, semantic actions, voice streaming
components/cline_transport/     Wi-Fi setup, pairing, mDNS, WebSocket, JSON
components/cline_board/         selected board's display, touch, buttons, audio, power
components/cline_ui/            view contract, assets, e-paper and LVGL renderers
```

The hub device service owns authentication, local/cloud sessions, YOLO mode,
transcription and event projection. Firmware is a surface of that protocol.
Adding a board must not duplicate hub/session logic or the application.

`cline_board.h` exposes metadata and normalized mono capture. Native display
interfaces (`cline_board_epaper.h`, `cline_board_color.h`) are used only by the
matching renderer. Drivers keep panel/codec handles private. `cline_surface.h`
accepts a view snapshot and returns semantic hit-test actions. Application code
contains no layout coordinates, pins, LVGL types or e-paper refresh policy.
Physical controls emit shared semantic action events; new boards can add a
physical Stop or New control without inventing touch coordinates.

To add a board:

1. Add a board choice and `DEVICE_BOARD_ID` in `cline_board/Kconfig.projbuild`.
   Select the appropriate surface, independently of the board driver.
2. Add its checked-in `devices/sdkconfig.cline-<id>` overlay and hardware driver
   under `cline_board/`. Document vendor-derived pin and power requirements.
3. Select sources and dependencies in the board CMake file and conditional
   component manifest. Reuse an existing surface where possible.
4. For a new display class, implement the surface interface and select its
   sources in the UI CMake file. Keep refresh timing and touch geometry there.
5. Add the profile to `.github/workflows/device-firmware-test.yml`'s matrix.
   Validate display, touch, recording, disconnect/reconnect and sleep on hardware.

`bun test device-sdk/firmware/tests` exercises the actual shared C
application on the host, including persistent activity, counters, new/follow-up
routing, stopping, approvals, accidental taps and cancellation on disconnect.
It also checks variable audio chunk sizes against the duration limit,
recording cleanup, microphone failures and network loss.
The CI matrix compiles all three full firmware images. Compilation does not verify
physical wiring, microphone gain or display/touch behavior.

## M5Stack Cardputer ADV

This profile is for **K132-Adv**, not the original Cardputer or Cardputer v1.1.
The ADV uses a TCA8418 keyboard controller and an ES8311 codec; those earlier
models have different keyboard and microphone hardware.

The LCD uses the same 96×96 pixel avatar frames as e-paper, colored lavender on
a dark background. A compact landscape layout puts the avatar on the left and
activity text on the right, with contextual keyboard hints along the bottom.
The board has no touchscreen.

| Key | Action |
| --- | --- |
| Hold Space, release | Talk to the current session, or start one when idle |
| N, then hold Space | Start a new session |
| T (or Enter without a pending transcript) | Open the prompt editor |
| N, then T | Type a prompt for a new session |
| Enter in editor | Send the typed prompt |
| Backspace in editor | Delete the last character |
| Shift + key | Uppercase letters / symbols |
| Fn + Esc in editor | Cancel editing, keeping the draft |
| X | Stop the current task |
| Y / D | Approve / deny a pending request |
| Enter / Backspace | Send / cancel a pending voice transcript |

Wi-Fi provisioning and pairing use the existing setup access point and browser
setup page. Start the Cline hub/dashboard, click **Pair device**, and enter
its six-digit code in that page. Typed prompts are limited to 384 characters and
submit immediately. Prefix a prompt with `cloud session` to run it in the cloud.
The editor keeps drafts on errors and only clears them after bridge acknowledgement.
Other keyboard shortcuts are disabled while editing. Speaker playback is not
implemented. The microphone is streamed as 16 kHz mono PCM to the hub device service;
transcription and session execution stay on the laptop.

From the repository root, with ESP-IDF 5.5.2 activated:

```sh
bun device-sdk/firmware/tools/build.ts m5stack-cardputer-adv -p /dev/cu.YOUR_CARDPUTER_PORT flash monitor
```

If download mode is needed, switch the ADV off, hold G0 while powering it on,
then release G0. Flashing replaces its current application. Screen sleep turns
off the backlight while keeping the bridge connection alive; a mapped keyboard
key wakes the application. Chip deep sleep is disabled for this board.

Pin and behavior references:
- [M5Stack ADV documentation and schematic](https://docs.m5stack.com/en/core/Cardputer-Adv)
- [Vendor keyboard matrix mapping](https://github.com/m5stack/M5Cardputer/blob/master/src/utility/Keyboard/KeyboardReader/TCA8418.cpp)
- [Vendor display window and orientation](https://github.com/m5stack/M5GFX/blob/master/src/M5GFX.cpp)
- [Vendor ES8311 BCLK clock configuration](https://github.com/m5stack/M5Unified/blob/master/src/M5Unified.inl)

The image has been compiled with ESP-IDF 5.5.2 and its key mapping is covered by
host tests. Physical LCD orientation, audio level, USB flashing, pairing and
sleep/wake still require validation on an ADV unit.

## Waveshare round AMOLED 1.75C

Use `waveshare-s3-175c` for **ESP32-S3-Touch-AMOLED-1.75C**, with 32 MB flash
and 8 MB octal PSRAM. The non-C 1.75 board is a different hardware target.

The 466×466 round layout centers the pixel avatar between the status bubble and
state label. Counters and touch controls are inset from the circular edge; a
host test checks that their rectangles fit inside the circle and that the avatar
does not overlap text or buttons. It shares the avatar frames with e-paper and
Cardputer, using lavender on a dark background.

- Hold the on-screen **Hold to talk** control to follow up, or start when idle.
- Tap **+ New**, then hold to talk to start a separate session.
- Hold **BOOT** to record a new session directly.
- Touch **Stop**, **Approve/Deny**, or **Cancel/Send** when those controls appear.
- PWR retains the board's hardware power behavior.

The driver enables the AXP2101's 3.3 V core and audio rails before codec setup,
uses the vendor CO5300/CST9217 BSP, and combines the ES7210's two microphone
channels into 16 kHz mono for the hub device service. Pairing uses the same Wi-Fi
setup page and dashboard pairing code as the other devices.

With ESP-IDF activated, from the repository root:

```sh
bun device-sdk/firmware/tools/build.ts waveshare-s3-175c -p /dev/cu.YOUR_AMOLED_PORT flash monitor
```

Screen sleep sends SLPIN while keeping touch and networking active; chip deep
sleep is disabled. Firmware compilation and layout tests pass; display/touch
orientation, audio gain and sleep/wake still need testing on the physical board.

Power reference: [Waveshare AXP2101 setup](https://github.com/waveshareteam/ESP32-S3-Touch-AMOLED-1.75C/blob/main/examples/esp-idf/01_AXP2101/main/port_axp2101.cpp).

## Install Cardputer ADV through M5Launcher

Keep M5Launcher installed and build an **app-only** package instead of USB
flashing the standalone firmware:

```sh
# From the repository root, with ESP-IDF 5.5.2 activated:
bun device-sdk/firmware/tools/build.ts m5stack-cardputer-adv launcher
```

The output is
`build/m5stack-cardputer-adv/launcher/Cline-Device-Cardputer-ADV.bin`, alongside
installation notes and a SHA256 checksum. Packaging validates the board, chip
and app descriptor and copies the application unchanged. It includes no
bootloader, partition table, SPIFFS or FAT image.

1. Copy that `.bin` to the microSD card already used by M5Launcher.
2. On the Cardputer ADV, open **SD**, select the file and choose **Install**.
   Alternatively, upload it through Launcher's **WUI**.
3. Choose a free app slot large enough for the binary. The generated notes state
   its exact byte size. Keep the launcher's existing partition layout; no Cline
   filesystem/data partition is required. If your launcher offers to replace an
   installed app, choose a free slot to retain that app.
4. Launch Cline and pair via the usual Cline Device setup page and dashboard.
5. To switch apps, reset/power-cycle and press **Enter** at the Launcher startup
   screen, then select the other app. Cline does not change the boot selection.

Launcher installs the selected app into internal flash; apps do not run directly
from SD. Retaining several installed apps depends on your launcher version and
available app slots; SD binaries let you reinstall/switch without replacing the
launcher itself. Use an ADV-compatible M5Launcher build.

Do not use `idf.py flash` or `erase_flash` for this installation route: USB
flashing the standalone image includes its own partition table and replaces
the launcher layout. The package command never flashes a connected device.

Cline stores Wi-Fi and pairing data under NVS namespace `cline_device`, uses
RAM storage for the Wi-Fi driver's configuration, and never automatically
erases the shared NVS partition on initialization errors. If NVS needs repair,
it displays a storage error and leaves networking off so the launcher owner can
back up/repair data. Existing Cline installations using the former namespace
need Wi-Fi setup and pairing once after updating.

Packaging and startup tests pass, and the application image builds with
ESP-IDF 5.5.2. SD installation, booting and returning to the launcher still need
verification on your physical Cardputer ADV.

Reference: [M5Launcher app-image and SD install guide](https://github.com/bmorcelli/Launcher/wiki/Obtaining-binaries-to-launch).

## Device menu metadata

`boards.json` supplies names and launcher availability for the firmware menu.
Add an entry when adding an `sdkconfig.cline-<id>` profile; the menu validates that
the registry and profiles agree. Run `bun run device` at the repository root, or
`bun -F @cline/device firmware` from `sdk/`. Explicit board/action commands remain
available for automation. The menu only detects serial ports; select the port
belonging to the board you connected.

## Recover a Cardputer flashed with another board's firmware

A plain `idf.py flash` previously selected e-paper by default. There is now no
default board, and CMake requires a matching per-board build directory, so a
generic `build/` cannot be used to flash accidentally.

For a Cardputer that used M5Launcher, restore the official Cardputer-compatible
Launcher image first, then install the Cline app-only image from SD. If USB is
not reachable, put the ADV in download mode: switch it OFF, hold G0, connect USB
power, then release G0. Select the connected device's current serial port.

- [M5Stack download-mode instructions](https://docs.m5stack.com/en/core/Cardputer-Adv#download-mode)
- [Official Launcher recovery flasher](https://bmorcelli.github.io/Launcher/webflasher.html)

Do not USB-flash the Cline app-only launcher export at address zero; it contains
no bootloader or partition table. Use Launcher's SD installer after restoring it.

## Reconfigure Cardputer Wi-Fi

Hold **S** for eight seconds to reboot into the setup portal. This preserves the
stored configuration until you save the replacement and does not erase NVS or
other apps' settings. Rejoin the `ClineDevice-XXXX` network from your phone and
open `http://192.168.4.1`. Enter the exact 2.4 GHz Wi-Fi name, password, a fresh
dashboard pairing code, and optionally the laptop's LAN `host:port` bridge address.
Offline status now displays the connection stage or Wi-Fi failure instead of
always asking you to start the hub device service. Serial diagnostics record Wi-Fi
disconnect reasons without logging passwords or pairing tokens.
