# Isolated native fixture build

This tooling is opt-in and is never imported by application code. It runs the
actual Cloud REST client, bearer-authenticated WebSocket client, real Hub command
transport/event projection, shipping route guards, and shipping native UI. Only
REST/identity responses and the agent runtime are deterministic fixtures. No real
GitHub repository is created, modified, or deleted. All tool output is synthetic;
no tool executes shell commands or changes files.

The default Metro config, app config, production endpoints, auth checks, local
Computer feature gate, and production bundle ID remain unchanged. The dedicated
Metro override redirects the normal environment module and namespaces SecureStore
only when explicitly selected for a fixture bundle. The fixture service binds to loopback and accepts
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
   fifteen protocol checks through the real WebSocket proxy/Hub. It is a harness
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

Check SecureStore access after replacing the native shell: the tested unsigned
SDK27.1 shell compiled successfully but rejected Keychain access with a missing
entitlement. For JavaScript-only changes with unchanged native dependencies, the
validated fallback is the previously working native shell plus the exact latest
JS/assets, followed by a persisted-auth/profile/balance cold-launch smoke. Record
that native-base provenance separately from a fresh native build. Device builds
still need the owning Apple team's signing configuration.

## Simulator storage isolation

Different bundle IDs alone do not isolate Keychain entries in unsigned simulator
apps: Expo SecureStore defaults to the service `app`, and these builds may share
its key names. The guarded fixture Metro resolver therefore wraps every public
key-bearing SecureStore API (sync get/set and async get/set/delete), prefixing both
the key and the requested/default keychain service with `cline.native-fixture.v1.`.
Constants, types and capability probes still use Expo unchanged. The wrapper's
own Expo import bypasses the redirect. Ordinary Metro never imports this wrapper.

Fixture credentials remain staging's opt-in in-memory auth. Namespacing also
protects credentials if another test storage caller uses SecureStore directly.
The fixture never migrates, reads, deletes or clears unprefixed entries. A newly
isolated fixture starts with fresh local targets/settings: sign in and choose the
fixture repository through the normal UI. Existing server rows are unaffected.
Stop using older fixture bundles before restoring normal app preferences; they
lack this isolation. Do not reset a normal app or clear its Keychain to prepare a
fixture. Prefer a disposable simulator for fixture work in all cases.

For authenticated cold-start/notification-tap acceptance, set
`CLINE_NATIVE_FIXTURE_EPHEMERAL_AUTH=0` when running either fixture build script.
This exercises the shipping credential persistence through the same isolated
SecureStore namespace using only the synthetic fixture identity. Sign in through
the fixture browser once before cold relaunching. The default remains ephemeral
(`1`); do not count a signed-out ephemeral cold launch as authenticated acceptance.

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
restart resets session state unless an explicit snapshot/restore is used (below);
completed fixture browser authorization is retained in the scratch state directory.

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
its account data are separate and remain installed. Held turns use per-session gates; release with the exact
`FIXTURE_WORKSPACE_ID` when testing two workspaces concurrently. After testing
Stop during a held turn, release that task gate through the control tool to drain
the scripted turn before sending the next message.

## Scoped fault and content controls

The opt-in proxy can now expose additional user-facing recovery states without
changing shipping UI or real services. Set `FIXTURE_CONFIG_PATH` to its private
scratch config as above. Set `FIXTURE_WORKSPACE_ID=fixture-workspace-00000042` for
one task's faults. Omit it only when intentionally testing global setup/create/list
behavior. Scope by the **outer** workspace ID, never the inner task ID. `state`
prints fixture IDs/titles and enabled faults; it does not print credentials.

```sh
FIXTURE_CONFIG_PATH=/absolute/scratch/state/config.json bun e2e/native-fixture/control.ts state
FIXTURE_CONFIG_PATH=/absolute/scratch/state/config.json FIXTURE_WORKSPACE_ID=fixture-workspace-00000042 bun e2e/native-fixture/control.ts set approval-error 1
FIXTURE_CONFIG_PATH=/absolute/scratch/state/config.json FIXTURE_WORKSPACE_ID=fixture-workspace-00000042 bun e2e/native-fixture/control.ts clear
```

`set FAULT VALUE` enables a fault (`1`), disables it (`0`), or sets a delay in
milliseconds. Values are bounded to 0–60000. `clear` clears only the selected
scope, and `state` shows all scopes. Per-task zero overrides a global fault.
Global setup faults affect both simulators: coordinate them before changing.

| Control | User-facing state and recovery |
| --- | --- |
| `create-delay-ms` | Delay before create acceptance; exercise double tap/Back/draft retention |
| `create-pending-ms` | Accept once, report provisioning until elapsed, then running on normal status poll |
| `create-error` | Return 503 before acceptance; no workspace created |
| `create-ambiguous` | Create exactly once, then return 503 without a usable acknowledgement; Check sessions must recover that existing row |
| `list-error`, `list-empty` | Session list 503 or successful empty list; clear and refresh |
| `repositories-error`, `repositories-empty`, `repositories-delay-ms` | Repository 403/reconnect, empty results or loading; clear and Retry/refresh |
| `branches-error`, `branches-empty`, `branches-delay-ms` | Branch loading/retry/empty; available safe branches are main and fixture-safe-branch |
| `models-error` | Model REST catalog 503; clear then Retry |
| `balance-error` | Existing account-balance endpoint 503; Settings Retry recovers the synthetic $12.34 balance |
| `history-error`, `details-error`, `status-error` | Selected task archive/detail/status request 503; clear and Retry |
| `rename-error`, `delete-error`, `suspend-error`, `resume-error` | Selected task action rejected before mutation; cancel/clear/retry then confirm exact task |
| `hydrate-error`, `abort-error`, `send-error` | Selected task protocol read/Abort/send rejected before dispatch; retained transcript/draft/Retry |
| `approval-error`, `question-error` | Reject real response command; prompt remains pending for clear+Retry |
| `reasoning-error`, `catalog-error` | Model/effort update or Hub model catalog rejected; clear then retry |
| `queue-error` | Reject pending-prompt edit/remove/steer commands; clear then retry |
| `drop-replies` | Keep WebSocket open but discard replies/events for selected task; clear then reconnect/resync |

A held turn now uses one gate per inner session, so two independent workspaces
can run `hold-fixture` concurrently. Scope `release` with `FIXTURE_WORKSPACE_ID`
to release exactly one. Unscoped release releases all fixture rows. After Abort,
release that task's gate before reusing it.

Send `rich-fixture` for deterministic headings, lists, quote, table, code, long
synthetic tool output and failed tool cards. It includes safe `https://example.com`
and a blocked JavaScript-scheme Markdown link; the latter must not launch a
browser. Send `invalid-media` for structurally valid image/audio/video blocks
containing intentionally undecodable bytes. Exercise error/close/retry without
assuming successful playback. The normal Sonnet fixture model supports thinking;
`Fixture Fast (no thinking)` is the alternate unsupported model.

Run `FIXTURE_CONFIG_PATH=... bun e2e/native-fixture/fault-self-test.ts` only when
setup/list faults will not interfere with another tester. It creates and deletes
its own disposable fixture rows; it validates proxy contracts rather than native
UI. The ordinary `self-test.ts` includes rich/invalid content and now performs
fifteen checks.

Before a coordinated server upgrade, wait for both testers to finish active
turns, run `FIXTURE_CONFIG_PATH=... bun e2e/native-fixture/snapshot.ts`, and start
the new server with `FIXTURE_RESTORE_PATH=/absolute/scratch/state/restore.json`.
This preserves outer IDs and completed visible/internal/media history. It does
not restore pending approvals, queued work, active tool/gate state, creator-bound
question capabilities or model/effort session overrides. Use a fresh workspace
for those flows after restarting. Authorization remains in the scratch directory.
No restart is needed to change any control on the upgraded server.

### Queue fidelity and sign-in recovery

The upgraded fixture reuses the production `PendingPromptsController` from
`runtime/turn-queue/pending-prompt-service.ts` rather than inventing Hub queue
frames. Busy sessions admit follow-ups into that controller; unchanged Hub
handlers/projectors expose list/edit/remove/steer and submitted events. A released
held turn drains edited prompts exactly once. Abort settles that task's held gate;
queued prompts follow production controller draining rules. The scripted runtime
acts as the agent boundary: a steer is consumed during the held turn, appears as
one canonical user message and emits `STEER_FIXTURE_RECEIVED`. This establishes
client/protocol queue behavior, not real-model adherence to steering instructions.

For sign-in tests, coordinate these **global** faults while the fixture app is
signed out. They change only ordinary WorkOS-shaped device-flow responses:

- `auth-pending`: keep polling as authorization_pending even after browser return;
  clear to let the same pending sign-in finish normally.
- `auth-expired`: return expired_token; assert expired-code error, clear, Retry.
- `auth-error`: return503/server_error during token polling; assert error, clear,
  Retry.
- `auth-authorize-error`: reject initial device authorization with503; clear and
  Retry. Normal browser/device-flow steps remain necessary.

Submitted `userImages`/`userFiles` are retained by the test runtime using the
production persisted text/image/file block schema, including MIME-aware decoding
of data URLs. The ordinary ScriptedRuntimeHost does not persist those inputs on
its own. Reopen/cold hydrate therefore tests the shipping client against real
canonical attachment blocks. When recovering an older fixture photo that was
already absent from history, `FIXTURE_ATTACHMENT_EVENTS_PATH=/absolute/previous/events.json`
lets the read-only snapshot tool recover that exact submitted input; it never
creates an image that was not submitted.

After a server restart, **cold relaunch fixture apps or create a fresh
workspace/controller** before live assertions. The in-memory Hub's event counters
restart, while a still-open app connection can retain an older cursor. Snapshot
restore preserves transcript/outer IDs, not the old event-log cursor namespace.

### REST Gateway contract audit

`FIXTURE_CONFIG_PATH=... bun e2e/native-fixture/gateway-self-test.ts` drives the
shipping `CloudSessionGateway` through fixture HTTP for create/list/get/status,
Personal/organization isolation, suspend/resume, rename, history and deletion.
Lifecycle POSTs return the full selected SessionDTO (including `id`) and suspend
confirms `status: suspended`; GET status retains `{sessionId, status}`. Personal
lists exclude organization rows, and an organization query returns only that exact
scope. `src/cloud/rest/native-fixture-contract.test.ts` additionally runs shipping
parsers against the same response builders used by the server, so successful HTTP
status alone cannot conceal an invalid client-facing DTO.

### Operational fallback for a blocked runtime ancestor

If Bun stalls before JavaScript starts while enumerating an ancestor directory,
keep the existing service running until a replacement has passed its checks.
This is separate from an app or fixture failure. Do not change filesystem modes,
macOS privacy controls or shipping configuration to work around it.

An owned temporary runtime copy can contain the exact existing package manifest,
`sdk/packages`, `sdk/tsconfig.json`, root `node_modules`, and these mobile paths:
`package.json`, `tsconfig.json`, `node_modules`, `src`, `e2e`, `scripts`, `assets`.
Use APFS copy-on-write clones when available, preserve relative workspace links,
and exclude Git metadata, environment files and native build directories. A
symlink back to the blocked source ancestor does not isolate module resolution.
Do not install or update dependencies. Compare source hashes with the copy, then
run the server on a separate loopback port and execute all three checks from the
copy: `self-test.ts`, `fault-self-test.ts`, and `gateway-self-test.ts`.

After both native testers reach a safe checkpoint, snapshot every fixture scope
with `snapshot.ts`, preserve observed events, and launch that same validated copy
with the original `FIXTURE_STATE_DIR` and its `FIXTURE_RESTORE_PATH`. The normal
private config/event paths can remain unchanged. Cold relaunch fixture apps after
replacement to reset the old in-memory Hub event cursor. Keep the runtime copy
until the service is stopped; it is disposable test infrastructure.

For fixture bundling when only Bun's command runner is affected, the existing
Expo CLI can run through an explicit available Node binary:
`"$NODE_BINARY" node_modules/expo/bin/cli export:embed ...`. Preserve the exact
arguments and opt-in fixture environment assignments from `build-ios.sh` (or the
Android fixture build), including its Metro override. This is an invocation
fallback and must not alter the shipping Metro config, endpoints or bundle ID.

The legacy unscoped `control.ts history-error 1` affects session-list reads. For
an archived transcript error, use `set history-error 1` with the exact
`FIXTURE_WORKSPACE_ID`; clear that same scope before retrying.


## Scoped management/authentication controls

For one disposable outer workspace only, set `mutation-delay-ms` to a bounded
0–60000 milliseconds through `/control/set?id=OWNED_OUTER_ID&fault=mutation-delay-ms&value=12000`
with the fixture control key. Global scope is rejected. The delay applies only to
PATCH title, DELETE, and POST suspend/resume requests. Each eligible request first
records `workspace-mutation-requested` with only `{id, method, action}` (actions
`rename`, `delete`, `suspend`, `resume`), then waits before the normal handler and
existing fault logic. No headers or credentials are recorded. Native pending
double-tap/dismissal checks can count these admission events while the handler is
held; a successful response alone is not an exactly-once assertion. Wait for the
configured interval to finish. Clear only the owned control by setting its value
to0 for subsequent requests; this does not replay or cancel an in-flight wait.
Existing status/history reads and other workspace IDs are not held.

The fixture HTTP server explicitly uses a 75-second idle timeout so its bounded
60-second controlled waits can finish without a fixture-side idle disconnect.
Shipping clients retain their own request timeouts (currently 30 seconds);
longer waits may therefore exercise client timeout recovery. Admission counts
remain necessary: an idle disconnect or transport retry must not be reported as
an application double submission without evidence of its origin.

For real SDK credential-expiry recovery, global `auth-short-credentials=1`
makes successful register/refresh responses expire seven minutes after issuance
(default0 retains24hours). The SDK's unchanged five-minute refresh buffer leaves
about two minutes to stage private drafts after a fresh sign-in. Global
`auth-refresh-invalid=1` makes only `/api/v1/auth/refresh` return HTTP400 OAuth
`invalid_grant`; device authorization and registration still succeed normally.
Both controls accept only0/1 and use the private fixture control key. Existing
stored credentials keep their issued expiry: enable short credentials before a
fresh sign-in, stage drafts, then wait for normal refresh eligibility and trigger
an ordinary authenticated read. No shipping clock, token resolver, or auth
configuration is overridden. Clear both controls to0 afterward. A helper/SDK
contract test proves response semantics; native expiry cleanup needs its own
observed run and must not be inferred from that test.

`status-auth-error` also requires an exact outer ID (global rejected). When set,
only that workspace's GET status returns HTTP401 `{success:false,error:"Unauthorized"}`.
Use it for post-create sign-in recovery, then clear the same scoped control.
Neither control requires a shipping app bypass. Coordinate a fixture restart
after source changes only when every native tester is at a safe checkpoint.

## Synthetic account switching

The isolated service exposes Personal plus `fixture-org-team-a` (Fixture Team A)
and `fixture-org-team-b` (Fixture Team B), with respective balances of $12.34,
$42.00 and $6.50. The normal account gateway reads/writes the fake active-account
preference; unknown memberships and invalid requests are rejected. Organization
repository and branch routes use the same synthetic repository. None of these
identities, preferences or balances access real accounts.

Coordinate account tests across devices: the fake preference is shared, just as
the API preference is. Use `/control/set` with `id=fixture-user-00000001` for
`accounts-error`, `account-switch-error`, and `account-switch-delay-ms`. Error
value `1` means HTTP503; values401–599 select that exact HTTP status. Delays are
bounded to0–60000ms and hold the admitted switch before mutation. An admission
event and a separate successful-update event distinguish pending from committed
writes. Clear each control with value0; clearing a delay does not cancel an
already admitted request.

For delayed list responses, set `list-delay-ms` on an exact organization ID or
`fixture-user-00000001` for Personal. The response captures its rows and account
scope before waiting, so a late reply can exercise real client generation guards
without changing another account's response. A global delay affects every scope.

`bun run test scripts/native-fixture-accounts.test.ts` exercises the shipping
account/setup/session gateways against the same fixture response router. This is
HTTP contract coverage, not native or production-account authorization coverage.

## SDK contract profiles (opt-in)

The `sdk-boundary-fixture` and `sdk-work-fixture` prompts exercise newer client
regressions through the real Hub command/event projector. They do not execute a
model, shell command, or patch. `sdk-contract-profiles.ts` uses the SDK's actual
`buildInitialUserContent` and `agentMessageToMessageWithMetadata` builders, plus
SDK `AgentEvent` and `AgentModelToolActivity` types. Synthetic results and gates
explicitly model LocalRuntimeHost's assistant-message persistence before tools
complete; this is contract coverage, not an actual LocalRuntimeHost execution.

- `sdk-boundary-fixture`: persists an assistant `tool_use` with no result, sends
  real-projector nested stdout/stderr progress, and waits. Reopen/reconnect this
  exact chat, then release the gate. Its live `tool.finished` must complete the
  already hydrated tool row and show `SDK_BUILD_RESULT`.
- `sdk-work-fixture`: adds two authored UTF-8 file blocks, including the literal
  `SGVsbG8=`; SDK `ts` times; narration/tool/result pairs; a second gate after the
  first iteration has persisted; metadata-only provider web-search activity; and
  a `submit_and_exit` with its final report in `input.summary`. On completion,
  check work grouping, visible final summary, file sharing, and timestamps.

Controls always require the exact synthetic workspace id. With the matching
server config, run `FIXTURE_CONFIG_PATH=... FIXTURE_WORKSPACE_ID=... bun
 e2e/native-fixture/control.ts sdk-profile` to inspect its current phase, then
`... control.ts sdk-release` once per waiting gate. The work profile has two
gates: `waiting-tool-result` and `waiting-second-tool-result`. No global release
or fault is necessary.

Validate these profiles on a fresh isolated server at port4796 with
`FIXTURE_PORT=4796 FIXTURE_STATE_DIR=/absolute/fresh/scratch bun
 e2e/native-fixture/server.ts`, then `FIXTURE_CONFIG_PATH=/absolute/fresh/scratch/config.json
bun e2e/native-fixture/sdk-contract-self-test.ts`. The selfcheck creates/deletes
only its synthetic workspaces, replaces only its own WebSocket, and checks actual
wire/history contracts plus shipping reducer and work-group projections. A native
bundle may explicitly target this port with `EXPO_PUBLIC_NATIVE_FIXTURE_BASE`.
Do not count this selfcheck as native acceptance. The default server on4783 and
any already running native session are unaffected by launching the isolated one.
