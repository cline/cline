# Desktop App Example

Tauri desktop shell + Bun sidecar backend + Next.js UI for running and inspecting Cline chat sessions.

## Dev Commands

From `apps/examples/desktop-app/`:

- `bun run dev:web` - Next.js UI only (`http://localhost:3125`)
- `bun run dev:sidecar` - sidecar backend only
- `bun run dev` - Tauri desktop dev
- `bun run build` - build web assets
- `bun run build:sidecar` - build the Bun sidecar bundle
- `bun run build:sidecar:bin` - compile the Bun sidecar into a local binary
- `bun run build:binary` - build desktop binary
- `bun run package:desktop` - package the current OS desktop app into `dist/desktop/`
- `bun run typecheck` - TypeScript check

## Web Visual System

The framework-neutral color, typography, radius, and navigation contract lives
in the internal [`@cline/ui`](../../../sdk/packages/ui/README.md) workspace
package. Other Cline web surfaces can take only its tokens or opt into the
Tailwind adapter and shared base styles without depending on the desktop
runtime. See [`webview/styles/README.md`](./webview/styles/README.md) for the
desktop integration notes.

## Releases & Auto-Updates

Desktop releases are built, signed, notarized, and published by the
`desktop-publish` GitHub workflow — see `.github/workflows/desktop-publish.yml`
and the `publish-desktop` skill (`.claude/skills/publish-desktop/SKILL.md`) for
the step-by-step release flow. In short: bump the version in `package.json` +
`src-tauri/tauri.conf.json`, update `CHANGELOG.md`, push a `desktop-vX.Y.Z`
tag, and dispatch the workflow. It produces signed DMGs for Apple Silicon and
Intel, uploads them to the `desktop-vX.Y.Z` GitHub release, and refreshes the
auto-update feed.

Installed apps update themselves via the Tauri updater plugin:

- On launch (and every 2 hours) the app fetches
  `https://github.com/cline/cline/releases/download/desktop-latest/latest.json`
  — a rolling release whose `latest.json` asset always points at the newest
  `desktop-vX.Y.Z` assets. Never delete the `desktop-latest` release or tag.
- If a newer version exists, the app downloads and installs it in the
  background, then shows a "Restart now" toast. Ignoring the toast is fine:
  the staged update takes effect on the next launch.
- Update packages (`.app.tar.gz`) are verified against the minisign public key
  in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). If the private
  key is ever lost, shipped apps can no longer verify new updates — users
  would have to re-download the DMG — so guard the key.
- Updater artifacts are only produced in CI (`tauri.release.conf.json` enables
  `bundle.createUpdaterArtifacts`), so local packaging keeps working without
  the updater signing key.

### GitHub Actions secrets

The workflow needs these repository secrets. The Apple ones come from the same
Apple Developer account used for manual signing (see the manual section below
for background):

| Secret | Value |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64 of the **Developer ID Application** identity exported from Keychain Access as `.p12` (must include the private key): `base64 -i certificate.p12 | pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | The password chosen when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: <Team Name> (<TEAMID>)` — from `security find-identity -v -p codesigning` |
| `APPLE_API_KEY` | App Store Connect API **Key ID** (notarization) |
| `APPLE_API_KEY_CONTENT` | Contents of the `AuthKey_<KEYID>.p8` file |
| `APPLE_API_ISSUER` | App Store Connect **Issuer ID** (UUID from Users and Access → Integrations) |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of the Tauri updater private key (`tauri signer generate`) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for that key |

The Slack + telemetry secrets (`SLACK_RELEASE_BOT_TOKEN`, `TELEMETRY_SERVICE_API_KEY`,
OTEL settings) are shared with the CLI publish workflow and already configured.

## Shareable Desktop Packages (manual fallback)

Tauri desktop bundles are OS-specific, so build each package on the target OS:

- macOS: `bun run package:desktop:mac`
- Windows: `bun run package:desktop:windows`
- Linux: `bun run package:desktop:linux`

The macOS package script refuses to create a shareable package unless Developer ID signing and notarization credentials are configured. This prevents the common Gatekeeper failure where a downloaded unsigned build appears damaged on a teammate's Mac.

Set either `APPLE_CERTIFICATE` or `APPLE_SIGNING_IDENTITY`, plus one notarization credential set before packaging macOS:

- `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`
- `APPLE_API_KEY` or `APPLE_API_KEY_PATH`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`

For local-only macOS testing, use `bun run package:desktop:mac --allow-unsigned-mac`. That ad-hoc signs the `.app` and strips quarantine attributes, but it is not suitable for a downloaded build shared with teammates.

### macOS signing & notarization, step by step

One-time keychain setup:

1. Get the **Developer ID Application** identity from your team admin. A `.cer` alone is not enough — you need the private key. If the admin generated the CSR, have them export the identity from Keychain Access as a `.p12` and import it:
   `security import BeeCertificates.p12 -k ~/Library/Keychains/login.keychain-db -T /usr/bin/codesign -T /usr/bin/security`
2. If `security find-identity -v -p codesigning` still reports `0 valid identities`, the Apple intermediate CA is missing. Install it:
   `curl -O https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer && security import DeveloperIDG2CA.cer -k ~/Library/Keychains/login.keychain-db`
3. Re-run `security find-identity -v -p codesigning` — it should now list `Developer ID Application: <Team Name> (<TEAMID>)`. That exact quoted string is your `APPLE_SIGNING_IDENTITY`.
4. Get an **App Store Connect API key** from the admin: the `AuthKey_<KEYID>.p8` file, the Key ID, and the Issuer ID (a UUID from App Store Connect → Users and Access → Integrations). This is used for notarization only — nothing is published.

Per-build:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: <Team Name> (<TEAMID>)"
export APPLE_API_KEY="<KEYID>"           # Tauri reads APPLE_API_KEY (the Key ID); APPLE_API_KEY_ID alone silently skips notarization
export APPLE_API_KEY_PATH="/path/to/AuthKey_<KEYID>.p8"
export APPLE_API_ISSUER="<issuer UUID>"
bun run package:desktop:mac
```

The first signing run pops a keychain dialog — enter your macOS login password and click **Always Allow**. Notarization uploads the app to Apple's automated malware scan (typically 2–10 minutes) and staples the ticket. Artifacts land in `dist/desktop/`; share the `.dmg`. The DMG name takes its version from `src-tauri/tauri.conf.json`, the zip name from `package.json` — bump both.

Do not remove `src-tauri/entitlements.plist` or the `bundle.macOS.entitlements` reference in `tauri.conf.json`: notarization requires the hardened runtime, which breaks the Bun-compiled sidecar (`SharedArrayBuffer is not defined`, surfacing in-app as "desktop backend endpoint not ready") unless the JIT entitlements are present.

## Runtime Overview

Startup flow:

1. Tauri starts a persistent local desktop backend and keeps only native window/file-picker/open-path responsibilities.
2. The desktop backend starts the Bun sidecar and exposes one websocket transport (`/transport`) for commands, queries, and pushed events.
3. The React app uses `lib/desktop-client.ts` and no longer imports `@tauri-apps/api/core` directly in feature code.
4. Tool approval updates are pushed from the backend instead of polled from the UI.
5. Session process context resolves `workspaceRoot` from git root and uses that same path as default `cwd` for chat runtime and git operations unless explicitly overridden.

Desktop transport envelope:

- Request: `{ "type": "command", "id": string, "command": string, "args"?: object }`
- Response: `{ "type": "response", "id": string, "ok": boolean, "result"?: unknown, "error"?: string }`
- Event: `{ "type": "event", "event": { "name": string, "payload": unknown } }`

## Settings: Routine

- The Settings sidebar includes a `Routine` view for hub-backed automations.
- `Routine` lists all RPC schedules and shows status (`enabled`, `nextRunAt`, active execution).
- From the UI you can open a create form and add, pause/resume, trigger-now, and delete schedules.
- The view is wired to the same scheduler APIs used by `cline schedule` through Tauri commands and `scripts/routine-schedules.ts`.

## Key Files

- [`src-tauri/src/main.rs`](./src-tauri/src/main.rs) - Tauri shell lifecycle, backend launch, and native-only commands
- [`sidecar/index.ts`](./sidecar/index.ts) - persistent Bun sidecar backend
- [`sidecar/chat-session.ts`](./sidecar/chat-session.ts) - in-process chat session runtime
- [`webview/lib/desktop-client.ts`](./webview/lib/desktop-client.ts) - typed desktop websocket client
- [`webview/hooks/use-chat-session.ts`](./webview/hooks/use-chat-session.ts) - UI chat session state + backend subscriptions
- [`webview/lib/chat-schema.ts`](./webview/lib/chat-schema.ts) - chat message schema used by the UI
- [`webview/components/views/settings/routine-view.tsx`](./webview/components/views/settings/routine-view.tsx) - Routine schedules UI

## Data + Storage

- Session artifacts are written under `~/.cline/data/sessions/<sessionId>/` (or `CLINE_SESSION_DATA_DIR`).
- Canonical replay/export artifact: `<sessionId>.messages.json`.
- `<sessionId>.messages.json` is expected to contain ordered messages plus assistant `modelInfo` and `metrics` (including cache token fields when provided by the model runtime).
- `<sessionId>.hooks.jsonl` is observability/debug telemetry and should not be required for normal history replay/export flows.
- Full v1 schema for the persisted messages file, including failure/retry semantics and golden fixtures, is documented in [`packages/core/docs/messages-contract-v1.md`](../../../sdk/packages/core/docs/messages-contract-v1.md).

## Sidecar observability

The desktop sidecar sends SDK telemetry through the same configured OpenTelemetry
pipeline used by the CLI and writes structured runtime logs to
`~/.cline/data/logs/code.log` by default. Telemetry continues to honor the global
opt-out setting exposed in the desktop settings UI. The sidecar truncates stale
logs and rotates the active file before it exceeds 50 MiB.

Logging can be configured with the same environment variables as the CLI:

- `CLINE_LOG_ENABLED=0` disables file logging.
- `CLINE_LOG_LEVEL` sets the Pino level (for example, `debug` or `warn`).
- `CLINE_LOG_PATH` overrides the log destination.
- `CLINE_LOG_NAME` overrides the logger name.

## Troubleshooting

- If live updates stall, verify the desktop backend websocket is connected and `chat_event` messages are arriving.
- Tauri restarts the desktop backend if the sidecar process exits and kills it on app teardown.
- Chat sends now preflight provider credentials. If a provider that requires API-key auth is selected without a key, the UI blocks the turn with a clear error message instead of starting a hanging session.
- If a turn completes with `finishReason=error` before any assistant content is produced, the UI now adds an explicit error chat message so failed turns are visible in the transcript.
- If package changes are not reflected, rebuild SDK packages (`bun run build:sdk`). The next `cline rpc ensure` call should attach to the current build's sidecar automatically.
- Provider settings updates are patch-style: only fields you edit are changed. Unset fields are preserved instead of being cleared.
