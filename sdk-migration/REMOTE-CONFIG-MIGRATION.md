# Remote Config → SDK Migration

Tracking the migration of the extension's classic remote-config system
(`src/core/storage/remote-config/`) to use the SDK's remote-config runtime
(`sdk/packages/shared/src/remote-config/`).

## Background

- **Classic system** (current): direct `axios` fetch → transform → write to
  `StateManager.remoteConfigCache` (in-memory) and global state toggles.
  Lives in `src/core/storage/remote-config/{fetch,utils,syncRemoteMcpServers}.ts`.
- **SDK system** (target): `prepareRemoteConfigRuntime()` →
  `RemoteConfigBundle` → materialize to `.cline/remote-config/` files
  + plugin definition wired into session start. Lives in
  `sdk/packages/shared/src/remote-config/` (package: `@cline/shared`,
  consumed in the extension as `@clinebot/shared`).

## Constraints

- **Don't import directly from `sdk/packages/...`** — consume via the published
  `@cline/shared` / `@cline/core` packages.
- Use **only `@cline/*@0.0.41`** for this bridge migration. Do not switch root
  dependencies to local `file:./sdk/packages/*` links. If an expected export or
  type is missing from `@cline/*@0.0.41`, stop and report it rather than adding
  a local link.
- This first migration is a **bridge migration**: the SDK runtime becomes the
  source used for materialization/session integration, but we still mirror the
  resolved remote config into `StateManager.remoteConfigCache` so the existing
  webview, provider-lockdown, MCP, toggle, and telemetry paths keep working.
- Do not delete classic remote-config files in this PR. Cleanup is a future
  step after the bridge and materialized consumers are proven.
- This module may move out of the monorepo eventually.

## Plan

### Step 1 — Verify published SDK consumption ⏳
- [ ] Keep root `package.json` on published `@cline/shared@0.0.41` and
  `@cline/core@0.0.41` (no `file:` links)
- [ ] Verify the extension can import the needed runtime/core integration
  symbols from `@cline/shared` / `@cline/core`
- [ ] If any required export is missing from `@cline/*@0.0.41`, stop and report
  the missing export instead of linking local SDK packages
- [ ] Run `npm run compile` to confirm type information resolves

### Step 2 — Implement an SdkRemoteConfigControlPlane adapter
- [ ] Create `src/core/storage/remote-config/sdk-control-plane.ts`
- [ ] Implement `RemoteConfigControlPlane` using duplicated/minimal classic
  discovery and fetch logic for this PR (do not refactor `fetch.ts` yet):
  - `ClineAccountService.fetchUserRemoteConfig()` discovery
  - `isRemoteConfigEnabled()` opt-out/admin behavior
  - per-org remote-config fetch/cache fallback behavior
  - LiteLLM API-key fetch and secret setup bridge metadata where needed
- [ ] Wrap the resolved config in a `RemoteConfigBundle`
- [ ] Because `@cline/shared@0.0.41` does not expose `globalSkills` on its
  public `RemoteConfig` type, preserve skills by converting extension
  `remoteConfig.globalSkills` to `bundle.managedInstructions` entries with
  `kind: "skill"`
- [ ] Unit test the adapter

### Step 3 — Add SDK refresh bridge
- [ ] Add an extension-facing refresh function (for example
  `refreshSdkRemoteConfig(controller)`) that invokes
  `prepareRemoteConfigCoreIntegration()` with the SDK control plane
- [ ] Use current workspace root as `workspacePath`; fall back to a Cline-owned
  global directory only when workspace-less
- [ ] Keep a bridge that mirrors the resolved extension `RemoteConfig` into
  `StateManager.remoteConfigCache` with existing `applyRemoteConfig(...)` so
  the webview keeps working (until the materialized consumer migration)
- [ ] On SDK preparation success, keep the prepared SDK integration even if the
  classic bridge application fails; log bridge failures and still post state
- [ ] On explicit no-config/disabled/opt-out, clear classic remote config and
  dispose/unset the active SDK integration
- [ ] On transient fetch/preparation failures, keep the previous active SDK
  integration and previous bridge state

### Step 4 — Wire `applyToStartSessionInput()` into session start
- [ ] Store exactly one current prepared remote-config integration on
  `SdkController`; dispose the old one after a successful swap, dispose/unset
  on explicit clear, and dispose on controller shutdown
- [ ] Compose the current integration in `VscodeSessionHost.create(... prepare)`
  at the session start boundary, before appending VS Code extra tools
- [ ] Verify the remote-config plugin extension is registered with the session
  and that telemetry config flows through
- [ ] Unit test the session-host composition

### Step 5 — Migrate rules/workflows/skills to materialized files (future PR)
- [ ] Update `src/core/context/instructions/user-instructions/cline-rules.ts`
  to read remote rules from the materialized `rules.md`
- [ ] Update `src/core/controller/file/refreshSkills.ts` to read from
  the materialized `skills/` directory
- [ ] Update `src/core/slash-commands/index.ts` workflow lookup
- [ ] Keep toggle state for user enable/disable, but use file presence
  as source of truth

### Step 6 — Migrate OTEL config (future PR)
- [ ] Adapt the existing `remoteConfigToOtelConfig()` to plug into the
  SDK's `RemoteConfigTelemetryAdapter` interface, OR
- [ ] Use the SDK's `DefaultRemoteConfigTelemetryAdapter` and verify
  parity with current behavior

### Step 7 — Remove classic code (future PR)
- [ ] Delete `src/core/storage/remote-config/fetch.ts`
- [ ] Slim `src/core/storage/remote-config/utils.ts` to just
  `clearRemoteConfig()` (or remove entirely if SDK handles it)
- [ ] Delete `src/core/storage/remote-config/syncRemoteMcpServers.ts`
  (replaced by SDK bundle handling)
- [ ] Once a published version with the runtime is available, bump
  the dep from `file:` to that version

## Status

| Step | State | Notes |
|------|-------|-------|
| 1    | in progress | Using published `@cline/*@0.0.41`; compile passes. `RemoteConfigControlPlane` types are consumed from the public `@cline/shared/remote-config` subpath. |
| 2    | in progress | Added SDK control-plane adapter and focused unit coverage. |
| 3    | in progress | Added SDK refresh bridge and wired SDK controller timer/task/login refreshes. |
| 4    | in progress | Current integration is stored on `SdkController` and composed in `VscodeSessionHost`; focused unit coverage added. |
| 5    | not started | |
| 6    | not started | |
| 7    | not started | |

## Open Questions / Risks

- The SDK's materializer writes to `<workspacePath>/.cline/remote-config/`.
  The classic system stores rules as in-memory toggles in global state.
  We need to decide how to handle workspace-less scenarios (Desktop fallback)
  and ensure file writes don't pollute user workspaces unexpectedly.
- The SDK exposes `RemoteConfigBundle` (which wraps the raw `RemoteConfig`)
  while the classic API server returns `RemoteConfig` directly. The adapter
  bridges these.
- Need to confirm `@clinebot/shared` re-exports the new runtime symbols
  before the npm bump.
