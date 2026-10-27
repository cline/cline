# Isolated native fixture build

This tooling is opt-in and is never imported by application code. It runs the
actual Cloud REST client, bearer-authenticated WebSocket client, real Hub command
transport/event projection, shipping route guards, and shipping native UI. Only
REST/identity responses and the agent runtime are deterministic fixtures. No real
GitHub repository is created, modified, or deleted. All tool output is synthetic;
no tool executes shell commands or changes files.

The default Metro config, app config, production endpoints, auth checks, local
Computer feature gate, and production bundle ID remain unchanged. The dedicated
Metro override only redirects the normal environment module when explicitly
selected for a fixture bundle. The fixture service binds to loopback and accepts
only its own test credential. The identity provider follows the normal device
flow through a local browser verification page; no real account is needed.

## Reproduce

Use the repository's documented Bun version and rebuild SDK dependencies first.
Commands below run from `apps/mobile` unless stated otherwise.

1. Create a scratch state directory and start the server:
   `FIXTURE_STATE_DIR=/absolute/scratch/state bun e2e/native-fixture/server.ts`.
   The default endpoint is `http://127.0.0.1:4783`. State/control keys and observed
   events are written only to that scratch directory. Set `FIXTURE_PORT` to choose
   another port.
2. Generate a tiny valid H.264 video locally:
   `xcrun swift e2e/native-fixture/generate-video.swift /absolute/scratch/state/fixture-video.mp4`.
3. Optional transport check: `bun e2e/native-fixture/self-test.ts`. This validates
   thirteen protocol checks through the real WebSocket proxy/Hub. It is a harness
   check and does not replace native UI testing. Its temporary history row is deleted through the fixture REST API after the
   check. Create a new UI conversation for UI tests. The fixture runtime and REST catalog
   use the same model ID and expose thinking capability plus persisted High/Off
   metadata, so native reasoning controls exercise ordinary model-selection behavior.
4. Build the ordinary iOS Simulator Release product, then run
   `e2e/native-fixture/build-ios.sh /absolute/path/Release-iphonesimulator/Cline.app /absolute/fresh/output`.
   The script copies the native product, creates a new bundle through an explicit
   `EXPO_OVERRIDE_METRO_CONFIG`, uses staging's existing opt-in ephemeral auth,
   updates **only the copy** to `bot.cline.app.e2e` / `Cline E2E`, and ad-hoc signs
   that simulator copy. It never modifies the original app or native project.
5. Install that copied `ClineE2E.app` on a disposable iOS simulator. Use the normal
   Get started / Sign in flow; the browser opens the local verification page.
   Return to Cline E2E, choose the fixture repository/model, and create a new
   conversation. The fixture account is `simulator@example.invalid`.

The fixture bundle is a simulator test artifact. This packaging script is not a
TestFlight/device distribution build. The native shell must include the same
modules as the source bundle being tested.

## Deterministic interactions

Send these as actual messages in the normal Cloud chat:

| Prompt | Shipping surface reached |
| --- | --- |
| `ask-question` | Structured question sheet; options and custom answer |
| `approval-fixture` | Real pending approval; Approve or Deny with optional reason |
| `edit-fixture` | Two-file synthetic `apply_patch` tool and full diff overlay |
| `sample-image` | Inline generated PNG and fullscreen image viewer |
| `sample-audio` | Inline WAV; Load audio / Play / Pause / Close |
| `sample-video` | Valid inline H.264 MP4; native video controls / Close |
| `sample-file` | Generated text file; Save or share file opens the native sheet |
| `hold-fixture` | Running turn held until control release; queue/edit/remove/steer/Stop |
| `fixture-error` | Deterministic real run failure event and shipping error UI |
| `ux-fixture` | Reopen after completion: 30 wrapped prompt/answer pairs, known internal system/status/recovery history, legacy continuation, visible user XML and assistant markup for privacy/copy/navigation acceptance |
| Any other text | Deterministic streamed text/reasoning/usage and history |

`flows/*.yaml` are prepared Maestro interaction flows with an already connected
fixture chat as their precondition. They are not marked passed until run on the
native fixture app. Specify the disposable simulator explicitly when invoking
Maestro; do not clear or replace a developer's logged-in staging app.

## Controlled failures and queue release

`FIXTURE_CONFIG_PATH=/absolute/scratch/state/config.json bun e2e/native-fixture/control.ts ACTION [0|1]`

- `archive`: marks the newest fixture workspace stopped so normal archived history opens; `resume` restores running status.
- `release`: releases the current `hold-fixture` gate.
- `history-error 1`: session history REST returns 503; `history-error 0` restores it.
- `hydrate-error 1`: the proxy returns a deterministic `session.messages` failure;
  reopen/resync the chat to exercise initial history failure. `0` restores reads.
- `abort-error 1`: the proxy returns a deterministic `run.abort` failure so Stop
  failure feedback can be verified. `0` restores Stop.
- `events`: prints observed protocol events, not credentials.

The control secret is read from the private scratch config rather than included
in the app bundle. Fixture errors are injected only at the isolated test proxy.

## Practical limits

The runtime intentionally executes no real model or workspace tool. Therefore
these fixtures establish native UI/protocol behavior, not real model reliability,
real GitHub auth/security boundaries, or command execution correctness.

The fixture runtime stores generated media in its in-memory transcript as well
as emitting the live Hub event, so media can be checked after rehydrate/reopen.
Text, tool, and question-answer history use the shared host's normal transcript.
Stopped workspaces expose the same messages through the archive REST contract;
disposable session deletion removes the fixture row and runtime session. Server
restart resets session state; completed fixture browser authorization is retained
in the scratch state directory.

The audio and video fixtures are five seconds long; native controls and successful decoding can be exercised, but audible output cannot be
proven by screenshots. Camera hardware capture, real microphone quality, remote
push while the process is killed, native share recipient behavior, and real
network/security boundaries require separate device/service coverage. Notification
permission prompts and local notification routing can be exercised in the fixture
app through the normal UI and running-session events.

## Isolated Android variant

Set `JAVA_HOME` to JDK 17 and `ANDROID_HOME` to the Android SDK. From the repository
root, run `apps/mobile/e2e/native-fixture/build-android.sh /absolute/scratch/android-fixture`.
The script explicitly applies `android-fixture.init.gradle`, sets only this
invocation's app ID to `bot.cline.app.e2e`, sends app build outputs to the scratch
directory, and creates `cline-native-fixture.apk` there. The generated native
project's default Gradle configuration remains unchanged. A fixture-only manifest
adds the Cline E2E label and a network-security policy permitting cleartext solely
for `127.0.0.1` and `localhost`; all other cleartext remains forbidden.

After coordinating with whoever owns the emulator, install that APK without
uninstalling the original staging package. Use explicit device targeting:

```sh
adb -s emulator-5554 reverse tcp:4783 tcp:4783
adb -s emulator-5554 install /absolute/scratch/android-fixture/cline-native-fixture.apk
adb -s emulator-5554 shell am start -n bot.cline.app.e2e/bot.cline.app.MainActivity
```

`adb reverse` lets both the fixture app and its normal device-flow browser use the
same loopback server as iOS. Sign in normally and create an independent fixture
workspace. Both variants use the same test identity/account; history therefore
shows the fixture workspaces created on either device. The original package and
its account data are separate and remain installed. Do not run two `hold-fixture`
turns concurrently: the shared scripted-runtime gate is named `native-queue`.
After testing Stop during a held fixture turn, release that gate through the
control tool to drain the scripted turn before sending the next message.
