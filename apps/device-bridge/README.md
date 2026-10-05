# Cline Pet

A Tamagotchi-style e-ink desk companion for the Cline hub. The pet mirrors what
your agents are doing, lets you approve or deny tool calls with a tap, and lets
you speak prompts to Cline with push-to-talk.

```
 ESP32-S3 + 1.54" e-ink            your laptop
┌──────────────────────┐   LAN    ┌───────────────────────────┐      ┌────────────┐
│ firmware/            │◄────────►│ @cline/device-bridge      │◄────►│ Cline hub  │
│ sprites, touch, mic  │  ws +    │ (hub client, STT, pairing,│  hub │ (sessions, │
└──────────────────────┘  mDNS    │  mDNS, device protocol)   │  ws  │ approvals) │
                                  └───────────────────────────┘      └────────────┘
```

The board is a thin client. It can't run Cline, an LLM or speech-to-text.

The bridge is an ordinary hub client, like the CLI connectors and the
`cline-hub` dashboard. It doesn't run a second runtime:

- It uses `NodeHubClient` to subscribe to hub events. It registers the
  `approval.respond` capability, so sessions stay interactive and approvals
  are routed to it while a pet is connected.
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
| `--port <n>` | `25470` | Device WebSocket port. You can also set `CLINE_PET_PORT`. |
| `--host <addr>` | `0.0.0.0` | Bind address. Use a specific LAN IP to narrow exposure. |
| `--no-mdns` | | Don't advertise `_clinepet._tcp`. |
| `--web-port <n>` | `25471` | HTTPS port for the browser pet. |
| `--no-web` | | Don't serve the browser pet. |
| `--list-devices`, `--revoke <name>` | | Manage paired devices. |

The bridge starts the local hub if it isn't already running. New tasks use
your last-used provider and model. Paired devices are stored, with tokens
hashed, in `~/.cline/data/device-bridge/devices.json` with mode 0600.

## Flashing the firmware

The firmware is an ESP-IDF 5.3+ project in [`firmware/`](firmware).

```bash
cd apps/device-bridge/firmware
idf.py set-target esp32s3
idf.py menuconfig        # Cline Pet → check every pin against your board
idf.py build flash monitor
```

The defaults in `main/Kconfig.projbuild` match the **Waveshare
ESP32-S3-(Touch-)ePaper-1.54**, V1 and V2. They're taken from
[waveshareteam/ESP32-S3-ePaper-1.54](https://github.com/waveshareteam/ESP32-S3-ePaper-1.54):

- **E-paper:** SSD1681 on SPI (MOSI 13, SCLK 12, CS 11, DC 10, RST 9, BUSY 8),
  powered by GPIO6, active low.
- **Touch:** FT6336 at `0x38` on I2C (SDA 47, SCL 48), with RST 7 and INT 21.
- **Mic:** the ES8311 codec, through `esp_codec_dev`. I2S uses MCLK 14, BCLK 15,
  WS 38 and DIN 16. Codec power is GPIO42, active low, and the rail is only on
  while recording. The speaker amp (GPIO46) is held off.
- **Battery latch:** GPIO17 is driven high at boot, so the board stays on when
  it's unplugged.
- **Push-to-talk:** the BOOT button (GPIO0) starts a new parallel task; the
  on-screen mic follows up on the running task.

For other boards, change the pins and the mic type in `idf.py menuconfig` under
**Cline Pet**.

## Pairing

1. On first boot the pet shows **SETUP** and opens the Wi-Fi network
   `ClinePet-XXXX`.
2. Join it from your phone. The setup page should pop up; if it doesn't, open
   `http://192.168.4.1`.
3. On the laptop, run the bridge with `--pair` and note the 6-digit code.
4. Enter your Wi-Fi name and password and the pairing code. Optionally give a
   bridge `host:port`; if you leave it blank, the pet discovers the bridge
   over mDNS.
5. The pet reboots, finds the bridge via `_clinepet._tcp`, and sends
   `pair{code}`. It stores the token it gets back and uses it from then on.

To pair again or change Wi-Fi, **hold anywhere on the screen for 8 seconds**.
That wipes the settings and returns to setup. A revoked token produces
`auth_error`, and the pet shows "pairing needed".

## Using it

| Pet | When | Touch |
|---|---|---|
| Working: bounces, shows the tool label | An agent turn or tool is running | Hold the pet for 2 s to abort |
| Waiting: waves with a "!" | A tool needs approval | **APPROVE** / **DENY** |
| Listening: tall ears | You're holding the mic button | Release to send |
| Thinking: thought bubble | Transcribing, or the transcript is in its cancel window | **CANCEL** / **SEND** |
| Celebrate | A task completed; the last line of the reply is shown | |
| Dizzy | A run failed; the error label is shown | |
| Asleep: "Zzz" | Idle for `PET_SLEEP_MIN` minutes; the display stops refreshing | Tap to wake |
| Ghost | The bridge or Wi-Fi is unreachable | |
| Idle | Nothing running | Tap the pet for a stats card |

**Push-to-talk:** hold a button while you speak, then release. Which button
you hold decides where the prompt goes:

| Button | While a task is running | When nothing is running |
|---|---|---|
| On-screen mic (bottom-right) | Follow-up to that task | New task |
| BOOT button | **New parallel task** | New task |

- The mic and I2S clocks only run while you hold it. There's no wake word.
- Presses shorter than 300 ms are discarded.
- Recording stops on its own at `PET_MAX_RECORDING_S`.

## Browser pet (phone or desktop)

The bridge also serves a browser version of the pet from [`web/`](web), with
animated GIFs on an LCD screen instead of 1-bit sprites. It uses the same
device protocol as the board (pairing, approvals, push-to-talk and parallel
tasks) and pairs as its own device, so it can run next to the e-ink pet.

1. Start the bridge. It prints the address:
   `browser pet: https://<laptop-ip>:25471/`.
2. Open that address on your phone (same Wi-Fi as the laptop). The certificate
   is self-signed, so accept the browser warning once. Browsers only allow
   the microphone on HTTPS pages, which is why the pet is served there.
3. Enter a pairing code from `start -- --pair`.

The screen is one fixed, non-scrolling view: session counters at the top
left, a ⋯ menu at the top right, the pet in the middle, and the controls
directly under it.

| Control | Action |
|---|---|
| Hold **Hold to talk** | Voice prompt: follow-up to the running task, or a new task if idle |
| ⋯ → **New session**, then hold **Hold to talk** | The next voice prompt starts a new parallel session (tap the chip to cancel) |
| ⋯ → **Unpair** | Forget this device's token and return to pairing |
| **Approve** / **Deny** | Answer a tool approval |
| **Cancel** / **Send** | During the 3 s window after a transcript appears |
| Tap the pet | Refresh the counters |
| Hold the pet 1.5 s while it's working | Stop the task |
| Hold Space (Shift+Space for a new session) | Push-to-talk on a desktop browser |

On the laptop itself, `http://localhost:25470/` also works with the mic,
because browsers treat localhost as secure.

**Pets.** Each folder in `web/pets/` is a character: GIFs plus a `pet.json`
mapping states to files. A state can list several GIFs to rotate through, as
`working` does. Pick another pet with `?pet=<folder>`.

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
[`src/protocol.ts`](src/protocol.ts).

### Handshake

The device must send `hello` or `pair` within 10 seconds of connecting.

```jsonc
→ {"t":"hello","token":"<device token>","fw":"0.1.0"}
→ {"t":"pair","code":"123456","name":"desk-pet"}     // first time only
← {"t":"paired","token":"…","name":"desk-pet"}       // after pair; store it
← {"t":"welcome","v":1,"name":"desk-pet"}
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
{"t":"voice_start","rate":16000,"bits":16,"ch":1}               // follow up, or new task if idle
{"t":"voice_start","rate":16000,"bits":16,"ch":1,"target":"new"} // always a new parallel task
<binary audio frames>
{"t":"voice_end"}            // or {"t":"voice_cancel"} to discard
{"t":"voice_confirm"}        // submit now, skipping the rest of the cancel window
{"t":"voice_cancel"}         // also valid during the cancel window
```

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

The bridge checks again at submit time. If the targeted session ended during
the cancel window, it starts a new task instead. `voice/submitted` always
reports the target and session that were actually used.

## Refresh and power policy (firmware)

- **No-change frames are skipped:** the framebuffer is compared with the last
  frame, and identical frames are never pushed to the panel.
- **Animation is choppy by design:**
  - Working runs at `PET_WORK_FPS` (default 3) with partial refreshes.
  - Waiting and celebrate run at 2 fps.
  - Idle blinks every few seconds.
  - Other moods are static.
- **Ghosting:** a full refresh runs every `PET_FULL_REFRESH_EVERY` partials
  (default 30) and whenever the pet wakes.
- **Sleep:** the pet draws a final clean frame, puts the panel controller to
  sleep, and switches Wi-Fi to max modem sleep. It doesn't refresh until a
  touch or a non-idle state.
- **Deep sleep:** `PET_DEEP_SLEEP_MIN > 0` puts the chip into deep sleep after
  that long asleep. The button or touch INT wakes it, and it reconnects.
- **Tasks:**
  - `ui` handles the display and state machine.
  - `input` polls touch and the button at 50 Hz.
  - `audio` runs only while you're recording.
  - `net` handles Wi-Fi, mDNS and the WebSocket.

  They communicate through one queue, so a slow network send never blocks
  touch handling.

## Swapping sprites

Sprites are 1-bit images in `firmware/sprites/`, named `<mood>_<frame>.txt` or
`<mood>_<frame>.png`.

- **Moods:** `idle`, `working`, `waiting`, `listening`, `thinking`,
  `celebrate`, `error`, `sleeping`, `offline`.
- **Frames:** numbered from 0. Any mood without frames falls back to `idle`.
- **`.txt`:** ASCII art where `#` is black and `.` is white. The placeholders
  are 32×32.
- **`.png`:** any size; dark pixels become black. Needs Pillow.
- **Size:** 32×32 sprites are drawn at 3× (96 px). If you change the size,
  change `SPRITE_SCALE` in `main/ui.c` to match.

```bash
cd apps/device-bridge/firmware
python3 tools/sprites.py          # regenerates main/sprites.h
python3 tools/make_placeholders.py   # optional: regenerate the stock pet
```

Keep the frame count small, since every frame is a partial refresh. The stock
set is 14 frames of 128 bytes each.

## Development

```bash
bun run --cwd apps/device-bridge test        # protocol, projection, pairing, mDNS, e2e bridge tests
bun run --cwd apps/device-bridge typecheck
```

`src/state.ts` (`PetStateProjector`) is the only place where hub events become
pet states. If you add a state, update it, `protocol.ts`, `firmware/main/app.h`
and the `parse_state` table in `firmware/main/protocol.c` together.

### Security notes

- **LAN only.** The bridge has no cloud dependency. It binds `0.0.0.0` so the
  board can reach it; use `--host` to narrow that.
- **Authentication.** Every connection must authenticate within 10 seconds.
  Pairing codes are 6 digits, single-use, expire after 5 minutes, and lock
  out after 5 failed attempts. Device tokens are 192-bit and stored as hashes.
- **No transport encryption.** Traffic is plain `ws://`, including audio and
  approval summaries. Run the bridge only on networks you trust.
