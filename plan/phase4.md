# Phase 4 Handoff: Remove Hosted Accounts, Telemetry, and Remote Control

## Goal

Remove Cline-hosted accounts and commercial services, then remove all remote
telemetry, feature flags, error reporting, and enterprise configuration.

After this phase, extension startup must be local and must not require or
contact a Cline service. Local redacted logs remain available.

Repository: `C:\Coding\cline_aws`

Prerequisite: Phases 0 through 3 are complete. Read `plan/scope.md` and the
applicable `AGENTS.md` files before editing. Preserve unrelated user changes,
conversation history, checkpoints, worktrees, and Bedrock configuration.

## Keep

- AWS environment credentials and AWS profile/SSO from Phase 3
- Bedrock region, endpoint, CA bundle, and selected model state
- local VS Code settings and workspace configuration
- local redacted diagnostic logging and the VS Code output channel
- user-configured MCP OAuth
- conversation history, checkpoints, teams, worktrees, and local plugins

MCP OAuth is not Cline-hosted authentication. Do not remove
`McpOAuthManager`, `mcpAuth.ts`, or equivalent MCP authorization support merely
because the names contain `auth` or `oauth`.

## Part A: Remove Accounts and Commercial Services

Remove the remaining implementation for:

- Cline account login, logout, callback, token refresh, and account state
- ClinePass
- subscriptions, credits, billing, organizations, and limit-increase requests
- hosted account synchronization
- provider OAuth left over from removed non-Bedrock providers
- OCA and other non-Bedrock account services
- hosted onboarding and marketing
- ClinePass-specific chat errors, banners, and settings

Expected removal targets include:

```text
apps/vscode/proto/cline/account.proto
apps/vscode/proto/cline/oca_account.proto
apps/vscode/src/core/controller/account/
apps/vscode/src/core/controller/ocaAccount/
apps/vscode/src/services/account/
apps/vscode/src/services/auth/
apps/vscode/src/shared/ClineAccount.ts
apps/vscode/src/shared/internal/account.ts
apps/vscode/src/sdk/account-service.ts
apps/vscode/src/sdk/auth-service.ts
apps/vscode/webview-ui/src/components/account/
apps/vscode/webview-ui/src/context/ClineAuthContext.tsx
sdk/packages/core/src/account/
sdk/packages/core/src/auth/
```

Some files may already be gone after Phase 3. Do not recreate compatibility
layers for them.

Also remove:

- account and login buttons, routes, commands, URI handlers, menus, and views;
- account fields from extension/webview state;
- account RPC registration and generated code;
- Cline account secrets and refresh-token keys;
- auth E2E tests and account-only fixtures;
- account-only environment variables and dependencies.

Replace any "not signed in" startup gate with a direct local route:

- if the Bedrock connection is present, open chat;
- otherwise, open the existing Bedrock settings surface.

Do not build the future startup doctor or model-discovery flow in this phase.

## Account-State Cleanup

Add one small, idempotent cleanup migration that:

- deletes known Cline access tokens, refresh tokens, account IDs, organization
  IDs, and billing state from VS Code SecretStorage/global state;
- removes account fields from task defaults;
- leaves history, messages, checkpoints, worktrees, and Bedrock state intact;
- records only that the cleanup ran.

Do not keep the account service merely to perform cleanup. Use a small
activation-time migration and remove it after the repository no longer needs
to support pre-cleanup installations.

## Part B: Remove Telemetry and Remote Control

Remove:

- PostHog clients and providers;
- OpenTelemetry exporters, adapters, and remote sinks;
- remote error reporting;
- telemetry event catalogs and capture calls;
- telemetry identity, distinct-ID, rollout metadata, and consent state;
- remote feature flags and experiments;
- remote enterprise configuration and its control plane;
- remote configuration materialization, artifact/blob storage, and refresh;
- remote MCP, skill, prompt, rule, or setting synchronization;
- telemetry and remote-configuration protobuf messages and subscriptions.

Expected removal targets include:

```text
apps/vscode/src/services/telemetry/
apps/vscode/src/services/feature-flags/
apps/vscode/src/services/error/providers/PostHogErrorProvider.ts
apps/vscode/src/core/storage/remote-config/
apps/vscode/src/shared/remote-config/
apps/vscode/src/shared/services/config/posthog-config.ts
apps/vscode/src/sdk/sdk-telemetry.ts
apps/vscode/src/sdk/telemetry-settings-sync.ts
apps/vscode/src/sdk/provider-failure-telemetry.ts
apps/vscode/src/sdk/sdk-remote-config-control-plane.test.ts
apps/vscode/proto/cline/remote_config.proto
sdk/packages/core/src/services/telemetry/
sdk/packages/core/src/services/feature-flags/
sdk/packages/core/src/remote-config/
sdk/packages/shared/src/remote-config/
sdk/packages/shared/src/services/telemetry.ts
sdk/packages/shared/src/services/telemetry-config.ts
```

Also remove telemetry helpers embedded in workspace, session, hub, daemon, and
runtime code. Delete capture calls rather than replacing them with no-op
telemetry interfaces.

### Resolve Feature Flags Before Deletion

Inventory every flag still referenced by retained code. For each flag:

- keep the code path required by `plan/scope.md`;
- delete the alternative path and the flag check;
- delete the entire feature when it is out of scope.

Record these decisions in the Phase 4 completion note. Do not replace remote
flags with a new local feature-flag framework.

### Preserve Local Diagnostics

Remote telemetry removal must not remove local operational errors needed for
debugging. Retained code may write sanitized messages to the existing local
logger or VS Code output channel.

Local logs must not contain:

- AWS credentials or tokens;
- Cline tokens being removed;
- authorization headers;
- complete prompts or file contents by default.

Do not keep OpenTelemetry packages just to implement local logging.

## Dependencies and Generated Code

Remove unused packages from the retained package manifests, including
PostHog/OpenTelemetry/exporter packages when no retained import requires them.
Review both:

```text
apps/vscode/package.json
sdk/packages/core/package.json
sdk/packages/shared/package.json
sdk/packages/llms/package.json
```

Update protobuf imports and service registration, then regenerate generated
code through the repository scripts. Run `bun install` to update lockfiles.
Do not hand-edit generated files or lockfiles.

## Implementation Order

1. Check the branch and working tree.
2. Remove account UI routes and startup gates.
3. Remove account/auth controllers, services, RPCs, and state.
4. Add the small account-secret cleanup migration.
5. Remove hosted onboarding, billing, and ClinePass remnants.
6. Resolve retained feature-flag branches.
7. Disconnect telemetry, error-reporting, and remote-config startup wiring.
8. Delete telemetry, feature-flag, and remote-config implementations.
9. Remove related protobuf/state fields, dependencies, tests, and fixtures.
10. Regenerate code and lockfiles.
11. Run the focused verification and commit Phase 4 independently.

Keep each intermediate change buildable where practical. Do not add model
discovery or the startup doctor during this phase.

## Focused Searches

Review matches after removal:

```powershell
rg -n -i "clinepass|cline-pass|accountLogin|accountLogout|subscription|billing|credits|organization|refreshToken" apps/vscode sdk/packages
rg -n -i "posthog|opentelemetry|telemetry|feature.?flag|remote.?config|enterprise.?config|distinct.?id" apps/vscode sdk/packages
```

Permitted matches should be rare and explained in the handoff. Generic words
such as `account` in AWS documentation or `telemetry` in historical planning
documents are not executable violations.

## Minimal Verification

Do not retain or run tests whose subject was deleted. Add only:

1. one focused test that the cleanup migration deletes account secrets without
   deleting history or Bedrock settings;
2. one focused startup test that the extension does not require an account or
   remote feature-flag response.

Run:

```powershell
# Repository root
bun install
bun run build:sdk

# apps/vscode
bun run check-types
bun esbuild.mjs
bun run package
```

Manual smoke test:

1. Install the VSIX in a clean VS Code profile.
2. Confirm no login, account, billing, telemetry, or remote-config UI appears.
3. Confirm the extension opens Bedrock settings or chat without network calls
   to Cline services.
4. Confirm existing history still opens.
5. Confirm local errors still appear in the output channel.

## Done When

- No Cline account or commercial service is reachable.
- No startup path requires authentication with Cline.
- No PostHog, OpenTelemetry exporter, remote error, feature-flag, or enterprise
  configuration service initializes.
- Account secrets are removed without damaging retained state.
- Local redacted logging remains.
- Account, telemetry, remote-config code and dependencies are absent from the
  packaged extension.
- SDK build, typecheck, bundle, package, and smoke test pass.

## Commit

Suggested message:

```text
refactor: remove hosted accounts and remote telemetry
```

The completion handoff should report:

- commit SHA;
- deleted service/UI areas and dependencies;
- feature-flag decisions;
- state-cleanup behavior;
- required command and smoke-test results;
- any remaining hosted-service reference and why it is harmless.
