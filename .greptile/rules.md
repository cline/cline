# SDK Telemetry Standards

These rules supplement `config.json`. The structured rules describe **what** to enforce; this
document explains **why**, so Greptile has the context to avoid false positives.

## Telemetry Stack

The SDK uses OpenTelemetry (OTEL) as its sole telemetry transport. Events flow through:

```
core-events.ts (event catalog + typed helpers)
       ↓
ITelemetryService (sdk/packages/shared)             ← interface contract
       ↓
TelemetryService (sdk/packages/core)                ← multi-adapter fan-out
       ↓
OpenTelemetryAdapter → OpenTelemetryProvider    ← OTLP transport
       ↓
OTLP endpoint (collector or vendor)
```

The SDK does **not** depend on the original `cline/cline` repo for telemetry. The two have
parallel-but-independent stacks; this `.greptile/` config covers only the SDK.

## The Single Source of Truth

`sdk/packages/core/src/services/telemetry/core-events.ts` is the single source of truth for all
event names. It exports:

- `CORE_TELEMETRY_EVENTS` — a frozen const object grouped by family
  (`CLIENT`, `SESSION`, `USER`, `TASK`, `HOOKS`, `WORKSPACE`)
- A typed `capture*()` helper for every event family
  (`captureExtensionActivated`, `captureTaskCreated`, `captureToolUsage`, etc.)

**Never use raw string literals for event names at call sites.** A new event always means:

1. Add the constant to `CORE_TELEMETRY_EVENTS`
2. Add a typed `capture*()` helper alongside it (with a typed `properties` parameter)
3. Add a unit test in `core-events.test.ts` asserting the event flows through the
   opt-out-respecting `capture` path and never `captureRequired` (opt-out is enforced by
   `OptedOutTelemetryService`, whose `capture` is a no-op — the test convention is
   "emits X as a normal opt-out-respecting event"). Events that intentionally bypass
   opt-out must use `captureRequired` and assert that explicitly.

**All events should be named using snake_case and so should their properties**

## The Activation Funnel

The canonical funnel that downstream analytics depends on:

```
user.extension_activated
  → workspace.initialized
  → workspace.path_resolved (gated on multi-root)
  → task.created
  → task.conversation_turn (one per turn, source: "user" | "assistant")
  → task.completed (source: "submit_and_exit" | "shutdown")
```

Emission ownership:

- `user.extension_activated`: emitted **once per host process** by host-specific helpers
  (`captureCliExtensionActivated` for the CLI, `captureExtensionActivated` for VS Code).
- `workspace.initialized` / `workspace.init_error`: emitted by a per-process de-duplicated
  emitter in `prepareLocalRuntimeBootstrap`. Hosts must NOT re-emit these.
- `workspace.path_resolved`: emitted from default tool executors **only when**
  `WorkspaceManager` exposes more than one root.
- `task.*`: emitted by core session lifecycle code in `sdk/packages/core/src/cline-core/` and
  `sdk/packages/core/src/runtime/`. Hosts must not duplicate this emission.

## `task.completed` Semantics

`task.completed` marks the moment the **assistant declared the task done**, not the moment
the SDK session record was finalized. The local runtime emits it when it observes a successful
`submit_and_exit` tool call (the SDK analog of original Cline's `attempt_completion`). For
non-interactive runs that finish without invoking the explicit completion tool,
`shutdownSession` emits it as a fallback with `source: "shutdown"`.

Each session is guaranteed at most one `task.completed` emission. The `source` field
(`"submit_and_exit" | "shutdown"`) is required for analytics attribution.

## CLI Directory-Ordering Rule

The CLI accepts `--config <dir>`. The CLI **must** apply `setClineDir(...)` and
`setHomeDir(...)` from `@cline/shared/storage` **before** calling
`captureCliExtensionActivated()`. Otherwise the telemetry singleton's persisted distinct-id
and any other on-disk telemetry state lands under `~/.cline` instead of the user's chosen
config dir.

The canonical pattern is in `apps/cli/src/main.ts`:

```ts
if (configDir) setClineDir(configDir);
setHomeDir(homedir());
captureCliExtensionActivated();   // <-- after dir overrides
```

## Hub Daemon Telemetry

The detached hub daemon (`sdk/packages/core/src/hub/daemon/entry.ts`) hosts the
`LocalRuntimeHost` that emits `task.conversation_turn` and `task.tokens` for every
hub-backed session, so the daemon must own its own `ITelemetryService`. It builds one via
`createHubDaemonTelemetry()` (`sdk/packages/core/src/hub/daemon/telemetry.ts`), which
identifies from the cached cline account (re-resolved periodically, since the daemon often
starts before login) and flushes on every shutdown path, including startup failure.

Flag changes that remove this wiring, construct runtime hosts inside the daemon without
passing its telemetry handle, or add daemon exit paths that skip the flush — hub-backed
sessions would silently drop their lifecycle telemetry (this exact bug shipped once).

## Auth Lifecycle Completeness

Every authentication provider in `sdk/packages/core/src/auth/` must emit all four auth lifecycle
events using the typed helpers:

| Phase | Helper | Where it fires |
|---|---|---|
| Flow entry | `captureAuthStarted(provider)` | Top of the OAuth flow function |
| Token success | `captureAuthSucceeded(provider)` + `identifyAccount(...)` | After successful token exchange |
| Token error | `captureAuthFailed(provider, errorMessage)` | In the catch block |
| Token invalidation | `captureAuthLoggedOut(provider, reason)` | On invalid_grant or explicit logout |

Cross-reference `sdk/packages/core/src/auth/cline.ts` and `sdk/packages/core/src/auth/codex.ts` as
canonical examples of all four phases.

## Single Telemetry Service Per Host

On VS Code, all callers go through the lazy `telemetryService` proxy in
`apps/vscode/src/services/telemetry/index.ts`, which constructs the service once on first
use. Do not let individual controllers construct their own `ITelemetryService` — that
fragments distinct-id state, opt-out tracking, and flush ownership.

The CLI follows the same pattern via the `getCliTelemetryService()` singleton in
`apps/cli/src/utils/telemetry.ts`, which is memoized by the activation gate in
`telemetry.activation-gate.ts`.

## Common False-Positive Adjustments

If Greptile flags one of the following, the rule is **not** violated:

- A telemetry call that is wrapped in a host-specific helper (e.g.
  `captureCliExtensionActivated` wrapping `captureExtensionActivated`) — the inner helper
  is the typed call.
- `enterprise.*` events emitted from `apps/cli/src/utils/enterprise.ts` — these are
  enterprise-side events not yet in `CORE_TELEMETRY_EVENTS`; they are tracked separately.
- A new test file that uses raw event name strings inside `expect(...)` assertions — tests
  may reference event names as strings to assert what was emitted.
