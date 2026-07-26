# Phase 5 Handoff: Remove Hosted Marketplace, Approval Bypasses, Jupyter, and AI Autocomplete

## Goal

Finish feature removal before new Bedrock features are added:

1. remove Cline's public marketplace and hosted plugin distribution while
   preserving explicitly configured local customization;
2. remove YOLO and every automatic approval bypass;
3. remove Jupyter support;
4. remove AI inline/tab autocomplete and any proposed autocomplete subsystem.

Repository: `C:\Coding\cline_aws`

Prerequisite: Phase 4 is complete. Read `plan/scope.md` and the applicable
`AGENTS.md` files before editing. Preserve unrelated user changes and all
retained agent workflows.

## Keep

- workspace and user MCP configuration
- manually configured stdio, SSE, and HTTP MCP servers
- MCP OAuth for servers explicitly configured by the user
- workspace and user skills
- workspace-local and user-local plugins
- plugin loading, validation, sandboxing, and local configuration
- Plan and Act modes
- read files and bounded code search
- reviewable file-edit diffs
- optional terminal commands
- browser automation and read-only web fetching
- teams, worktrees, checkpoints, history, and Git assistance
- normal VS Code IntelliSense and ordinary searchable dropdowns

`ModelAutocomplete.tsx` is a model-picker UI control, not AI inline code
completion. Keep or simplify it based on the Bedrock model UI; do not delete it
merely because its filename contains `Autocomplete`.

## Part A: Remove the Hosted Marketplace

Remove:

- public catalog fetching and search;
- marketplace view, buttons, routes, RPCs, and protobuf definitions;
- marketplace entry installation and uninstallation;
- hosted recommendations and featured entries;
- official Cline plugin repository defaults;
- automatic npm, npx, Git, or URL installation;
- remote plugin downloading, cloning, and package installation;
- marketplace-specific tests, fixtures, state, and documentation.

Expected removal targets include:

```text
apps/vscode/proto/cline/marketplace.proto
apps/vscode/src/core/controller/marketplace/
apps/vscode/src/core/controller/ui/subscribeToMarketplaceButtonClicked.ts
apps/vscode/webview-ui/src/components/marketplace/
sdk/packages/core/src/services/marketplace.ts
sdk/packages/core/src/services/marketplace.test.ts
```

Review `sdk/packages/core/src/services/plugin-install.ts`,
`plugin-uninstall.ts`, and `mcp-install.ts` instead of deleting them blindly:

- remove npm, Git, remote URL, and official-repository source handling;
- retain only code genuinely needed to register, copy, remove, or load an
  explicitly selected local filesystem plugin;
- remove marketplace-specific command parsing from MCP installation;
- preserve ordinary manual MCP configuration.

Do not remove:

- `plugin-loader.ts`, plugin configuration, module import, or sandboxing used
  by local plugins;
- MCP managers and clients used by configured servers;
- VS Code extension publishing scripts such as
  `scripts/publish-marketplace.mjs`. Those publish the VSIX to the VS Code
  Marketplace and are unrelated to Cline's plugin marketplace.

### Local-Only Source Rule

Local plugin registration may accept:

- a workspace-relative directory;
- a user-local directory;
- an absolute filesystem path explicitly selected by the user.

It must reject or omit UI for:

- `npm:` sources;
- Git repositories;
- HTTP/HTTPS archives;
- official marketplace slugs;
- automatic dependency installation.

Existing remotely installed marketplace entries may remain as ordinary files
on disk, but the extension must not update or reinstall them. Do not delete
user files automatically.

## Part B: Remove YOLO and Automatic Approval

Remove:

- YOLO state, commands, CLI/state inputs, UI, and remote policy remnants;
- global and per-task auto-approval settings;
- remembered approval decisions;
- safe-command automatic execution;
- automatic edit application;
- browser auto-approval;
- MCP server `autoApprove` lists and toggles;
- child-agent approval inheritance that bypasses the user;
- background-edit paths that avoid review;
- tests and telemetry names that exist only for auto-approval.

Expected removal targets include:

```text
apps/vscode/src/shared/AutoApprovalSettings.ts
apps/vscode/webview-ui/src/components/chat/auto-approve-menu/
apps/vscode/webview-ui/src/hooks/useAutoApproveActions.ts
apps/vscode/src/core/controller/state/updateAutoApprovalSettings.ts
apps/vscode/src/core/controller/mcp/toggleToolAutoApprove.ts
```

Also simplify the approval logic in:

```text
apps/vscode/src/sdk/sdk-tool-policies.ts
apps/vscode/src/sdk/sdk-interaction-coordinator.ts
apps/vscode/src/sdk/sdk-diff-edit-coordinator.ts
apps/vscode/src/sdk/SdkController.ts
apps/vscode/src/services/mcp/McpHub.ts
sdk/packages/agents/
sdk/packages/core/src/runtime/
```

Delete no-longer-used state, protobuf fields, schema properties, webview
messages, and migrations for `autoApprove`, `autoApprovalSettings`, and
`yoloModeToggled`.

### Final Approval Policy

Implement one direct policy:

| Action | Policy |
|---|---|
| Read workspace files | Allowed without approval |
| Bounded workspace code search | Allowed without approval |
| Create, edit, move, or delete files | Show the diff and require approval |
| Terminal command | Require approval; unavailable when terminal support is disabled |
| Read-only web fetch | Allowed without approval |
| Interactive browser automation | Require approval |
| MCP or plugin tool call | Require approval |
| Worktree or Git mutation | Require approval |
| Plan-mode state change | Prohibited |
| Child-agent state change | Same approval requirement as the parent |

Act mode makes state-changing tools available; it never approves them.

Use one central policy function or table. Do not preserve multiple legacy
policy layers containing different defaults.

### Existing Settings Migration

Add one small migration that:

- removes YOLO and auto-approval keys from global, workspace, task, and MCP
  settings;
- ignores old remembered approvals;
- does not alter unrelated MCP server definitions or user content.

Never interpret an old `true` value as permission.

## Part C: Remove Jupyter

Remove:

- Jupyter commands and command registration;
- notebook toolbar and cell menu contributions;
- notebook context extraction and cell sanitization;
- notebook-specific editing instructions;
- `.ipynb` handling added specifically for model context;
- notebook tests, fixtures, icons, and documentation.

Expected targets include:

```text
apps/vscode/src/integrations/misc/notebook-utils.ts
apps/vscode/src/hosts/vscode/commandUtils.ts
apps/vscode/src/extension.ts
apps/vscode/package.json
```

`commandUtils.ts` also contains non-notebook helpers. Remove notebook functions
and imports without deleting helpers used by normal editor commands.

Remove the commands:

```text
cline.jupyterGenerateCell
cline.jupyterExplainCell
cline.jupyterImproveCell
```

The general file tools may treat `.ipynb` as an unsupported or ordinary file;
do not add a replacement notebook parser.

## Part D: Remove AI Inline/Tab Autocomplete

Search for production registration of:

```text
registerInlineCompletionItemProvider
InlineCompletionItemProvider
inline completion
tab completion
```

Remove any production provider, command, setting, status item, model request,
prompt, cache, or proposed subsystem dedicated to AI code completion.

The current inventory found VS Code standalone stubs for inline completion but
did not identify a production AI inline-completion provider. If that remains
true:

- record that no runtime subsystem existed;
- remove only extension-owned dead stubs or proposed code when safe;
- do not modify VS Code's built-in completion behavior;
- do not remove model-picker search/autocomplete controls.

## Dependencies, State, and Generated Code

- Remove marketplace/download/archive/install dependencies no longer imported.
- Remove approval/Jupyter/autocomplete-only dependencies.
- Update command and menu contributions in `apps/vscode/package.json`.
- Update protobuf definitions and regenerate generated code through repository
  scripts.
- Run `bun install` to regenerate lockfiles.
- Do not hand-edit generated code or lockfiles.

## Implementation Order

1. Check the branch and working tree.
2. Remove marketplace UI, RPC, catalog, and hosted-install paths.
3. Reduce plugin installation to explicit local filesystem sources.
4. Verify local MCP, skills, and plugin loading still have direct entry points.
5. Add the central approval policy.
6. Route retained state-changing tools through that policy.
7. Remove YOLO, auto-approval state/UI/schema/runtime paths and migrate old
   settings to no permission.
8. Remove Jupyter contributions and implementation.
9. Confirm whether a production AI autocomplete subsystem exists; remove it if
   present and document the result.
10. Remove dead dependencies, tests, generated messages, and state.
11. Regenerate code and lockfiles.
12. Run focused verification and commit Phase 5 independently.

Do not begin model discovery or startup-doctor work in this phase.

## Focused Searches

```powershell
rg -n -i "marketplace|officialPluginsRepo|npm:|plugin.*remote|plugin.*git" apps/vscode sdk/packages
rg -n -i "autoApprove|autoApproval|yolo|remember.*approval" apps/vscode sdk/packages
rg -n -i "jupyter|notebook|ipynb" apps/vscode sdk/packages
rg -n -i "registerInlineCompletionItemProvider|InlineCompletionItemProvider|inline.?completion|tab.?completion" apps/vscode sdk/packages
```

Review every executable match. Marketplace references in the VS Code
publishing scripts are intentional. Notebook and inline-completion references
inside generic VS Code API stubs may remain only if the standalone runtime
still requires complete API stubs.

## Minimal Verification

Delete tests for removed marketplace, Jupyter, and auto-approval behavior. Add
only:

1. one table-driven test for the final approval policy;
2. one migration test proving old YOLO/auto-approval state grants no
   permission;
3. one focused local-plugin source test proving local paths work and remote,
   npm, and Git sources are rejected.

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

1. Install the VSIX.
2. Confirm no marketplace, YOLO, auto-approve, Jupyter, or AI completion UI is
   registered.
3. Confirm workspace file reads and bounded searches work.
4. Confirm an edit shows a diff and waits for approval.
5. Confirm a terminal command, MCP call, and browser action each wait for
   approval.
6. Confirm one workspace/user MCP configuration and one local skill or plugin
   can load without contacting a hosted catalog.

## Done When

- No hosted marketplace/catalog or automatic remote installer is reachable.
- Local MCP, skills, and filesystem plugins still load.
- No state-changing operation has an automatic or remembered approval path.
- Plan mode cannot mutate state.
- Child agents cannot bypass approval.
- Jupyter commands and notebook-specific implementation are removed.
- No AI inline/tab completion provider or proposed subsystem remains.
- Removed features and dependencies are absent from the packaged VSIX.
- SDK build, typecheck, bundle, package, focused tests, and smoke test pass.

## Commit

Suggested message:

```text
refactor: remove hosted marketplace and approval bypasses
```

The completion handoff should report:

- commit SHA;
- deleted marketplace and installer surfaces;
- retained local customization entry points;
- final approval-policy implementation location;
- migrated settings;
- Jupyter and autocomplete removal results;
- required command and smoke-test results;
- any intentional search match and why it remains.
