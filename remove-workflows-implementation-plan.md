# Implementation Plan: Remove User-Defined Workflow Slash Commands from Cline

## Document purpose

This document is a standalone implementation plan for removing **the workflows feature** from the Cline codebase while **keeping rules, skills, hooks, MCP prompts, and built-in slash commands working normally**.

It is written to be useful to both:

- developers implementing the change, and
- non-experts who need to understand what the team is changing and why.

The plan assumes the desired end state is:

- users can **no longer define custom workflow slash commands** via markdown files,
- enterprise / remote-config managed workflows are also removed,
- all workflow UI, storage, state, RPCs, tests, and docs are removed,
- but **rules**, **skills**, **hooks**, **built-in slash commands**, and **MCP prompt slash commands** continue to function.

---

## Executive summary

Today, “workflows” are not a separate engine with a scheduler or runner. They are a **custom slash-command source**.

A workflow is simply a markdown file whose **filename becomes a slash command**. When a user types something like `/release.md`, Cline looks for a matching workflow file and injects the file’s contents into the model prompt as explicit instructions.

That means workflow removal is best understood as a **cross-cutting custom-slash-command feature removal**, not as removal of a single isolated subsystem.

The safest way to remove workflows is to do it in coordinated layers:

1. remove workflow discovery from slash-command parsing and autocomplete,
2. remove workflow toggle/state/storage handling,
3. remove workflow-specific RPCs and controller handlers,
4. remove workflow UI from webview and CLI,
5. remove enterprise remote-config workflow support,
6. clean up tests, generated types/protos, docs, and any persisted compatibility concerns.

---

## What the workflows feature is today

### Plain-English explanation

Users can create markdown files that act like reusable task scripts.

Examples:

- `.clinerules/workflows/release.md`
- `~/Documents/Cline/Workflows/deploy.md`
- enterprise-provided remote workflow definitions from remote config

When the user types `/release.md` in chat:

1. Cline recognizes it as a slash command.
2. Cline checks whether it matches a built-in command first.
3. If not, Cline checks whether it matches a workflow filename.
4. If it does, Cline reads the markdown content.
5. Cline injects that content into the prompt as `<explicit_instructions type="release.md"> ... </explicit_instructions>`.
6. The model then follows those instructions as part of the current task.

So the feature is really made of three parts:

- **discovery**: finding available workflow files,
- **selection**: showing them in slash-command autocomplete and validating them,
- **execution**: injecting the markdown into the prompt when the slash command is used.

---

## Architectural vision for the removal

### Desired end state

After this work is complete:

- custom workflow markdown files are **ignored by the product**,
- `/foo.md` should **not** resolve to user-defined instructions,
- workflow-related toggles and state should no longer be tracked,
- workflow-related UI should disappear,
- remote-config workflow payloads should no longer affect runtime behavior,
- existing built-in commands like `/newtask`, `/smol`, `/newrule`, `/deep-planning`, `/reportbug`, `/explain-changes` should continue working,
- MCP prompt slash commands such as `/mcp:server:prompt` should continue working,
- rules and skills should remain intact.

### Important guiding principle

Do **not** attempt a “hide it in the UI only” removal.

A partial removal would be dangerous because users could still trigger workflows through parser or remote config paths even if UI elements disappeared.

Instead, remove the feature **end-to-end**:

- parser/runtime,
- state/storage,
- transport/proto,
- UI,
- docs,
- tests,
- compatibility cleanup.

### Recommended removal pattern

Use this pattern throughout implementation:

1. **Remove runtime behavior first**
   - eliminate the ability to execute workflow slash commands.
2. **Then remove discovery surfaces**
   - autocomplete, menus, toggle views, CLI config.
3. **Then remove storage/state/proto plumbing**
   - prevent stale architecture from lingering.
4. **Then remove docs and tests**
   - make the product surface match the code reality.
5. **Then verify persisted and remote data fails harmlessly**
   - old data should be ignored, not crash the app.

This order reduces the risk of leaving a hidden execution path behind.

---

## Scope

### In scope

- removing all support for user-defined workflows as slash commands
- removing workspace, global, and remote workflow support
- removing workflow creation/toggling/deletion/opening flows
- removing workflow state keys and sync/refresh logic
- removing workflow entries from webview and CLI config UIs
- removing workflow references from docs and tests
- ensuring non-workflow slash commands still work
- ensuring rules/skills/hooks still work

### Out of scope

- changing how built-in slash commands work
- removing MCP prompt slash commands
- removing rules, skills, hooks, or `.clineignore`
- redesigning slash commands generally beyond what is necessary for workflow removal
- migrating workflow files to another feature automatically unless product explicitly asks for that later

---

## Current architecture map

This section summarizes the current code structure so a developer does not need our conversation for context.

### 1. Runtime execution path

#### `src/core/task/index.ts`

This is where task startup refreshes workflow toggle state before slash commands are parsed.

Current role:

- imports `refreshWorkflowToggles`
- refreshes local/global workflow toggles during task setup
- passes those toggles into `parseSlashCommands()`

Why it matters:

- if this call remains, the app continues treating workflows as live runtime input.

#### `src/core/slash-commands/index.ts`

This is the most important runtime file for the feature.

Current role:

- handles built-in slash commands
- handles MCP prompt slash commands
- handles workflow slash commands
- loads local/global/remote enabled workflows
- resolves matching filename
- reads file or remote contents
- injects contents into the prompt as `<explicit_instructions ...>`

Why it matters:

- this is the actual “workflow execution” path.
- if workflows are not removed here, the feature still exists even if everything else is hidden.

### 2. Slash-command discovery / autocomplete

#### `src/core/controller/slash/getAvailableSlashCommands.ts`

Current role:

- returns built-in slash commands
- appends enabled local/global/remote workflows as custom commands
- marks them as `section: "custom"`

Why it matters:

- this feeds slash-command autocomplete and other discovery surfaces.

#### `webview-ui/src/utils/slash-commands.ts`

Current role:

- computes workflow commands from workflow toggles and remote workflows
- merges built-in commands + workflow commands + MCP prompt commands
- supports validation, filtering, insertion, and menu matching

Why it matters:

- this is the front-end command-discovery implementation.

#### `webview-ui/src/components/chat/ChatTextArea.tsx`
#### `webview-ui/src/components/chat/SlashCommandMenu.tsx`

Current role:

- passes workflow toggles and remote workflow arrays into slash-command matching
- renders a “Workflow Commands” section in the menu

Why it matters:

- these are user-facing discovery points and must stop assuming workflows exist.

### 3. Workflow toggle/state refresh and storage

#### `src/core/context/instructions/user-instructions/workflows.ts`

Current role:

- scans global and local workflow directories
- synchronizes workflow toggle maps
- writes refreshed values into state

Why it matters:

- dedicated workflow state synchronization layer.

#### `src/core/storage/disk.ts`

Current role:

- defines `GlobalFileNames.workflows = ".clinerules/workflows"`
- defines `ensureWorkflowsDirectoryExists()` for global workflow storage

Why it matters:

- this is the canonical storage path definition for workflows.

#### `src/shared/storage/state-keys.ts`

Current role:

- defines state/settings fields including:
  - `workflowToggles`
  - `globalWorkflowToggles`
  - `remoteWorkflowToggles`
  - `remoteGlobalWorkflows`

Why it matters:

- these keys are persisted and exposed through extension state.

### 4. File management and controller layer

#### `src/core/controller/file/createRuleFile.ts`
#### `src/core/controller/file/deleteRuleFile.ts`
#### `src/core/context/instructions/user-instructions/rule-helpers.ts`

Current role:

- workflow creation and deletion are multiplexed through generic “rule file” flows using `type === "workflow"`
- local/global workflow paths are created or deleted
- workflow toggles are updated

Why it matters:

- workflow support is embedded inside shared file-management plumbing.
- removal requires carefully preserving rule handling while deleting workflow branches.

#### `src/core/controller/file/toggleWorkflow.ts`

Current role:

- dedicated workflow toggle handler for local/global/remote scopes

Why it matters:

- clean removal target; other features should not depend on it.

#### `src/core/controller/file/refreshRules.ts`

Current role:

- refreshes rules, external rules, and workflows together
- returns workflow toggle payloads in `RefreshedRules`

Why it matters:

- workflow removal requires shrinking this response contract.

#### `src/core/controller/file/openFile.ts`

Current role:

- opens remote rule or remote workflow pseudo-files using `remote://workflow/{name}`

Why it matters:

- remote workflow viewing must be removed without breaking remote rules.

### 5. UI surfaces

#### `webview-ui/src/components/cline-rules/ClineRulesToggleModal.tsx`

Current role:

- shows tabs for rules / workflows / hooks / skills
- refreshes workflow toggles
- lists local/global/remote workflows
- toggles workflow enablement

Why it matters:

- largest visible workflow UI surface in the extension.

#### `webview-ui/src/context/ExtensionStateContext.tsx`
#### `src/shared/ExtensionMessage.ts`
#### `src/core/controller/index.ts`

Current role:

- extension state includes workflow toggle fields
- controller posts those workflow fields to the webview
- front-end holds setters and defaults for them

Why it matters:

- the workflow state model is threaded end-to-end through the app.

#### CLI config UI

Relevant files:

- `cli/src/components/App.tsx`
- `cli/src/components/ConfigView.tsx`
- `cli/src/components/ConfigViewWrapper.tsx`
- `cli/workspaceState.json`

Current role:

- CLI config includes workflow props and workflow tab handling
- workflow toggles are surfaced and editable in the CLI

Why it matters:

- removal must include CLI parity, not just VS Code UI.

### 6. Remote config / enterprise path

#### `src/shared/remote-config/schema.ts`
#### `src/core/storage/remote-config/utils.ts`

Current role:

- schema accepts `globalWorkflows`
- state transform maps it to `remoteGlobalWorkflows`
- remote workflow toggles are synchronized

Why it matters:

- enterprise-managed workflows are first-class today.
- if not removed, the backend/remote config could still reintroduce behavior unexpectedly.

### 7. Protocol / transport layer

#### `proto/cline/file.proto`

Current role:

- defines `toggleWorkflow` RPC
- defines `ToggleWorkflowRequest`
- adds workflow toggle fields to `RefreshedRules`

Why it matters:

- generated TS/Go/etc. code will need regeneration when the contract changes.

### 8. Tests and documentation

#### Tests

Key known files:

- `src/test/slash-commands.test.ts`
- `src/core/slash-commands/__tests__/index.test.ts`
- remote-config schema tests
- likely UI and CLI tests if any reference workflows implicitly

#### Documentation

Key known files:

- `docs/customization/workflows.mdx`
- `docs/customization/overview.mdx`
- `docs/core-workflows/using-commands.mdx`
- `docs/cline-cli/interactive-mode.mdx`
- `docs/cline-cli/configuration.mdx`
- `docs/docs.json`
- additional references found via repo search

Why it matters:

- this feature is described as a first-class customization system.
- docs and product messaging must reflect the new reality.

---

## High-level implementation phases

## Phase 0: Prep and safety checks

- [x] Create a dedicated branch for workflow removal work.
- [x] Capture a fresh repo-wide search snapshot for workflow references.
- [ ] Confirm product decision on remote-config compatibility strategy:
  - ignore legacy `globalWorkflows` silently, or
  - reject it at schema level.
- [ ] Confirm whether old workflow files should simply be ignored or whether the UI should show a one-time informational notice.
- [ ] Confirm whether developers want the plan split across multiple PRs or done in a single coordinated PR.

### Recommended PR strategy

Preferred sequence:

1. **PR 1:** runtime/parser + state + proto changes
2. **PR 2:** UI/CLI removal
3. **PR 3:** remote-config/docs/tests cleanup
4. **PR 4 (optional):** migration/cleanup hardening if needed after QA

This is not required, but it lowers review risk.

---

## Phase 1: Remove workflow execution from slash-command runtime

### Goal

Make it impossible for a user-defined workflow markdown file to execute as a slash command.

### Files

- `src/core/slash-commands/index.ts`
- `src/core/task/index.ts`
- possibly any helper signatures that pass workflow toggle state into parsing

### Work

- [x] In `src/core/slash-commands/index.ts`, remove workflow-related types:
  - `FileBasedWorkflow`
  - `RemoteWorkflow`
  - `Workflow`
- [x] Remove workflow collection logic for:
  - local workflow toggles
  - global workflow toggles
  - remote workflow config
- [x] Remove the matching branch that reads workflow file contents and injects them into `<explicit_instructions type="...">...`.
- [x] Keep built-in slash command behavior intact.
- [x] Keep MCP prompt slash commands intact.
- [x] Simplify `parseSlashCommands()` signature if workflow toggle arguments are no longer needed.
- [x] Update all `parseSlashCommands()` call sites accordingly.
- [x] In `src/core/task/index.ts`, remove the workflow toggle refresh and any workflow arguments passed into parsing.

### Why this phase matters

This is the true feature kill switch. Once this phase is complete, even if some UI still references workflows, the product no longer executes them.

### Developer notes

After this phase, `/some-workflow.md` should behave like an unknown slash command, not like explicit instructions.

---

## Phase 2: Remove workflow discovery from available slash commands and autocomplete

### Goal

Make workflow commands disappear from command lists, validation, autocomplete, and slash-command UI.

### Files

- `src/core/controller/slash/getAvailableSlashCommands.ts`
- `webview-ui/src/utils/slash-commands.ts`
- `webview-ui/src/components/chat/ChatTextArea.tsx`
- `webview-ui/src/components/chat/SlashCommandMenu.tsx`

### Work

- [x] In `getAvailableSlashCommands.ts`, remove all logic that appends local/global/remote workflows.
- [x] Ensure only supported built-in commands (and any intended remaining categories such as MCP prompt commands if applicable to that path) remain.
- [x] In `webview-ui/src/utils/slash-commands.ts`, remove:
  - `getWorkflowCommands()`
  - workflow toggle parameters from helper signatures
  - remote workflow parameter usage
  - workflow command merging logic
- [x] Update `getMatchingSlashCommands()` and `validateSlashCommand()` to work without workflow inputs.
- [x] In `ChatTextArea.tsx`, remove workflow toggle and remote workflow arguments passed to slash-command helper functions.
- [x] In `SlashCommandMenu.tsx`, remove:
  - workflow-related props
  - “Workflow Commands” section rendering
- [x] Verify built-in slash command selection still works.
- [x] Verify MCP prompt slash command suggestions still work.

### Why this phase matters

Without this phase, users may still see ghost workflow entries or stale command sections even though workflows no longer execute.

---

## Phase 3: Remove workflow state, storage keys, and refresh logic

### Goal

Eliminate workflow-specific persistent state and directory synchronization.

### Files

- `src/core/context/instructions/user-instructions/workflows.ts`
- `src/core/storage/disk.ts`
- `src/shared/storage/state-keys.ts`
- `src/core/task/index.ts`
- any state posting / reading sites

### Work

- [x] Delete `src/core/context/instructions/user-instructions/workflows.ts` if nothing else depends on it.
- [x] Remove `ensureWorkflowsDirectoryExists()` from `src/core/storage/disk.ts`.
- [x] Remove `GlobalFileNames.workflows` from `disk.ts` if no other feature needs it.
- [x] Remove workflow-related state keys from `src/shared/storage/state-keys.ts`:
  - `workflowToggles`
  - `globalWorkflowToggles`
  - `remoteWorkflowToggles`
  - `remoteGlobalWorkflows`
- [x] Remove any inclusion of those keys in local/global/remote state unions or helper arrays.
- [x] Check generated state/proto code implications and regenerate anything required by project scripts.
- [x] Remove workflow state from any defaults, setters, getters, caches, or serialization code.

### Compatibility decision

Choose one:

#### Option A: tolerant cleanup (recommended)

- remove workflow fields from runtime types and usage,
- allow old persisted JSON to contain stale workflow keys that are simply ignored.

Why recommended:

- lowest risk for users upgrading from older versions,
- avoids crashing on old storage,
- simpler operationally.

#### Option B: explicit migration cleanup

- write a migration that deletes workflow-related stored keys from global/workspace state.

Why you might choose it:

- cleaner state footprint,
- more deliberate product cleanup.

Risk:

- slightly more moving parts.

### Recommendation

Use **Option A** unless product has a strong need to actively scrub stale state.

---

## Phase 4: Remove workflow branches from shared file-management flows

### Goal

Preserve rule management while deleting workflow-specific branches from shared helpers.

### Files

- `src/core/controller/file/createRuleFile.ts`
- `src/core/controller/file/deleteRuleFile.ts`
- `src/core/context/instructions/user-instructions/rule-helpers.ts`
- any callers that pass `type: "workflow"`

### Work

- [x] In `createRuleFile.ts`, remove the `request.type === "workflow"` branch.
- [ ] Decide whether `RuleFileRequest.type` remains generic for other rule families or should be narrowed.
- [x] In `rule-helpers.ts`, remove workflow-specific creation logic:
  - global workflow directory path creation
  - local `.clinerules/workflows` path creation
  - any `default-workflows.md` conversion behavior
- [x] In `rule-helpers.ts`, remove workflow-specific deletion logic:
  - deleting entries from `globalWorkflowToggles`
  - deleting entries from `workflowToggles`
- [x] In `deleteRuleFile.ts`, remove messaging and branching that treats workflow as a valid file type.
- [x] Search for any remaining callers using `type: "workflow"` and remove or refactor them.

### Why this phase matters

Workflow support is currently intertwined with rule file plumbing. Leaving stale branches behind makes the code misleading and error-prone.

### Layperson explanation

Some of the code treats “rules” and “workflows” as cousins handled by the same machinery. We want to keep the “rules” side of that machinery and carefully remove only the “workflow” side.

---

## Phase 5: Remove workflow RPCs, proto fields, and controller handlers

### Goal

Shrink the application contract so workflows are no longer part of the extension’s API surface.

### Files

- `proto/cline/file.proto`
- generated protobuf outputs
- `src/core/controller/file/toggleWorkflow.ts`
- `src/core/controller/file/refreshRules.ts`
- file-service client usage in UI/CLI

### Work

- [x] Remove `toggleWorkflow` RPC from `proto/cline/file.proto`.
- [x] Remove `ToggleWorkflowRequest` message.
- [x] Remove workflow fields from `RefreshedRules`.
- [x] Regenerate protobuf code / bindings using the project’s normal proto generation flow.
- [x] Delete `src/core/controller/file/toggleWorkflow.ts`.
- [x] Update `refreshRules.ts` so it no longer refreshes or returns workflow toggles.
- [x] Update any generated TS imports in webview / CLI / core that referenced removed proto fields or requests.

### Important note

This phase will have broad compile fallout. That is expected. Do not “patch around” generated type errors with `any`; remove the workflow usage properly from call sites.

---

## Phase 6: Remove workflow UI from the VS Code webview

### Goal

Remove all workflow-specific controls from the extension UI while keeping rules/skills/hooks intact.

### Files

- `webview-ui/src/components/cline-rules/ClineRulesToggleModal.tsx`
- `webview-ui/src/context/ExtensionStateContext.tsx`
- `src/shared/ExtensionMessage.ts`
- `src/core/controller/index.ts`
- `webview-ui/src/components/chat/ChatTextArea.tsx`
- `webview-ui/src/components/chat/SlashCommandMenu.tsx`

### Work

- [x] In `ClineRulesToggleModal.tsx`, remove the Workflows tab completely.
- [x] Remove workflow refresh handling from modal open.
- [x] Remove local/global/remote workflow lists.
- [x] Remove workflow toggle handlers.
- [x] Remove remote workflow rendering and open behavior.
- [x] Update tab labels / descriptions / empty states so the UI still reads naturally without workflows.
- [x] In `ExtensionStateContext.tsx`, remove workflow state fields, setters, and defaults.
- [x] In `src/shared/ExtensionMessage.ts`, remove workflow-related fields from `ExtensionState`.
- [x] In `src/core/controller/index.ts`, stop posting workflow state to the webview.
- [x] Verify rules tab still works.
- [x] Verify hooks and skills tabs still work.
- [x] Verify the slash-command menu still behaves correctly after workflow section removal.

### Why this phase matters

This is what users see. The product should no longer imply that workflows exist anywhere in the UI.

---

## Phase 7: Remove workflow UI from the CLI configuration interface

### Goal

Keep CLI config functional while removing its workflow concepts.

### Files

- `cli/src/components/App.tsx`
- `cli/src/components/ConfigView.tsx`
- `cli/src/components/ConfigViewWrapper.tsx`
- `cli/workspaceState.json`

### Work

- [x] Remove workflow props from CLI component interfaces.
- [x] Remove workflow entries / workflow tab / workflow toggle rendering from `ConfigView.tsx`.
- [x] Remove `onToggleWorkflow` plumbing.
- [x] Remove dynamic import and handler for `toggleWorkflow` from `ConfigViewWrapper.tsx`.
- [x] Remove workflow default state from `cli/workspaceState.json`.
- [x] Verify rules, hooks, and skills remain navigable and editable in the CLI.

### Why this phase matters

The CLI is a separate product surface. If not cleaned up, it will preserve a confusing half-removed feature.

---

## Phase 8: Remove remote / enterprise workflow support

### Goal

Ensure enterprise remote config cannot define workflows anymore.

### Files

- `src/shared/remote-config/schema.ts`
- `src/core/storage/remote-config/utils.ts`
- `src/core/controller/file/openFile.ts`
- any remote-config tests

### Work

- [x] Remove `globalWorkflows` from the remote config schema.
- [x] Remove `remoteGlobalWorkflows` mapping and transform logic.
- [x] Remove synchronization of `remoteWorkflowToggles`.
- [x] Remove remote workflow opening support from `openFile.ts` while keeping remote rule support.
- [x] Ensure `remote://rule/...` still works if remote rules remain.
- [ ] Decide compatibility strategy for older server payloads.

### Compatibility options

#### Recommended option: tolerate at fetch boundary, ignore at runtime

If old servers may still send `globalWorkflows`, the safest rollout path may be:

- temporarily ignore the field if received, or
- update schema/server in lockstep if the deployment process guarantees that.

Because the schema file warns that server redeploy coordination matters, this decision should be made explicitly.

### Key question for the team

- [ ] Will the API server be updated and deployed in sync with extension changes?

If **yes**, remove schema support cleanly.

If **no**, add a temporary compatibility layer so old payloads do not break clients.

---

## Phase 9: Clean up tests

### Goal

Remove tests for removed behavior and add tests that protect the intended end state.

### Files to inspect closely

- `src/test/slash-commands.test.ts`
- `src/core/slash-commands/__tests__/index.test.ts`
- `src/shared/remote-config/__tests__/schema.test.ts`
- any webview/CLI tests touching workflow props or UI labels

### Work

- [ ] Delete tests asserting local/global/remote workflows appear in available slash commands.
- [ ] Delete tests asserting workflow deduplication behavior.
- [ ] Delete tests asserting remote workflow enable/disable behavior.
- [ ] Update slash-command parser tests so they cover only:
  - built-in commands
  - MCP prompt commands
  - unknown slash commands
- [ ] Add or update tests verifying that unknown custom filenames are **not** treated as valid commands.
- [ ] Remove remote-config schema tests that assert `globalWorkflows` is valid.
- [ ] Update UI/CLI tests or snapshots that mention workflows.

### Recommended new regression tests

- [ ] `parseSlashCommands()` does **not** inject arbitrary markdown from workflow-like filenames.
- [ ] `getAvailableSlashCommands()` returns built-ins only (plus any intentionally retained categories).
- [ ] slash-command menu renders without a workflow section.
- [ ] rules/skills/hooks functionality remains intact.

---

## Phase 10: Remove and rewrite documentation

### Goal

Make product documentation accurately reflect the new customization model.

### Files

Known important files:

- `docs/customization/workflows.mdx`
- `docs/customization/overview.mdx`
- `docs/core-workflows/using-commands.mdx`
- `docs/cline-cli/interactive-mode.mdx`
- `docs/cline-cli/configuration.mdx`
- `docs/docs.json`
- any cross-links or cards referencing `/customization/workflows`

### Work

- [ ] Remove `docs/customization/workflows.mdx` or replace it with a migration notice if docs policy prefers redirects.
- [ ] Remove navigation entries to the workflows doc in `docs/docs.json`.
- [ ] Update overview docs so the customization model becomes:
  - Rules
  - Skills
  - Hooks
  - `.clineignore`
  - (plus built-in slash commands and MCP prompts as separate concepts if desired)
- [ ] Update “Using Commands” docs so only supported slash command categories remain.
- [ ] Remove CLI documentation that tells users how to manage workflows.
- [ ] Remove examples describing `.clinerules/workflows/` as a supported path.
- [ ] Search the entire docs tree for “workflow” references and classify each as:
  - feature reference to remove,
  - generic English use of the word “workflow” that should remain.

### Important note

Do not remove generic English uses of the word “workflow” that refer to normal development processes. Remove only references to the specific product feature.

---

## Phase 11: Optional migration messaging for users

### Goal

Decide how much empathy/product guidance to include for existing users.

### Options

#### Minimal approach

- workflows silently stop working
- docs are updated
- no migration guidance in product

#### Better approach

- add release note / changelog item
- optionally add migration guidance such as:
  - move persistent guidance into rules,
  - move reusable expertise into skills,
  - use built-in slash commands or MCP prompts where appropriate

### Recommendation

If the feature has real users, document migration guidance even if no in-product banner is added.

Possible mapping guidance:

- **workflow that encodes team behavior** → likely a **rule**
- **workflow that encodes deep reusable procedural knowledge** → maybe a **skill**
- **workflow that automates an external action** → maybe an **MCP tool/prompt** or a **hook**, depending on timing

---

## Detailed implementation checklist

## A. Core runtime and parser

- [x] Remove workflow branches from `src/core/slash-commands/index.ts`
- [x] Simplify `parseSlashCommands()` inputs
- [x] Update parser call sites
- [x] Verify built-ins still transform prompts correctly
- [x] Verify MCP prompts still transform prompts correctly

## B. State and storage

- [x] Remove workflow state keys from `src/shared/storage/state-keys.ts`
- [x] Remove workflow path constants from `src/core/storage/disk.ts`
- [x] Remove workflow refresh module and imports
- [ ] Decide whether to add explicit cleanup migration

## C. Shared file-management paths

- [x] Remove workflow creation logic from `rule-helpers.ts`
- [x] Remove workflow deletion logic from `rule-helpers.ts`
- [x] Remove `workflow` branches from `createRuleFile.ts`
- [x] Remove `workflow` branches from `deleteRuleFile.ts`

## D. RPC / proto / controller

- [x] Remove workflow RPC from `proto/cline/file.proto`
- [x] Remove `ToggleWorkflowRequest`
- [x] Remove workflow fields from `RefreshedRules`
- [x] Regenerate proto outputs
- [x] Delete `src/core/controller/file/toggleWorkflow.ts`
- [x] Update imports and clients broken by proto changes

## E. Webview UI

- [x] Remove workflow state from `ExtensionState`
- [x] Remove workflow state from `ExtensionStateContext`
- [x] Stop posting workflow fields from controller to webview
- [x] Remove Workflows tab from `ClineRulesToggleModal.tsx`
- [x] Remove workflow section from `SlashCommandMenu.tsx`
- [x] Remove workflow inputs from `ChatTextArea.tsx`

## F. CLI UI

- [x] Remove workflow props from CLI app components
- [x] Remove workflow tab/view from CLI config
- [x] Remove workflow toggle handler in CLI wrapper
- [x] Remove workflow defaults from CLI workspace state

## G. Remote config

- [x] Remove `globalWorkflows` from schema
- [x] Remove transform/state sync for remote workflows
- [x] Remove remote workflow open-file support
- [ ] Confirm rollout compatibility with API server

## H. Tests

- [x] Delete workflow-specific unit tests
- [x] Update parser tests
- [x] Update remote-config schema tests
- [x] Add “workflows no longer execute” regression coverage

## I. Docs and release notes

- [ ] Remove workflows feature docs
- [ ] Update overview docs and navigation
- [ ] Update CLI docs
- [ ] Add migration note if product wants one

---

## Suggested implementation order for developers

Follow this order to reduce churn and confusion:

1. **Parser/runtime removal**
2. **Available-slash-command removal**
3. **State/storage cleanup**
4. **Proto/controller cleanup**
5. **Webview cleanup**
6. **CLI cleanup**
7. **Remote-config cleanup**
8. **Tests**
9. **Docs**
10. **Final verification and regression sweep**

This sequence works well because early compile errors will point naturally to downstream dependencies.

---

## Debugging guide

### Symptom: `/foo.md` still executes after removal

Likely causes:

- parser still has workflow match logic in `src/core/slash-commands/index.ts`
- stale workflow command is still being passed as valid by autocomplete helper logic
- old tests or mocks are masking behavior

Checks:

- [ ] Search for `<explicit_instructions type="${matchingWorkflow.fileName}">`
- [ ] Search for `remoteGlobalWorkflows`
- [ ] Search for `workflowToggles`
- [ ] Search for `Custom workflow:` and `Remote workflow:`

### Symptom: UI compile errors after proto cleanup

Likely causes:

- webview or CLI still imports removed proto messages
- `RefreshedRules` fields were removed but old code still reads them

Checks:

- [ ] Search for `ToggleWorkflowRequest`
- [ ] Search for `toggleWorkflow(`
- [ ] Search for `globalWorkflowToggles`
- [ ] Search for `localWorkflowToggles`

### Symptom: remote config breaks after removing workflow schema support

Likely causes:

- backend still sends `globalWorkflows`
- schema validation is now stricter than deployed server behavior

Checks:

- [ ] confirm server/client rollout coordination
- [ ] verify compatibility strategy was implemented intentionally

### Symptom: rules file management breaks unexpectedly

Likely causes:

- shared helper cleanup accidentally removed rule logic while deleting workflow branches

Checks:

- [ ] create a new rule file
- [ ] delete a rule file
- [ ] toggle local/global rules
- [ ] confirm no workflow-specific branching remains in the rule path

---

## Verification plan

Use the project’s existing scripts where possible.

### Repo-level verification

Run:

- [x] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm run compile`
- [ ] `npm test`

### Targeted subproject verification

Run if needed while iterating:

- [x] `cd webview-ui && npm test`
- [x] `cd cli && npm run typecheck`
- [x] `cd cli && npm run test:run`

### Manual product verification

#### Slash commands

- [ ] `/newtask` still works
- [ ] `/smol` still works
- [ ] `/compact` still works
- [ ] `/newrule` still works
- [ ] `/deep-planning` still works
- [ ] `/reportbug` still works
- [ ] `/explain-changes` still works where supported
- [ ] `/mcp:server:prompt` still works when MCP prompts are available
- [ ] `/release.md` or any fake workflow filename does **not** execute custom instructions

#### Rules / hooks / skills

- [ ] local rules still load
- [ ] global rules still load
- [ ] remote rules still load if supported
- [ ] hooks tab still works
- [ ] skills tab still works
- [ ] toggling rules/skills/hooks still works

#### UI

- [x] no Workflows tab appears in the webview rules modal
- [ ] no workflow section appears in slash-command autocomplete
- [x] no workflow controls appear in CLI config

#### Remote config

- [x] remote rules still work
- [ ] remote workflow payloads are either ignored safely or no longer accepted, per chosen rollout plan

---

## Acceptance criteria

The removal is complete when all of the following are true:

- [ ] no user-defined markdown file can be invoked as a slash command
- [x] no workflow-specific state keys are required by runtime code
- [x] no workflow UI remains in webview or CLI
- [x] no workflow-specific RPC or proto messages remain
- [x] remote config cannot activate workflows anymore
- [ ] docs no longer describe workflows as a feature
- [x] tests and compile output are green
- [ ] rules, skills, hooks, built-in slash commands, and MCP prompt slash commands still work

---

## Risks and mitigations

### Risk 1: stale persisted state causes upgrade issues

Mitigation:

- prefer tolerant runtime cleanup or explicit migration,
- test upgrade from a state snapshot containing workflow keys.

### Risk 2: remote-config rollout mismatch

Mitigation:

- coordinate extension and server deployment,
- decide compatibility behavior before coding.

### Risk 3: accidental rule regression from shared-helper edits

Mitigation:

- isolate workflow branch deletions carefully,
- manually verify rule creation/deletion/toggling.

### Risk 4: hidden references survive in docs/UI/tests

Mitigation:

- do a final repo-wide search for:
  - `workflowToggles`
  - `globalWorkflowToggles`
  - `remoteWorkflowToggles`
  - `remoteGlobalWorkflows`
  - `ToggleWorkflowRequest`
  - `toggleWorkflow`
  - `/customization/workflows`
  - `Workflow Commands`
  - `Custom workflow:`
  - `.clinerules/workflows`

---

## Final repo-wide search checklist

Before merging, run and confirm each search is either empty or only returns intentional historical references such as changelog entries:

- [ ] `workflowToggles`
- [ ] `globalWorkflowToggles`
- [ ] `remoteWorkflowToggles`
- [ ] `remoteGlobalWorkflows`
- [ ] `globalWorkflows`
- [ ] `ToggleWorkflowRequest`
- [ ] `toggleWorkflow`
- [ ] `refreshWorkflowToggles`
- [ ] `ensureWorkflowsDirectoryExists`
- [ ] `GlobalFileNames.workflows`
- [ ] `/customization/workflows`
- [ ] `Workflow Commands`
- [ ] `Custom workflow:`
- [ ] `Remote workflow:`
- [ ] `.clinerules/workflows`

---

## Recommended deliverables

By the end of implementation, the team should expect:

- [ ] code changes removing workflow support end-to-end
- [ ] regenerated proto/generated types if contracts changed
- [ ] updated tests
- [ ] updated docs and navigation
- [ ] migration/release note decision documented
- [ ] final QA verification evidence

---

## Short summary for stakeholders

This change removes a feature that turned markdown files into custom slash commands. The important architectural point is that workflows are woven into slash-command parsing, UI discovery, storage, remote config, and file-management paths. Because of that, the correct removal is a careful end-to-end cleanup rather than a cosmetic hide.

If this plan is followed, the product will end up simpler and more coherent: rules, skills, hooks, built-in slash commands, and MCP prompts remain; user-defined workflow slash commands disappear completely.
