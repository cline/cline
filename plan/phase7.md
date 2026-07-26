# Phase 7 Handoff: Clean-Core Stabilization Checkpoint

## Goal

Prove that the cleaned Bedrock-only extension is stable before adding model
discovery or the startup doctor.

This phase is a stabilization gate. It may fix regressions caused by removal,
but it must not add product features or restore deleted compatibility layers.

Repository: `C:\Coding\cline_aws`

Prerequisite: Phase 6 is complete and committed. Read `plan/scope.md`,
`plan/phase6.md`, and the applicable `AGENTS.md` files before editing.
Preserve unrelated user changes and retained user data.

## Boundaries

Keep and validate:

- the direct Bedrock runtime;
- environment credentials and AWS profile/SSO;
- region, endpoint, and CA-bundle handling;
- the temporary Bedrock-only model selection available before Phase 8;
- streaming, usage handling, progress, and cancellation;
- Plan and Act modes;
- file reads and bounded code search;
- reviewable file-edit diffs and explicit approvals;
- optional terminal commands;
- existing history and checkpoints;
- local redacted logs.

Do not add:

- dynamic model or inference-profile discovery;
- startup model selection;
- automatic doctor;
- new account, telemetry, marketplace, or remote configuration services;
- a generic provider abstraction;
- new UI design or final branding.

## Stabilization Rules

- Fix the smallest retained layer that owns a failure.
- Do not restore a deleted service merely because an old call site expects it.
- Delete stale call sites instead of introducing no-op adapters.
- Keep Bedrock connection and credential logic in the Phase 3 boundary.
- Keep approvals fail-closed.
- Treat a packaged VSIX—not a source-only build—as the product under test.
- Commit any necessary fixes as part of Phase 7, separately from Phase 8.

## Step 1: Establish the Phase 6 Baseline

Record:

- Phase 6 commit SHA;
- branch and clean working-tree status;
- tracked file count;
- physical and nonblank source-line counts using the established counting
  method;
- production VSIX path and size;
- extension bundle size;
- activation time observed in a clean VS Code profile.

These measurements are informational. Do not optimize solely for a numeric
target.

## Step 2: Validate Clean Installation

From a fresh clone or clean worktree:

1. install dependencies;
2. build retained SDK packages;
3. type-check the VS Code extension;
4. produce the production extension bundle;
5. package the VSIX;
6. install it into a clean VS Code profile.

No command may rely on deleted applications, packages, generated files from an
old checkout, or globally installed project dependencies.

## Step 3: Run the Core Smoke Matrix

Use a small disposable workspace and verify:

| Area | Required result |
|---|---|
| Activation | Extension activates without missing-module or missing-RPC errors |
| Webview | Sidebar opens without waiting for a deleted service |
| Settings | Only retained Bedrock/local settings are reachable |
| Authentication | Temporary environment credentials or a working AWS profile resolves without being persisted |
| Bedrock stream | One real response produces streamed text |
| Usage | Runtime accepts and records usage when Bedrock returns it; missing optional fields do not crash the task |
| Cancellation | An in-flight request can be cancelled and leaves chat usable |
| Plan mode | Can inspect and plan but cannot mutate state |
| Read/search | Workspace file read and bounded search work without approval |
| Edit | Proposed edit opens a reviewable diff and waits for explicit approval |
| Terminal | Command waits for approval and respects the terminal-enabled setting |
| History | Existing conversation history opens |
| Local logs | Failure details are visible locally and secrets are redacted |

Use one small live Bedrock prompt. Do not run a broad or costly model matrix.

## Step 4: Inspect the Runtime Boundary

Confirm:

- there is one reachable Bedrock client/factory path;
- Plan, Act, resumed tasks, and child-agent sessions cannot select a different
  provider;
- credentials are resolved at runtime and never stored;
- region, endpoint, and CA configuration flow through the shared AWS transport;
- cancellation reaches the Bedrock stream through an `AbortSignal`;
- error handling preserves AWS error code and request ID without exposing
  secrets;
- the packaged bundle contains no removed provider or hosted-service runtime.

If a one-item provider registry or deleted-service shim still exists, remove it
only when doing so is a safe, local Phase 7 fix. Large structural work belongs
back in Phase 6.

## Step 5: Inspect the Packaged VSIX

Extract the VSIX and check:

- production entry points exist;
- webview assets load;
- package contributions reference existing commands;
- no removed account, telemetry, marketplace, Jupyter, YOLO, autocomplete, or
  non-Bedrock provider module is bundled;
- required AWS SDK, Bedrock runtime, local MCP, plugin, and approval modules are
  bundled;
- source maps and development fixtures are excluded unless intentionally
  required.

Record intentional textual matches, such as licenses, Bedrock-hosted model
names, and VS Code Marketplace publishing metadata.

## Required Commands

```powershell
# Repository root
bun install
bun run build:sdk

# apps/vscode
bun run check-types
bun esbuild.mjs
bun run package
```

Run only focused tests related to a Phase 7 fix. Do not add or run a broad
regression suite solely for this checkpoint.

## Failure Policy

Phase 7 is blocked when:

- the extension cannot install or activate;
- the webview has missing contract/state errors;
- a real Bedrock response cannot stream;
- cancellation leaves the task or extension unusable;
- edits or commands bypass approval;
- credentials appear in settings, logs, history, or checkpoints;
- removed services initialize or appear in the VSIX.

Document environmental failures separately from code failures. A live Bedrock
failure caused by unavailable credentials is not sufficient evidence that the
runtime works; repeat with a valid temporary environment or profile session.

## Done When

- the required commands pass from a clean installation;
- the VSIX activates and opens its webview;
- the complete core smoke matrix passes;
- one real Bedrock request streams and can be cancelled;
- approval behavior remains fail-closed;
- credentials remain ephemeral;
- the VSIX inspection finds no reachable removed feature;
- measurements and any intentional package matches are recorded;
- the working tree is clean after the checkpoint commit.

## Commit and Tag

Suggested commit:

```text
chore: establish clean Bedrock-only core baseline
```

After the commit is verified, create an annotated baseline tag:

```text
bedrock-clean-core-v0
```

Do not move or recreate the tag after Phase 8 begins.

## Completion Handoff

Report:

- commit SHA and tag;
- required command results;
- VSIX path and size;
- source-line and tracked-file counts;
- clean-profile activation result;
- Bedrock streaming, usage, and cancellation results;
- approval smoke results;
- any retained warning or intentional packaged reference.
