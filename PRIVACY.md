# Privacy & Telemetry

Written as part of the 2026-07-09 extension audit (`audits/extension-audit-2026-07-09.md`,
finding E-6) — the codebase had no written privacy documentation despite
carrying real data-collection code paths and a product pitch built on
provenance and defensibility. This corrects that gap by stating, plainly,
what is actually collected today, based on reading the code, not on what
the packaging implies.

## What's collected by default

**Anonymous usage/error telemetry (PostHog).** Enabled by default, controlled
by the **"Allow error and usage reporting"** checkbox under Settings → Privacy
& Telemetry (also honors VS Code's own global telemetry level — if you've
disabled telemetry at the IDE level, this extension respects that too).
Turning the checkbox off stops all outbound PostHog events immediately
(`TelemetryService.updateTelemetryState`).

What it captures: task lifecycle events (created/completed/mode-switched),
tool-usage counts, model selection, token usage, and error events. Error
messages are truncated to 500 characters before being sent
(`MAX_ERROR_MESSAGE_LENGTH` in `src/services/telemetry/TelemetryService.ts`)
— this bounds but does not eliminate the chance that a truncated error string
contains a fragment of a file path or other workspace-specific text if the
underlying error happened to include one. **Prompt content, file contents,
and API keys are not part of this event catalog** — see
`src/services/telemetry/TelemetryService.ts` for the exhaustive list of
capture methods; nothing there reads file bodies or model responses.

The distinct ID used to correlate events is either your host machine ID
(`node-machine-id`) or a locally-generated UUID, not tied to any personal
account unless you sign in (see `src/services/logging/distinctId.ts`).

## What's collected only if you explicitly enable it

**OpenTelemetry (metrics/logs export).** Off by default — requires setting
`OTEL_TELEMETRY_ENABLED=1` in the extension host's environment, which is not
something a typical marketplace install exposes. This exists for
self-hosted/enterprise deployments that want to route telemetry to their own
OTLP collector instead of (or alongside) PostHog. See
`src/shared/services/config/otel-config.ts`.

## What isn't telemetry, despite living near telemetry code

**Firebase.** Used exclusively as an authentication provider for account
sign-in (`src/services/auth/providers/FirebaseAuthProvider.ts`) — it does not
collect usage telemetry. An earlier draft of this audit's findings grouped it
with the telemetry surface by proximity in `package.json`; that was
inaccurate and is corrected here.

**Recognition worker** (anonymous marketplace star/usage counters). A
separate system with its own documented abuse-control posture — see
`recognition-worker/README.md` in this repo. It records a server-derived
daily-deduplicated hash, not raw identifiers.

## What was removed as part of this audit

`@sentry/browser` was declared in `package.json` but had zero imports
anywhere in `src/` or `webview-ui/` — dead code, not a live error-reporting
path. Removed rather than documented, since documenting unused code as if it
were active would be its own inaccuracy.

## What this document does not decide

Whether PostHog telemetry should default to **off** instead of **on** (i.e.
opt-in rather than opt-out) is a product decision with real trade-offs — it
would reduce the usage visibility the maintainer relies on for prioritization,
and changes the experience for every existing user, not just new installs.
This audit surfaces the current default (opt-out, `telemetrySetting`
defaults to enabled unless explicitly set to `"disabled"` — see
`src/core/controller/ui/initializeWebview.ts`) as a fact worth knowing, not
as something to silently flip. If the product wants an opt-in-by-default
posture to match its provenance-first positioning more closely, that's a
deliberate call for the maintainer to make.
