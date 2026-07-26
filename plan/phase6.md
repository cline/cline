# Phase 6 Handoff: Structural Cleanup and Removal Gate

## Goal

Clean up everything made obsolete by Phases 2 through 5 and establish a small,
buildable Bedrock-only codebase before adding model discovery or the startup
doctor.

This is a deletion and simplification phase. Do not add product features.

Repository: `C:\Coding\cline_aws`

Prerequisite: Phases 0 through 5 are complete. Read `plan/scope.md` and the
applicable `AGENTS.md` files before editing. Preserve unrelated user changes
and all retained user data.

## Keep

- the Bedrock-only runtime and AWS connection from Phase 3;
- environment credentials and AWS profile/SSO;
- region, endpoint, CA bundle, and selected Bedrock model;
- streaming, cancellation, Plan and Act modes;
- file reading, code search, diffs, and explicit approvals;
- optional terminal, browser, and web fetching;
- user/workspace MCP, skills, and filesystem plugins;
- teams, worktrees, Kanban foundations, Git support;
- history, checkpoints, and local redacted logs;
- the focused cleanup migrations introduced in Phases 4 and 5.

Historical conversations may contain old provider names. Do not delete or
rewrite conversation content merely to make a text search clean.

## Cleanup Rules

- Delete obsolete code instead of retaining no-op adapters.
- Collapse one-item registries and factories into direct Bedrock/local calls.
- Remove compatibility layers that only support deleted features.
- Do not create new generic frameworks.
- Do not change retained behavior unless required to remove a deleted
  dependency.
- Do not begin dynamic model discovery, startup selection, or doctor work.
- Do not perform final branding; that remains a later phase.

## Part A: Remove Dead Runtime Wiring

Review extension and SDK startup for registrations of deleted services:

- non-Bedrock providers;
- accounts and hosted authentication;
- billing and subscriptions;
- telemetry and remote error reporting;
- feature flags and remote enterprise configuration;
- hosted marketplace and remote installers;
- YOLO and auto-approval;
- Jupyter and AI inline completion.

Remove:

- dependency-injection registrations;
- bootstrap initialization and shutdown hooks;
- event listeners and subscriptions;
- RPC handlers and service exports;
- controller fields and constructor parameters;
- no-op implementations created only to satisfy old interfaces.

Where a factory or registry now contains one retained implementation, call that
implementation directly unless the abstraction still serves another retained
purpose.

## Part B: Simplify Contracts and State

Remove obsolete fields and types from:

```text
apps/vscode/proto/
apps/vscode/src/shared/
apps/vscode/src/shared/storage/
apps/vscode/src/shared/proto-conversions/
apps/vscode/src/core/controller/
apps/vscode/src/sdk/
sdk/packages/shared/
sdk/packages/agents/
sdk/packages/core/
```

Clean up:

- deleted service RPC messages and generated clients;
- deleted webview message variants;
- obsolete extension state and context fields;
- account, telemetry, marketplace, YOLO, approval-bypass, Jupyter, and
  autocomplete settings;
- non-Bedrock provider configuration;
- unused schema branches and conversion helpers;
- legacy migrations that only restore removed functionality.

Keep the Phase 4 account-secret cleanup and Phase 5 approval-state cleanup for
the first Bedrock-only release. They must be small, idempotent, and isolated.
Do not retain their former service implementations.

Regenerate protobuf and other generated code through repository scripts. Do
not hand-edit generated output.

## Part C: Simplify the Webview

Remove dead:

- routes and navigation items;
- React contexts and providers;
- hooks, selectors, reducers, and state projections;
- modal and notification variants;
- commands and message handlers;
- styles, icons, images, and localization strings;
- onboarding branches for removed services.

The remaining shell should expose only retained local functionality. Avoid
redesigning it during this phase.

Verify that loading the webview does not request deleted state fields or wait
for deleted subscriptions.

## Part D: Remove Dependencies and Package Surface

Review the retained `package.json` files and remove dependencies used only by
deleted code. Pay particular attention to:

- non-Bedrock provider SDKs;
- account and OAuth libraries unrelated to MCP or AWS;
- PostHog and OpenTelemetry/exporter packages;
- marketplace download, Git, archive, or installer helpers;
- Jupyter and inline-completion helpers;
- unused UI packages and generated catalogs.

Also remove obsolete:

- package exports;
- workspace scripts;
- environment variables;
- build entry points;
- optional and peer dependencies;
- bundled assets and package allowlists;
- publish files for deleted packages.

Run `bun install` to regenerate lockfiles. Do not edit lockfiles manually.

## Part E: Clean Tests, Fixtures, Scripts, CI, and Documentation

Delete tests and fixtures whose subject no longer exists. Do not rewrite them
to test removed compatibility behavior.

Update:

- CI matrices that reference deleted packages or features;
- scripts that initialize deleted services;
- development fixtures and mock servers for removed systems;
- contributor commands that no longer exist;
- architecture documents that describe removed runtime paths.

Keep:

- VS Code extension packaging and publishing scripts;
- local MCP test utilities still needed by retained MCP behavior;
- Bedrock and approval tests retained by earlier phases;
- licensing and third-party notices.

Documentation changes should describe the current architecture only. Final
user-facing branding and release documentation remain later work.

## Part F: Inspect the Packaged VSIX

The source tree compiling is not sufficient. Inspect the produced VSIX and
confirm it does not bundle deleted implementations, dependencies, endpoints,
or assets.

Check the extracted package for:

- non-Bedrock provider clients;
- Cline account, ClinePass, billing, or subscription modules;
- PostHog/OpenTelemetry exporters and remote endpoints;
- remote feature-flag and enterprise-configuration code;
- hosted marketplace catalogs or installers;
- YOLO/auto-approval UI and state;
- Jupyter command contributions;
- AI inline-completion registration.

Intentional historical strings, licenses, and VS Code Marketplace publishing
metadata may remain when they do not create executable behavior.

Record the VSIX size before and after Phase 6. This is informational, not an
acceptance threshold.

## Implementation Order

1. Check the branch and working tree.
2. Build/package once to record the pre-cleanup baseline and VSIX size.
3. Remove dead startup, service, and controller wiring.
4. Simplify RPC, state, schemas, and generated contracts.
5. Remove dead webview routes, contexts, components, and assets.
6. Remove obsolete SDK exports and one-item generic abstractions.
7. Remove unused dependencies and regenerate lockfiles.
8. Delete obsolete tests, fixtures, scripts, CI entries, and documentation.
9. Regenerate protobuf and other generated sources.
10. Run focused searches and resolve executable matches.
11. Build/package and inspect the VSIX.
12. Perform the smoke test and commit Phase 6 independently.

## Focused Searches

Review executable matches rather than blindly deleting all text:

```powershell
rg -n -i "clinepass|cline-pass|subscription|billing|posthog|opentelemetry|remote.?config|feature.?flag" apps/vscode sdk/packages
rg -n -i "marketplace|officialPluginsRepo|autoApprove|autoApproval|yolo|jupyter|notebook|InlineCompletionItemProvider" apps/vscode sdk/packages
rg -n -i "anthropic|openai|openrouter|gemini|vertex|ollama|mistral|qwen|groq|litellm|requesty|huggingface" apps/vscode sdk/packages
```

Interpret matches carefully:

- an Anthropic model ID inside Bedrock metadata is valid;
- MCP OAuth is valid;
- VS Code Marketplace publishing is valid;
- historical conversation data is valid;
- executable non-Bedrock routing or hosted-service code is not valid.

Also search for imports pointing to files deleted in earlier phases:

```powershell
rg -n "services/(account|auth|telemetry|feature-flags)|controller/(account|ocaAccount|marketplace)|components/(account|marketplace|chat/auto-approve-menu)" apps/vscode sdk/packages
```

## Minimal Verification

Do not add a new broad test suite for cleanup. Retain and run only the focused
tests introduced by Phases 3 through 5 when their files were touched.

Required commands:

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

1. Install the VSIX into a clean VS Code profile.
2. Confirm the extension activates and its webview opens.
3. Confirm Bedrock settings open.
4. Confirm existing history opens.
5. Confirm a file read works.
6. Confirm an edit still waits for diff approval.
7. Confirm there are no missing-module, missing-RPC, or webview-state errors.

A live Bedrock request is optional in this structural phase if Phase 5 already
verified it and the runtime was not changed.

## Done When

- Removed features have no startup wiring, RPCs, state, UI, dependencies, or
  packaged implementation.
- The remaining architecture has no unnecessary one-item provider or hosted
  service abstraction.
- Required cleanup migrations remain small and isolated.
- Retained history and checkpoints are unchanged.
- Workspaces, scripts, CI, and documentation reference only retained code.
- Lockfiles and generated code are current.
- SDK build, typecheck, bundle, package, VSIX inspection, and smoke test pass.
- No model-discovery or startup-doctor feature work was mixed into the phase.

## Commit

Suggested message:

```text
refactor: remove obsolete feature wiring and dependencies
```

The completion handoff should report:

- commit SHA;
- major deleted runtime and UI areas;
- removed dependencies and package exports;
- retained cleanup migrations;
- generated-code and lockfile changes;
- required command and smoke-test results;
- pre/post VSIX size;
- intentional search matches that remain and why.
