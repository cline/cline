# Phase 2 Handoff: Remove Unrelated Applications

## Goal

Reduce the monorepo to the VS Code extension and the SDK packages it needs.
Do not change Bedrock providers or other retained features in this phase.

Repository: `C:\Coding\cline_aws`

Read `plan/scope.md` and the applicable `AGENTS.md` files before editing.
Preserve unrelated user changes.

## Remove

```text
apps/cli/
apps/cline-hub/
apps/vscode-rollout/
apps/examples/
evals/
sdk/examples/
sdk/packages/sdk/
sdk/packages/ui/
```

Before deleting `apps/cline-hub`, record the source commit and path of
`apps/cline-hub/src/webview/src/components/TeamTasks.tsx` in the completion
note. It is a reference for the future local Kanban view; do not retain the
entire application.

## Keep

```text
apps/vscode/
apps/vscode/testing-platform/
sdk/packages/shared/
sdk/packages/llms/
sdk/packages/agents/
sdk/packages/core/
```

Also keep:

- licensing and attribution files;
- build and code-quality configuration used by retained packages;
- VS Code extension assets and webview;
- code for MCP, skills, local plugins, teams, worktrees, browser automation,
  history, checkpoints, and diagnostics;
- `apps/vscode/standalone/` until a later phase proves it unnecessary.

Do not remove providers, accounts, telemetry, marketplace features, approval
logic, Jupyter, or autocomplete here. Those changes belong to later phases.

## Work

1. Check the current branch and working tree.
2. Record the `TeamTasks.tsx` reference.
3. Delete the directories in the Remove list.
4. Update the root `package.json` workspaces and scripts so they reference only
   retained packages.
5. Update CI configuration only where it invokes deleted applications or
   packages.
6. Remove obsolete imports and executable references to deleted packages.
7. Make minimal documentation changes so contributor instructions no longer
   point to deleted applications.
8. Run `bun install` from the repository root to regenerate `bun.lock`. Do not
   edit the lockfile manually.
9. Verify the retained extension, then commit this phase independently.

Avoid broad dependency cleanup. Feature-specific dependencies should be
removed when their corresponding feature is removed.

## Stale-Reference Check

Run one focused search:

```powershell
rg -n "apps/cli|apps/cline-hub|apps/vscode-rollout|apps/examples|sdk/examples|sdk/packages/sdk|sdk/packages/ui|@cline/cline-hub|@cline/sdk|@cline/ui" package.json .github scripts sdk apps/vscode
```

Remove executable, workspace, import, and CI references. Intentional comments
or historical documentation may remain.

## Required Verification

Keep verification proportional to this structural cleanup:

```powershell
# Repository root
bun install
bun run build:sdk

# apps/vscode
bun run check-types
bun esbuild.mjs
bun run package
```

Do not run the full unit, integration, E2E, or lint suites for this phase unless
one of the required commands exposes a related problem.

Perform one manual smoke test with the generated VSIX:

1. Install it in VS Code.
2. Confirm the extension activates.
3. Confirm the sidebar/webview opens.
4. Confirm there are no missing-module errors.

A live Bedrock prompt is optional because Bedrock behavior is not changed in
this phase.

## Done When

- Every directory in the Remove list is gone.
- Every directory in the Keep list remains.
- Workspaces, scripts, imports, and CI no longer execute deleted packages.
- The lockfile is regenerated successfully.
- SDK build, VS Code typecheck, bundle, and package commands succeed.
- The generated VSIX activates and opens its webview.
- No later-phase feature removal was mixed into this change.

## Commit

Suggested message:

```text
chore: remove non-VS-Code applications
```

The completion handoff should report:

- commit SHA;
- deleted directories;
- important workspace or script changes;
- results of the five required commands and smoke test;
- the recorded `TeamTasks.tsx` source reference;
- any unresolved issue.
