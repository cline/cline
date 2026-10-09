# Cline Device

A Tamagotchi-style e-ink desk companion for the Cline hub. The device mirrors what
your agents are doing, lets you approve or deny tool calls with a tap, and lets
you speak prompts to Cline with push-to-talk.

```
 ESP32-S3 + 1.54" e-ink            your laptop
┌──────────────────────┐   LAN    ┌───────────────────────────┐      ┌────────────┐
│ @cline/device        │◄────────►│ @cline/device-bridge      │◄────►│ Cline hub  │
│ sprites, touch, mic  │  ws +    │ (hub client, STT, pairing,│  hub │ (sessions, │
└──────────────────────┘  mDNS    │  mDNS, device protocol)   │  ws  │ approvals) │
                                  └───────────────────────────┘      └────────────┘
```

The board is a thin client. It can't run Cline, an LLM or speech-to-text.

The bridge is an ordinary hub client, like the CLI connectors and the
`cline-hub` dashboard. It doesn't run a second runtime:

- It uses `NodeHubClient` to subscribe to hub events. It registers the
  `approval.respond` capability, so sessions stay interactive and approvals
  are routed to it while a device is connected.
- It uses `HubSessionClient` for approvals, abort, follow-up messages and new
  tasks.
- It transcribes speech the same way the desktop app's voice button does,
  using the provider and model you picked in **Settings → Voice input**.
  Settings only accepts streaming models, so the bridge opens a short-lived
  session with `createConfiguredStreamingTranscriptionSession()` and streams
  audio to it while you talk (`src/transcribe.ts`, which mirrors the webview's
  `streaming-transcription.ts`). The OpenAI realtime, Vercel AI Gateway and
  ElevenLabs transports are supported. If `providers.json` points at a
  batch-only model, the bridge falls back to `transcribeConfiguredVoiceInput()`
  after you release the button.

## Starting from the hub dashboard

From this checkout, run `bun run cli dashboard`, then click **Start bridge** in
Home's **Device bridge** panel. The bridge uses that dashboard's hub connection;
the panel shows its device WebSocket and browser device URLs and live connected
device names. **Stop bridge** releases its ports. Restarting the hub restarts a
dashboard-owned bridge against the new hub connection.

If you already started a bridge in another terminal, the panel reports it as
**Started separately**. It also warns if its hub URL differs from the dashboard's.
Stop that standalone bridge before starting one from the dashboard. Older running
bridges must be restarted to expose their endpoint and device status. Keep the
dashboard and bridge in the same checkout/build; separate builds can discover
different local hub instances. The CLI development command uses hub port
25466, while the standalone bridge defaults to 25463 unless
`CLINE_BUILD_ENV=development` is set. Dashboard startup passes its hub explicitly.

## Running the bridge

```bash
bun install
bun run build:sdk                     # the bridge imports @cline/core from dist/
bun run --cwd apps/device-bridge start -- --pair
```

| Flag | Default | Meaning |
|---|---|---|
| `--pair` | on when no devices are paired | Print a one-time 6-digit pairing code, valid for 5 minutes. |
| `--workspace <dir>` | your most recent Cline workspace | Pin the workspace used when a voice prompt starts a new task. |
| `--port <n>` | `25470` | Device WebSocket port. You can also set `CLINE_DEVICE_PORT`. |
| `--host <addr>` | `0.0.0.0` | Bind address. Use a specific LAN IP to narrow exposure. |
| `--no-mdns` | | Don't advertise `_clinedevice._tcp`. |
| `--web-port <n>` | `25471` | HTTPS port for the browser device. |
| `--no-web` | | Don't serve the browser device. |
| `--list-devices`, `--revoke <name>` | | Manage paired devices. |

The bridge starts the local hub if it isn't already running. New tasks use
your last-used provider and model. Paired devices are stored, with tokens
hashed, in `~/.cline/data/device-bridge/devices.json` with mode 0600.

## Device SDK

[`@cline/device`](../../sdk/packages/device/README.md) owns the reusable protocol,
ESP-IDF firmware, board profiles, and versioned avatar catalog. This app owns the
host process, hub session projection, transcription, pairing storage, HTTP/WebSocket
servers, and browser UI. Both the standalone bridge and dashboard use this same
host runtime. The SDK has no dependency on Cline's agent runtime or bridge app.

## Flashing the firmware

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


The firmware is an ESP-IDF **5.5.2+** project with independent board profiles.
After sourcing ESP-IDF's `export.sh`, run from the repository root:

```bash
bun sdk/packages/device/firmware/tools/build.ts waveshare-s3-175c build flash monitor
# Or the existing e-paper board:
bun sdk/packages/device/firmware/tools/build.ts waveshare-s3-epaper-154 build flash monitor
```

Profiles have separate configurations and build directories. The 1.75C uses
Waveshare's BSP for its round 466×466 AMOLED, touch and dual microphone; e-paper
retains its SSD1681/FT6336/ES8311 drivers. See the
[device profiles and extension guide](../../sdk/packages/device/firmware/devices/README.md) for hardware,
configuration, component boundaries and adding boards or renderers.

Both native surfaces show live counters and persistent activity above the
avatar. **+ New** returns home and arms the next utterance as a new session;
**Stop** stops the current session. BOOT records a new session, while the
on-screen mic follows up unless New was selected. Say **cloud session** at the
start of an utterance to route it to the cloud. All device-started sessions use
YOLO mode.

## Pairing

1. On first boot the device shows **SETUP** and opens the Wi-Fi network
   `ClineDevice-XXXX`.
2. Join it from your phone. The setup page should pop up; if it doesn't, open
   `http://192.168.4.1`.
3. On the laptop, run the bridge with `--pair` and note the 6-digit code.
4. Enter your Wi-Fi name and password and the pairing code. Optionally give a
   bridge `host:port`; if you leave it blank, the device discovers the bridge
   over mDNS.
5. The device reboots, finds the bridge via `_clinedevice._tcp`, and sends
   `pair{code}`. It stores the token it gets back and uses it from then on.

To pair again or change Wi-Fi, **hold anywhere on the screen for 8 seconds**.
That wipes the settings and returns to setup. A revoked token produces
`auth_error`, and the device shows "pairing needed".

## Using it

The screen has a plain **Cline** header with connection status on the right,
the avatar in the middle, and **Today Sessions: <count>** underneath. The footer says **How can I help?** with **Hold to talk** beneath it. Hold
the footer to speak; BOOT starts a new parallel task.

| Device | When | Touch |
|---|---|---|
| Working: bounces, shows the tool label | An agent turn or tool is running | Hold the device for 2 s to abort |
| Waiting: waves with a "!" | A tool needs approval | **APPROVE** / **DENY** |
| Listening: tall ears | You're holding the voice control | Release to send |
| Thinking: thought bubble | Transcribing, or the transcript is in its cancel window | **CANCEL** / **SEND** |
| Celebrate | A task completed; the last line of the reply is shown | |
| Dizzy | A run failed; the error label is shown | |
| Asleep: "Zzz" | Idle for `DEVICE_SLEEP_MIN` minutes; the display stops refreshing | Tap to wake |
| Ghost | The bridge or Wi-Fi is unreachable | |
| Idle | Nothing running | Tap the device for a stats card |

**Push-to-talk:** hold a button while you speak, then release. Which button
you hold decides where the prompt goes:

| Button | While a task is running | When nothing is running |
|---|---|---|
| On-screen **Hold to talk** footer | Follow-up to that task | New task |
| BOOT button | **New parallel task** | New task |

- The mic and I2S clocks only run while you hold it. There's no wake word.
- Presses shorter than 300 ms are discarded.
- Recording stops on its own at `DEVICE_MAX_RECORDING_S`.

## Browser device (phone or desktop)

The bridge also serves a browser version of the device from [`web/`](web), with
animated GIFs on an LCD screen instead of 1-bit sprites. It uses the same
device protocol as the board (pairing, approvals, push-to-talk and parallel
tasks) and pairs as its own device, so it can run next to the e-ink device.

1. Start the bridge. It prints the address:
   `browser device: https://<laptop-ip>:25471/`.
2. Open that address on your phone (same Wi-Fi as the laptop). The certificate
   is self-signed, so accept the browser warning once. Browsers only allow
   the microphone on HTTPS pages, which is why the device is served there.
3. Enter a pairing code from `start -- --pair`.

The screen adapts to the viewport and scrolls on small screens. Live session
counters appear at the top left, with a ⋯ menu at the top right. A speech bubble
above the device keeps the latest status, tool call, thinking trace, or assistant text
visible until another update replaces it. Disconnected screens show the bridge
startup command.

| Control | Action |
|---|---|
| Hold **Hold to talk** | Voice prompt: follow-up to the running task, or a new task if idle |
| **＋ New session**, then hold **Hold to talk** | The next voice prompt starts a new parallel session (tap the chip to cancel) |
| ⋯ → **Unpair** | Forget this device's token and return to pairing |
| **Approve** / **Deny** | Answer a tool approval |
| **Cancel** / **Send** | During the 3 s window after a transcript appears |
| Tap the device | Refresh the counters |
| **Stop** | Stop the current task |
| Hold Space (Shift+Space for a new session) | Push-to-talk on a desktop browser |

On the laptop itself, `http://localhost:25470/` also works with the mic,
because browsers treat localhost as secure.

**Avatars.** [`assets/avatars/manifest.json`](../../sdk/packages/device/assets/avatars/manifest.json) is the
shared catalog for browser and hardware avatars. It selects a versioned variant
for each device and lists ordered assets for every state. Pick another registered
avatar with `?avatar=<id>`. See [the catalog guide](../../sdk/packages/device/assets/avatars/README.md).

**Wrapping it as an app later.** `web/` is plain HTML, CSS and JS with no build
step or dependencies, so it can be loaded as-is into a Tauri mobile app or an
Android WebView. Point a wrapped copy at the bridge with
`index.html?bridge=wss://<laptop-ip>:25471`; the address is remembered.

Flags: `--web-port <n>` (default 25471) and `--no-web`. The certificate is
generated with `openssl` into `~/.cline/data/device-bridge/tls/`, and is
regenerated when the laptop's LAN address changes (accept the warning again).

## Device protocol (v1)

There's one WebSocket per device at `ws://<bridge>:25470/device`. Text frames
are JSON objects of at most 1 KB, with a `t` field giving the message type.
Binary frames carry audio. The source of truth is
[`@cline/device` protocol](../../sdk/packages/device/src/protocol.ts).

### Handshake

The device must send `hello` or `pair` within 10 seconds of connecting.

```jsonc
→ {"t":"hello","token":"<device token>","fw":"0.1.0"}
→ {"t":"pair","code":"123456","name":"desk-device"}     // first time only
← {"t":"paired","token":"…","name":"desk-device"}       // after pair; store it
← {"t":"welcome","v":1,"name":"desk-device"}
← {"t":"auth_error","reason":"bad_code|unknown_token|not_authenticated"}  // then close
```

### Bridge → device

`state` is the complete view. The bridge sends it only when it changes, so
every frame means something worth redrawing.

```jsonc
{"t":"state","state":"working","tool":"bun test","session":"s1","approval":null}
{"t":"state","state":"waiting","session":"s1","approval":{"id":"ap_1","summary":"Run: git push"}}
{"t":"state","state":"thinking","approval":null,"transcript":"run the tests and fix failures"}
{"t":"state","state":"done","session":"s1","approval":null,"reply":"All 21 tests pass."}
{"t":"state","state":"error","session":"s1","approval":null,"err":"exit code 1"}
{"t":"state","state":"idle|listening|offline","approval":null}
{"t":"stats","sessions":2,"today":7}
{"t":"voice","status":"transcribed","text":"…","target":"followup","session":"s1","cancel_ms":3000}
{"t":"voice","status":"submitted","target":"new","session":"s9"}
{"t":"voice","status":"cancelled|error","text":"too short"}
{"t":"error","reason":"…"}
```

- **States, in priority order:**
  1. `waiting`: any pending approval.
  2. `listening` or `thinking`: voice input is in progress.
  3. `working`: a run is active.
  4. `done` or `error`: shown for 8 seconds after a run ends.
  5. `idle`.

  `offline` means the hub is unreachable. The bridge never sends `sleeping`;
  the device decides when to sleep.
- **`tool`:** for shell tools this is the command; otherwise it's the tool
  name. It's capped at 24 characters.
- **`summary`:** capped at 60 characters, for example `Run: <command>` or
  `<tool>: <path>`. `reply` is the last line of the agent's reply, capped at
  80 characters.

### Device → bridge

```jsonc
{"t":"approve","id":"ap_1"}  {"t":"deny","id":"ap_1"}
{"t":"abort"}                // aborts the active session
{"t":"stats"}
{"t":"prompt","id":"1","text":"Run the tests","target":"auto"} // typed, immediate submission
{"t":"voice_start","rate":16000,"bits":16,"ch":1}               // follow up, or new task if idle
{"t":"voice_start","rate":16000,"bits":16,"ch":1,"target":"new"} // always a new parallel task
<binary audio frames>
{"t":"voice_end"}            // or {"t":"voice_cancel"} to discard
{"t":"voice_confirm"}        // submit now, skipping the rest of the cancel window
{"t":"voice_cancel"}         // also valid during the cancel window
```

Typed prompts require a nonempty request ID (up to 32 characters) and text (up to
384 characters). `target: "new"` starts a parallel session; `auto` follows up or
starts one if idle. A `cloud session` prefix uses cloud execution. The bridge
returns `{"t":"prompt","id":"1","status":"submitted","target":"new","session":"..."}`
or `status: "error"` with `reason`. The latest request ID is deduplicated within
each connection. Devices retain drafts on errors and never retry automatically.

### Audio framing

| | |
|---|---|
| Format | Signed 16-bit little-endian PCM, 16 kHz, mono. Other formats are rejected. |
| Binary frame | `u16 LE sequence number` followed by PCM samples. The firmware sends 1024 samples (2048 bytes, 64 ms) per frame. |
| Limits | Each frame is at most 8 KB. A recording is capped at 60 s (1.92 MB); extra audio is dropped. Recordings shorter than 300 ms are rejected as too short. |
| Ordering | Sequence numbers increase and wrap at 65536. The bridge logs gaps and keeps going. |
| Scope | Audio is accepted only between `voice_start` and `voice_end` from the device that started the recording. A new `voice_start` supersedes any recording in flight. |

On `voice_start`, the bridge opens a streaming transcription session. Audio
frames are resampled to the provider's rate (16 or 24 kHz) and forwarded as
they arrive; anything that arrives before the session is ready is buffered.

On `voice_end`, the bridge:
1. Closes the audio stream and waits up to 15 s for the final transcript.
2. Sends `voice/transcribed` with the target. The state stays `thinking` and
   shows the transcript.
3. Waits `cancel_ms` (3 s) for `voice_cancel`.
4. Submits.

### Target session

When the bridge sends `voice/transcribed`, it picks a target. If
`voice_start` carried `"target":"new"` (the BOOT button), it's always a new
task. Otherwise:
- **Follow-up (`target: "followup"`):** if any session is running, the
  transcript goes to the most recently active one through
  `session.send_input` with `delivery: "queue"`.
- **New task (`target: "new"`):** if nothing is running, the bridge starts a
  new session in the workspace you last used Cline in, taken from hub session events or session history at startup, or in `--workspace` if you pin one. It uses your last-used provider and model, and
  sends the transcript as its first prompt.

- **Cloud session (`target: "cloud"`):** start your recording with “cloud session”,
  followed by the task, for example “cloud session, fix the build”. This works
  from Android/the browser device and both e-ink and color devices. The bridge
  strips that prefix and starts a new cloud task even if a local task is running.
  The same transcript preview and cancel window apply. Sign into Cline before
  starting the hub; the bridge refreshes those saved credentials as needed.
  It uses the most recent local workspace (or `--workspace`), its GitHub remote
  and upstream branch, and your Cline model (or the recommended cloud model).
  Push the branch first: cloud clones the remote and does not upload local edits.
  Your GitHub repository must be connected to your Cline account. Cloud events,
  approvals, follow-ups, and Stop use the same device controls as local tasks.

The browser layout adapts to phones, tablets, desktop windows, and short landscape
screens. Small screens and enlarged text can scroll to reach controls; Android's
keyboard resizes the layout, and safe-area insets keep controls clear of cutouts.

All sessions started from a device run in YOLO mode with tool auto-approval enabled,
including local tasks and cloud sessions. Follow-ups preserve the session mode.

The bridge checks again at submit time. If the targeted session ended during
the cancel window, it starts a new task instead. `voice/submitted` always
reports the target and session that were actually used.

## Refresh and power policy (e-paper firmware)

- **No-change frames are skipped:** the framebuffer is compared with the last
  frame, and identical frames are never pushed to the panel.
- **Animation is choppy by design:**
  - Working runs at `DEVICE_WORK_FPS` (default 3) with partial refreshes.
  - Waiting and done run at 2 fps.
  - Idle blinks every few seconds.
  - Other moods are static.
- **Ghosting:** a full refresh runs every `DEVICE_FULL_REFRESH_EVERY` partials
  (default 30) and whenever the device wakes.
- **Sleep:** the device draws a final clean frame, puts the panel controller to
  sleep, and switches Wi-Fi to max modem sleep. It doesn't refresh until a
  touch or a non-idle state.
- **Deep sleep:** `DEVICE_DEEP_SLEEP_MIN > 0` puts the chip into deep sleep after
  that long asleep. The button or touch INT wakes it, and it reconnects.
- **Tasks:**
  - `ui` handles the display and state machine.
  - `input` polls touch and the button at 50 Hz.
  - `audio` runs only while you're recording.
  - `net` handles Wi-Fi, mDNS and the WebSocket.

  They communicate through one queue, so a slow network send never blocks
  touch handling.

The color surface uses LVGL with small internal DMA buffers, 5 fps working
animation, persistent activity, and a layout kept inside the round screen.
Display sleep preserves touch wake and the bridge connection.

## Swapping sprites

Edit [`assets/avatars/manifest.json`](../../sdk/packages/device/assets/avatars/manifest.json), the single mapping
of avatars, versions, formats, state frames, and device selections. Files live
beside it under each avatar's versioned variant folder.

- E-paper selects `mono-v1`: 96×96 TXT frames, `#` black and `.` white.
- Cardputer and round AMOLED currently select the same frames with color tinting.
- Browser selects `animated-v1`: the existing full-color GIF animations.

Firmware builds validate the catalog and generate `sprites.h` inside that board's
build directory automatically. There is no generated header to maintain in source.
TXT/PNG variants work with the current firmware renderers; animated GIF/WebP
variants require an image renderer and currently work in the browser only.
PNG compilation and WebP validation require Pillow in the build's Python environment.

```bash
python3 sdk/packages/device/firmware/tools/sprites.py --check
# Optional: regenerate stock monochrome expressions, then build normally.
python3 sdk/packages/device/firmware/tools/make_placeholders.py
```

See [the catalog guide](../../sdk/packages/device/assets/avatars/README.md) for adding a variant or selecting
one for a device. Animation cadence and screen layout remain renderer settings,
so e-paper refresh policy stays independent of GIF playback.

## Development

```bash
bun run --cwd apps/device-bridge test        # protocol, projection, pairing, mDNS, e2e bridge tests
bun run --cwd apps/device-bridge typecheck
```

`src/state.ts` (`DeviceStateProjector`) is the only place where hub events become
device states. If you add a state, update it, `sdk/packages/device/src/protocol.ts`, `sdk/packages/device/firmware/components/cline_model/include/app.h`
and the `parse_state` table in `sdk/packages/device/firmware/components/cline_transport/protocol.c` together.

### Security notes

- **LAN devices.** Local tasks use the local hub; cloud tasks use the Cline API and cloud hub. The bridge binds `0.0.0.0` so the
  board can reach it; use `--host` to narrow that.
- **Authentication.** Every connection must authenticate within 10 seconds.
  Pairing codes are 6 digits, single-use, expire after 5 minutes, and lock
  out after 5 failed attempts. Device tokens are 192-bit and stored as hashes.
- **No transport encryption.** Traffic is plain `ws://`, including audio and
  approval summaries. Run the bridge only on networks you trust.

Configuration uses `CLINE_DEVICE_HOST`, `CLINE_DEVICE_PORT`,
`CLINE_DEVICE_WEB_PORT`, and `CLINE_DEVICE_WORKSPACE`. Firmware configuration
symbols use `DEVICE_*`, setup Wi-Fi is named `ClineDevice-XXXX`, and bridge
discovery uses `_clinedevice._tcp`. Restart the bridge/dashboard and flash the
updated firmware together. Firmware stores Wi-Fi and pairing under the
`device` NVS namespace; enter setup and pair again after updating from an earlier
build. The browser also uses new `clineDevice.*` storage keys and requires
pairing again.

For a Cardputer ADV with M5Launcher already installed, use
`bun sdk/packages/device/firmware/tools/build.ts m5stack-cardputer-adv launcher`
instead of `flash`. Copy the resulting application-only `.bin` to SD and install
it through the launcher. See [launcher installation](../../sdk/packages/device/firmware/devices/README.md#install-cardputer-adv-through-m5launcher).
