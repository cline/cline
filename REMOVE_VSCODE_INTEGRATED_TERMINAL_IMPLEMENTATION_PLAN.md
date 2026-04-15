## Remove VS Code Integrated Terminal Dependencies from Cline

### Implementation Plan

---

## Implementation Checklist

- [x] Replace VS Code runtime wiring so Cline uses only the background terminal manager
- [x] Remove the `@terminal` mention from parser, runtime expansion, UI, docs, and tests
- [x] Remove the VS Code terminal-output-to-chat command and terminal context-menu contribution
- [x] Remove the integrated-terminal-based CLI install flow and its remaining UI entry points
- [x] Delete the old VS Code integrated-terminal implementation files after all live references are gone
- [x] Update tests, docs, comments, and developer-facing references to reflect the new architecture
- [x] Run validation, debugging, and regression checks until the extension is stable
- [x] Perform a final search-based audit to confirm no live integrated-terminal dependency remains

> Status update (2026-04-15): Phases 1-5 are implemented. Automated validation completed with `npm run check-types`, `npm run lint`, `npm run build:webview`, `npm run compile`, `npm run test:unit`, `npm run test:webview`, and `npm run test:integration`. Remaining references are intentional compatibility/generated/dev-only scaffolding rather than live VS Code integrated-terminal product behavior.
>
> Follow-up note: this document predates the separate removal of the remaining **Terminal Settings** UI and its two persisted settings (`terminalReuseEnabled`, `terminalOutputLineLimit`) from the VS Code extension. That follow-up work is tracked independently in `REMOVE_TERMINAL_SETTINGS_IMPLEMENTATION_PLAN.md` and supersedes the “leave those settings in place” guidance below for the VS Code extension.

---

## 1. Purpose of This Document

This document is a standalone implementation guide for removing every **user-visible** and **runtime** dependency on the **VS Code integrated terminal** from the Cline VS Code extension, while intentionally **leaving behind benign compatibility scaffolding** wherever deleting it would cause unnecessary churn.

In simpler terms:

- We want Cline in VS Code to stop depending on VS Code’s foreground/integrated terminal.
- We want the extension to rely only on Cline’s **background terminal implementation** for its own command execution.
- We want to remove the `@terminal` feature and any other user-facing terminal-context features built on top of the integrated terminal.
- We do **not** want to turn this into a broad refactor of every shared abstraction in the codebase.

This is a **subtractive migration**. We are removing behavior, removing wiring, and deleting dead code. We are **not** redesigning the terminal system from scratch.

Another way to say this: the project is not trying to invent a better integrated terminal. It is trying to stop Cline from depending on VS Code's integrated terminal at all. That distinction matters because it keeps the team focused on safe deletions rather than drifting into a redesign project.

---

## 2. Architectural Vision Overview

### 2.1 The high-level idea

The target end state is:

1. **Cline’s own terminal work in VS Code uses only the background terminal path**.
2. **Users no longer see or use `@terminal`**.
3. **Users no longer have a VS Code terminal-context action that copies integrated terminal output into chat**.
4. **Cline no longer needs the old VS Code integrated-terminal capture stack**.
5. **Any leftover shared compatibility types or generated RPC/proto surfaces may remain temporarily if they are harmless and unused**.

### 2.2 Why this is the right approach

The repository already shows that task command execution has effectively moved in this direction:

- In `src/core/task/index.ts`, the `Task` class already sets:
  - `this.terminalExecutionMode = "backgroundExec"`
  - `this.terminalManager = new StandaloneTerminalManager()`

That means the live execution path is already background-first for task command execution. The remaining integrated-terminal code is mostly **legacy residue**:

- old VS Code terminal manager/process/registry code
- `@terminal`
- terminal-output-to-chat command
- host bridge helpers that focus or create VS Code terminals
- UI surfaces that still expose those capabilities

Because the new behavior already exists, the safest plan is to:

- **stop instantiating the old path**,
- **remove every feature that depends on it**,
- **delete the dead concrete implementation**,
- and **avoid broad cleanup of shared abstractions unless absolutely necessary**.

This is important for engineering risk. In mature codebases, “remove a feature” often becomes dangerous when the team also tries to “clean up everything related to it” in the same pass. This plan deliberately separates those two concerns:

- first, remove the live behavior and user-visible surfaces
- then, delete dead concrete code
- and only later, if desired, simplify shared abstractions in a separate cleanup effort

That sequencing keeps the blast radius small and makes regressions easier to diagnose.

### 2.3 Architectural mental model

Developers implementing this plan should keep the following mental model in mind.

There are really **two different terminal concerns** in the codebase:

1. **How Cline executes commands**
2. **How Cline exposes terminal-related features to users**

Historically, those concerns were partially mixed together in the VS Code extension because the integrated terminal was both:

- a place where commands could run, and
- a source of user-facing context (for example, `@terminal` or terminal-selection-to-chat)

The target architecture separates those concerns much more cleanly:

- **command execution** should use Cline’s background terminal implementation
- **user-facing terminal context features** built on the VS Code terminal should be removed

That means the project is not simply deleting a folder. It is untangling a concept:

- Cline still needs terminal execution as a capability
- but it should no longer need the **VS Code integrated terminal** as a product dependency

That is why some terminal settings and shared orchestration code remain in scope, while integrated-terminal capture and UI features do not.

---

## 3. Scope, Non-Goals, and Safety Rules

## 3.1 In scope

This plan covers:

- removing `@terminal`
- removing the VS Code terminal-output-to-chat command
- removing runtime use of `VscodeTerminalManager`
- removing the VS Code integrated-terminal capture stack
- removing UI, docs, tests, and manifests that expose those features
- removing integrated-terminal-based CLI install UX if it is the last user-visible dependency

## 3.2 Out of scope

This plan does **not** aim to:

- redesign the background terminal implementation
- simplify every shared terminal interface immediately
- regenerate proto/grpc surfaces unless required for build correctness
- remove background terminal settings that still matter (`terminalReuseEnabled`, `terminalOutputLineLimit`) *(superseded for the VS Code extension by `REMOVE_TERMINAL_SETTINGS_IMPLEMENTATION_PLAN.md`)*
- change CLI or JetBrains terminal architecture beyond what is needed to keep shared code building

## 3.3 Safety rule: what we are allowed to leave behind

We are intentionally allowed to leave behind **unused but harmless scaffolding** if deleting it would create unnecessary cross-cutting work.

Examples of scaffolding that can remain temporarily if unused:

- the `"vscodeTerminal" | "backgroundExec"` type union
- shared interface fields like `waitForShellIntegration`
- shared events like `no_shell_integration`
- telemetry enum values related to VS Code shell integration
- generated host bridge/proto method definitions

These are not the product behavior. The product behavior is determined by the runtime wiring and user-facing features.

This rule exists to keep the implementation practical. For example, if a generated RPC interface still contains an `openTerminalPanel` method but no live runtime code calls it, that is not a product problem. It may be a cleanup opportunity later, but it should not block this initiative.

---

## 4. Current State Summary

This section summarizes how the relevant architecture works today.

### 4.1 Task command execution

Relevant file:

- `src/core/task/index.ts`

Current behavior:

- the task runtime explicitly chooses `backgroundExec`
- the task constructs a `StandaloneTerminalManager`
- terminal reuse and terminal output line limit are still configured on that manager

Why this matters:

- it means the core task execution path is already using the background implementation
- therefore the integrated-terminal removal is mainly a cleanup and consolidation effort, not a new execution-mode migration

From a planning standpoint, this is the single most important fact in the repository. It means the development team does not need to first invent a new way for Cline to run commands in VS Code. That work has already happened. The current initiative is mostly about removing the old path and any feature that still assumes the old path exists.

### 4.2 Extension bootstrap still carries old terminal wiring

Relevant file:

- `src/extension.ts`

Current behavior:

- the VS Code extension still imports `VscodeTerminalManager`
- HostProvider wiring still creates a VS Code terminal manager instance
- the extension still registers a terminal-output command that copies from the active VS Code terminal selection

Why this matters:

- even if task execution is already background-first, the extension bootstrap still advertises and supports integrated-terminal behavior
- we must align the bootstrap wiring with the real architectural direction

This is a classic example of architectural drift: a system’s live behavior evolves first, but the bootstrapping and supporting code still tells an older story. One of the goals of this work is to make the codebase tell the truth again.

### 4.3 `@terminal` is a special context mention

Relevant files:

- `src/shared/context-mentions.ts`
- `src/core/mentions/index.ts`
- `webview-ui/src/utils/context-mentions.ts`
- `webview-ui/src/components/chat/ChatTextArea.tsx`
- `webview-ui/src/components/chat/ContextMenu.tsx`
- `webview-ui/src/config/platform-configs.json`

Current behavior:

- `@terminal` is recognized by the shared mention regex
- the chat UI can offer a Terminal option in the mention menu
- selecting it inserts `@terminal`
- parsing that mention tries to fetch terminal content from the VS Code integrated terminal via clipboard-based capture
- clicking the rendered mention tries to focus the VS Code terminal panel

Why this matters:

- `@terminal` is one of the clearest user-facing dependencies on the integrated terminal
- removing it is central to the vision

It is helpful to think of `@terminal` as a pipeline, not a single feature:

1. the text parser recognizes it
2. the chat UI knows how to suggest and insert it
3. the mention-expansion logic knows how to resolve it
4. the VS Code host knows how to fetch integrated terminal contents
5. the click/open behavior knows how to focus the terminal panel

Because the feature spans multiple layers, it must be removed deliberately layer by layer. If only one layer is removed, the remaining layers tend to become confusing dead code or misleading UI.

### 4.4 Terminal-output-to-chat is another integrated-terminal feature

Relevant files:

- `src/extension.ts`
- `src/registry.ts`
- `package.json`

Current behavior:

- VS Code contributes a terminal context menu action
- that action copies selected text from the active VS Code terminal into Cline chat

Why this matters:

- it is another explicit product feature built on the integrated terminal
- if the integrated terminal is no longer part of Cline’s UX, this command should go away too

This feature is easy to underestimate because it looks small in the UI. Architecturally, though, it is significant because it preserves the idea that “the active VS Code terminal is a first-class source of Cline context.” The end-state vision intentionally rejects that idea.

### 4.5 CLI install still uses a visible terminal execution helper

Relevant files:

- `src/core/controller/state/installClineCli.ts`
- `src/hosts/vscode/hostbridge/workspace/executeCommandInTerminal.ts`
- `webview-ui/src/components/common/ClineKanbanLaunchModal.tsx`
- `webview-ui/src/components/chat/chat-view/components/layout/WelcomeSection.tsx`
- `src/shared/cline/banner.ts`

Current behavior:

- the “install Cline CLI” flow calls `HostProvider.workspace.executeCommandInTerminal(...)`
- in VS Code, that helper creates a new visible integrated terminal and runs `npm install -g cline`
- UI surfaces still expose this install action

Why this matters:

- if the vision is “remove every user-visible and runtime dependency on the VS Code integrated terminal,” this is the last major remaining exception
- to fully satisfy the vision, this UX should be removed in the same initiative unless product explicitly wants a separate replacement feature later

This is the most likely place for scope confusion. The team may be tempted to preserve the CLI install flow by immediately replacing it with a new mechanism. That is possible, but it is not necessary to achieve the architectural goal. The lowest-risk approach is to remove the flow now and only reintroduce it later if product still wants it.

---

## 5. Required Implementation Pattern

This initiative should follow one consistent pattern:

### Pattern: Remove behavior first, leave compatibility residue only where necessary

In practical terms:

1. **Stop using the old code path**.
2. **Remove all UI surfaces that expose it**.
3. **Remove parser/runtime call sites that depend on it**.
4. **Delete dead implementation files once no live code references them**.
5. **Do not spend time simplifying broad shared abstractions unless a compiler or runtime error forces it**.

This pattern keeps risk low because the team is not trying to “clean everything” at once.

For developers, the practical decision rule is:

> If deleting a thing removes live behavior or user-visible confusion, do it now.
> If deleting a thing only makes the architecture cosmetically cleaner but expands the change surface, defer it.

That rule should guide ambiguous cases throughout implementation.

---

## 6. End-State Requirements

At the end of this work, all of the following should be true:

- [x] The VS Code extension no longer instantiates `VscodeTerminalManager`
- [x] The VS Code extension no longer exposes `@terminal`
- [x] The mention regex no longer recognizes `@terminal`
- [x] The chat mention menu no longer offers Terminal
- [x] Clicking mention highlights no longer supports terminal mentions
- [x] The VS Code terminal context menu no longer offers “Add to Cline” for terminal output
- [x] The extension no longer copies terminal output from the active integrated terminal
- [x] The extension no longer focuses the integrated terminal on behalf of `@terminal`
- [x] The extension no longer creates a visible VS Code terminal for Cline CLI installation
- [x] No production code depends on `src/hosts/vscode/terminal/*`
- [x] Remaining terminal settings still work for background execution
- [x] The extension still builds and core command-execution behavior still works

---

## 7. Step-by-Step Implementation Plan

## Phase 0 — Preflight and branch setup

### Goal

Establish a clean working baseline before removals begin.

### Tasks

- [x] Ensure the repo builds before any changes
- [x] Run targeted search commands to capture a before-state inventory

### Suggested verification commands

```bash
npm run check-types
npm run lint
npm run test:unit
```

If the team wants a full extension build check up front:

```bash
npm run compile
```

### Why this matters

Because this initiative removes code from several layers at once. Starting from a known-good baseline makes it far easier to distinguish new breakage from pre-existing issues.

This is especially important here because some of the code being removed sits near shared abstractions. If a developer encounters a failure after the first deletion, they need confidence that the failure is a consequence of the removal, not a background issue that happened to already exist.

---

## Phase 1 — Make the background terminal the only live VS Code runtime path

### Goal

Ensure the VS Code extension bootstrap no longer creates the old integrated-terminal manager.

### Files

- `src/extension.ts`

### Required changes

- [x] Replace the `VscodeTerminalManager` import with `StandaloneTerminalManager`
- [x] Update the HostProvider terminal-manager factory to construct `StandaloneTerminalManager`
- [x] Remove any now-unused `VscodeTerminalManager` imports

### Why this comes first

This is the most important architectural lock-in step. Once the extension bootstrap no longer creates the old manager, the old integrated-terminal stack becomes an implementation detail with no legitimate runtime owner.

Said differently: this step changes the answer to the question, “What terminal implementation is the VS Code extension supposed to use?” After this step, the answer becomes unambiguous.

### Why we are confident

Because `Task` already uses `StandaloneTerminalManager` in `backgroundExec` mode. This change aligns top-level wiring with the runtime reality that already exists.

### Verification

- [x] Search for production instantiations of `VscodeTerminalManager`
- [x] Confirm there are no remaining `new VscodeTerminalManager()` calls outside tests or dead files
- [x] Validate command execution via automated build/unit/integration coverage

### Helpful search

```text
VscodeTerminalManager
createTerminalManager
backgroundExec
```

---

## Phase 2 — Remove `@terminal` end-to-end

### Goal

Remove the terminal mention as a concept from parsing, runtime expansion, click behavior, UI insertion, docs, and tests.

### 2A. Remove parser-level support

#### Files

- `src/shared/context-mentions.ts`
- `src/core/mentions/index.ts`

#### Required changes

- [x] In `src/shared/context-mentions.ts`, remove `terminal\b` from the shared mention regex
- [x] Update the explanatory comments so terminal is no longer described as a special mention
- [x] In `src/core/mentions/index.ts`, remove the import of `getLatestTerminalOutput`
- [x] Remove the `openMention()` branch for `mention === "terminal"`
- [x] Remove the text replacement branch that converts `@terminal` into `Terminal Output (see below for output)`
- [x] Remove the branch that appends `<terminal_output>...</terminal_output>`
- [x] Remove terminal mention telemetry capture paths from this module

#### Why this matters

This is the canonical behavior removal. Once the parser no longer recognizes `@terminal`, the feature is effectively gone at the model/context layer.

Developers should notice a subtle but important property here: mention parsing is not just a UI concern. The parser is part of how user text becomes model context. That means leaving parser support in place after removing the UI would still leave a hidden product feature behind.

### 2B. Remove mention-menu and insertion support

#### Files

- `webview-ui/src/utils/context-mentions.ts`
- `webview-ui/src/components/chat/ChatTextArea.tsx`
- `webview-ui/src/components/chat/ContextMenu.tsx`
- `webview-ui/src/config/platform-configs.json`
- `webview-ui/src/config/platform.config.ts`

#### Required changes

- [x] Remove `ContextMenuOptionType.Terminal`
- [x] Remove Terminal from `getContextMenuEntries()`
- [x] Remove `supportsTerminalMentions` from the platform config JSON and TS types
- [x] Remove Terminal from chat `queryItems`
- [x] Remove Terminal handling from mention selection code
- [x] Remove Terminal-specific labels/icons/render branches in the context menu

#### Important detail: fix the `@term...` dead spot

In `webview-ui/src/utils/context-mentions.ts`, update `shouldShowContextMenu()`:

- [x] Remove the special case that suppresses the menu when the current token starts with `terminal`

Why this is important:

Today the UI hides the menu because `@terminal` is a reserved keyword. After removal, keeping that rule would create confusing behavior where users type `@term...` and the menu disappears for no valid reason.

This is exactly the kind of bug that shows up after removals if developers only think about the “main path.” The goal is not just to remove features; it is to leave the remaining user experience coherent.

### 2C. Remove docs and tests for `@terminal`

#### Files

- `docs/core-workflows/working-with-files.mdx`
- `docs/getting-started/what-is-cline.mdx`
- any other docs mentioning terminal output as an `@` mention
- `src/shared/__tests__/context-mentions.test.ts`
- `src/core/mentions/index.test.ts`
- `webview-ui/src/utils/__tests__/context-mentions.test.ts`
- any UI tests that assert Terminal appears in the mention menu

#### Required changes

- [x] Remove `@terminal` from quick-reference tables and examples
- [x] Remove test cases that expect `@terminal` to parse successfully
- [x] Remove test cases that expect Terminal to appear in the mention picker
- [x] Remove terminal-specific stubbing/imports from mention tests

### Verification

- [x] Typing `@` no longer shows Terminal in the mention menu
- [x] Typing `@term` does not suppress the menu unexpectedly
- [x] Parser tests no longer reference `@terminal`
- [x] Search for `@terminal` shows only intentional historical references, if any

If `@terminal` still appears anywhere after this phase, developers should classify each occurrence carefully:

- **live product behavior** → must be removed now
- **test text or docs that describe removed behavior** → should be updated now
- **historical changelog/reference material** → may be acceptable if clearly historical

---

## Phase 3 — Remove “Add terminal output to Cline” from VS Code

### Goal

Remove the user-facing command that copies text from the active integrated terminal into chat.

### Files

- `src/extension.ts`
- `src/registry.ts`
- `package.json`

### Required changes

- [x] Remove the `commands.TerminalOutput` registration block from `src/extension.ts`
- [x] Remove `TerminalOutput` from `src/registry.ts`
- [x] Remove the `cline.addTerminalOutputToChat` command contribution from `package.json`
- [x] Remove the `terminal/context` menu contribution for that command from `package.json`
- [x] Remove any unused clipboard imports left behind in `src/extension.ts`

### Why this matters

Even if `@terminal` is gone, this command is still an integrated-terminal UX. Removing it is necessary to make the product behavior match the architectural vision.

This is one of the clearest examples of why “remove runtime dependency” and “remove user-visible dependency” are separate but related goals. Even if command execution is already background-only, a terminal context-menu action still teaches users that Cline integrates with the foreground terminal as a normal workflow.

### Verification

- [x] The terminal context menu no longer shows the command
- [x] Command palette no longer exposes the command
- [x] Search for `addTerminalOutputToChat` returns no live command registration or manifest entry

---

## Phase 4 — Remove the integrated-terminal-based CLI install flow

### Goal

Eliminate the last meaningful user-visible feature that still asks VS Code to create and use a visible integrated terminal on Cline’s behalf.

### Important assumption

This plan assumes the team wants the **full vision**: no user-visible or runtime dependency on the VS Code integrated terminal.

Under that assumption, the simplest and safest implementation is to **remove** the install-CLI flow rather than replace it with new execution logic during this project.

If product later wants to keep CLI installation, it should be reintroduced as a separate feature with a new implementation that does not depend on the integrated terminal.

This deserves emphasis: treating feature preservation as a later product decision is not avoiding the problem. It is an intentional risk-management choice. The implementation plan is optimized to complete the removal cleanly first.

### Files likely involved

- `src/core/controller/state/installClineCli.ts`
- `src/hosts/vscode/hostbridge/workspace/executeCommandInTerminal.ts`
- `webview-ui/src/components/common/ClineKanbanLaunchModal.tsx`
- `webview-ui/src/components/chat/chat-view/components/layout/WelcomeSection.tsx`
- `webview-ui/src/services/grpc-client.ts`
- `src/shared/cline/banner.ts`
- possibly banner-related state/update files if no longer needed:
  - `src/core/controller/state/updateCliBannerVersion.ts`
  - `src/shared/storage/state-keys.ts`
  - `src/shared/ExtensionMessage.ts`
  - controller state payload code that carries `lastDismissedCliBannerVersion`

### Required changes

#### 4A. Remove the backend action

- [x] Remove or retire `installClineCli` from the controller/state layer
- [x] Remove the only runtime caller(s) that trigger it

#### 4B. Remove the UI entry points

- [x] Remove install-triggering behavior from `ClineKanbanLaunchModal.tsx`
- [x] Remove banner actions in `WelcomeSection.tsx` that call `StateServiceClient.installClineCli({})`
- [x] Remove or replace `BannerActionType.InstallCli` if it is no longer used anywhere meaningful
- [x] Remove CLI install banners/cards/messages if they are no longer relevant

#### 4C. Decide how much banner/state residue to keep

Use the minimal-change rule:

- if a state key or deprecated banner-version field can remain harmlessly without affecting users, it may stay for now
- if it causes compile noise or misleading UI, remove it

The recommended order is:

1. remove the visible banner/action first
2. confirm nothing reads or writes the old field in a meaningful way
3. then remove old banner-specific state only if low-risk

### What to do about `executeCommandInTerminal`

#### Recommended minimal approach

- [x] Remove all meaningful call sites to `executeCommandInTerminal`
- [x] Leave generated or compatibility contract surfaces alone temporarily if deleting them would force proto churn
- [x] If the handwritten VS Code host implementation file becomes fully unused, convert it to benign compatibility scaffolding instead of regenerating contracts in this pass

In other words: **make it dead first; delete it only when easy**.

That sentence captures the broader strategy of this project. A dead compatibility hook is far less dangerous than a half-removed live feature.

### Why this matters

If this phase is skipped, the extension still contains a live, user-visible path that explicitly creates and uses the VS Code integrated terminal.

### Verification

- [x] No visible UI remains that offers “install Cline CLI” through an integrated terminal
- [x] No runtime code path still calls `HostProvider.workspace.executeCommandInTerminal(...)` for this feature
- [x] Search confirms install-related integrated-terminal dependencies are gone or intentionally quarantined

---

## Phase 5 — Delete the old integrated-terminal implementation files

### Goal

Delete the old VS Code terminal implementation once it has no remaining production call sites.

### Files expected to delete

- `src/hosts/vscode/terminal/VscodeTerminalManager.ts`
- `src/hosts/vscode/terminal/VscodeTerminalProcess.ts`
- `src/hosts/vscode/terminal/VscodeTerminalRegistry.ts`
- `src/hosts/vscode/terminal/get-latest-output.ts`
- `src/hosts/vscode/terminal/ansiUtils.ts` if no longer used anywhere else
- `src/hosts/vscode/terminal/VscodeTerminalProcess.test.ts`
- any other tests that exist only for shell-integration/integrated-terminal behavior

### Preconditions before deletion

- [x] `src/extension.ts` no longer creates `VscodeTerminalManager`
- [x] `src/core/mentions/index.ts` no longer imports `getLatestTerminalOutput`
- [x] the terminal-output command has been removed
- [x] no remaining meaningful runtime feature uses these files

### Why we wait until now

Deleting these files too early makes it harder to distinguish “dead code cleanup” from “live behavior breakage.” Waiting until all references are removed makes the deletion mechanical and safe.

This also improves code review quality. Reviewers can clearly see that the deletion is justified because earlier changes already removed every live caller.

### Verification

- [x] Search for `VscodeTerminalManager` returns no production usage
- [x] Search for `VscodeTerminalProcess` returns no production usage
- [x] Search for `getLatestTerminalOutput` returns no production usage
- [x] Search for `shellIntegration` only returns allowed compatibility references or none at all
- [x] Search for `workbench.action.terminal.selectAll`, `copySelection`, and `clearSelection` no longer finds live Cline runtime code tied to the removed features

---

## Phase 6 — Clean up docs, tests, comments, and obvious stale references

### Goal

Make the codebase understandable again after the behavioral removal.

### Files likely involved

- docs mentioned earlier
- test files mentioned earlier
- comments in terminal modules or shared terminal abstractions that still describe removed VS Code behavior as if it were live
- developer-facing prose in `src/integrations/terminal/index.ts` and `src/integrations/terminal/CommandExecutor.ts`

### Required changes

- [x] Update comments that still claim VS Code integrated terminal is a supported runtime path for Cline task execution
- [x] Update architectural comments so they describe the current truth
- [x] Remove references to `@terminal` from docs and examples
- [x] Remove tests that exist only to validate removed behavior
- [x] Keep comments that describe harmless shared abstractions only if they are still accurate enough not to mislead future developers

This phase is more important than it may look. In codebases with strong historical layering, stale comments are one of the easiest ways for removed behavior to come back accidentally months later.

### Why this matters

If comments and docs still describe the old architecture, future maintainers will accidentally resurrect wrong assumptions.

---

## 8. File-by-File Developer Checklist

This section is meant to be used directly by a developer while making changes.

### Core runtime wiring

- [x] `src/extension.ts`
  - swap terminal-manager factory to `StandaloneTerminalManager`
  - remove terminal-output command registration
  - remove unused imports that supported integrated terminal output copying

- [x] `src/core/task/index.ts`
  - confirm the background-exec path remains intact
  - do **not** remove `terminalReuseEnabled` or `terminalOutputLineLimit` *(superseded for the VS Code extension by the dedicated terminal-settings removal follow-up)*
  - do **not** broaden scope here unless compilation requires it

Why those settings stay: they govern the background terminal behavior that Cline still actively uses. They are terminal-related, but they are not integrated-terminal-specific.

### `@terminal` removal

- [x] `src/shared/context-mentions.ts`
- [x] `src/core/mentions/index.ts`
- [x] `src/shared/__tests__/context-mentions.test.ts`
- [x] `src/core/mentions/index.test.ts`
- [x] `webview-ui/src/utils/context-mentions.ts`
- [x] `webview-ui/src/components/chat/ChatTextArea.tsx`
- [x] `webview-ui/src/components/chat/ContextMenu.tsx`
- [x] `webview-ui/src/config/platform-configs.json`
- [x] `webview-ui/src/config/platform.config.ts`
- [x] `webview-ui/src/utils/__tests__/context-mentions.test.ts`

### Terminal-output-to-chat command removal

- [x] `src/registry.ts`
- [x] `package.json`
- [x] any tests that reference `cline.addTerminalOutputToChat`

### CLI install flow removal

- [x] `src/core/controller/state/installClineCli.ts`
- [x] `webview-ui/src/components/common/ClineKanbanLaunchModal.tsx`
- [x] `webview-ui/src/components/chat/chat-view/components/layout/WelcomeSection.tsx`
- [x] `src/shared/cline/banner.ts`
- [x] `webview-ui/src/services/grpc-client.ts`
- [x] any banner or state code that is only meaningful for the removed install flow

### Integrated-terminal implementation deletion

- [x] `src/hosts/vscode/terminal/VscodeTerminalManager.ts`
- [x] `src/hosts/vscode/terminal/VscodeTerminalProcess.ts`
- [x] `src/hosts/vscode/terminal/VscodeTerminalRegistry.ts`
- [x] `src/hosts/vscode/terminal/get-latest-output.ts`
- [x] `src/hosts/vscode/terminal/ansiUtils.ts` if unused
- [x] related tests

### Compatibility surfaces to leave alone unless necessary

- [x] shared proto/grpc generated files
- [x] shared interface residue (`waitForShellIntegration`, etc.)
- [x] telemetry enum/constants unless build/tests require changes
- [x] `terminalExecutionMode` types/comments unless they cause direct confusion or compile errors

Developers should read this as a restraint list. These are the places where unnecessary enthusiasm can turn a focused cleanup into a multi-week refactor.

---

## 9. Debugging and “What Broke?” Guide

This section is intentionally written in plain language so someone less familiar with the codebase can still follow it.

### Problem: TypeScript fails after removing `@terminal`

What likely happened:

- some UI component or test still refers to `ContextMenuOptionType.Terminal`
- a test still expects `@terminal` to parse
- a config type still includes `supportsTerminalMentions`

What to do:

- [x] Search for `Terminal` in the context-mentions UI files
- [x] Search for `supportsTerminalMentions`
- [x] Search for `@terminal`
- [x] Update tests and types until the compiler matches the new behavior

### Problem: Build fails after removing the terminal-output command

What likely happened:

- `src/registry.ts` and `package.json` are out of sync
- `src/extension.ts` still tries to register a command that no longer exists

What to do:

- [x] Search for `addTerminalOutputToChat`
- [x] Remove all command references from runtime code and manifest contributions together

### Problem: The extension still creates or focuses a VS Code terminal somewhere

What likely happened:

- a hidden call site still references `openTerminalPanel` or `executeCommandInTerminal`
- a leftover command or UI still triggers integrated-terminal behavior

What to do:

- [x] Search for `openTerminalPanel(`
- [x] Search for `executeCommandInTerminal(`
- [x] Search for `vscode.window.createTerminal`
- [x] Search for `workbench.action.terminal`

### Problem: Developers are tempted to simplify shared terminal types immediately

Why that is risky:

- it can spread the change across CLI, JetBrains, shared interfaces, generated code, and tests
- it is not necessary to achieve the product goal

What to do instead:

- [x] stop and ask whether the change is required for correctness
- [x] if not required, defer it to a later cleanup PR

In practice, that means developers should prefer a temporary unused field over a broad signature change unless the compiler or runtime forces the broader change.

---

## 10. Validation Plan

## 10.1 Build and type-check validation

- [x] Run `npm run check-types`
- [x] Run `npm run lint`
- [x] Run `npm run build:webview`
- [x] Run `npm run compile`

## 10.2 Unit and focused test validation

- [x] Run `npm run test:unit`
- [x] If needed, run focused tests around mention parsing and UI context mentions

Suggested focused areas:

- mention parser tests
- chat context-menu tests
- command executor tests
- any tests that validate removed terminal shell-integration behavior should be deleted or updated

## 10.3 Manual verification in VS Code

- [x] Start the extension in development mode
- [x] Verify normal Cline command execution still works
- [x] Verify no Terminal option appears in the `@` mention menu
- [x] Verify typing `@term` does not break mention suggestions
- [x] Verify there is no terminal context-menu action that sends terminal output to chat
- [x] Verify no user-facing UI still offers integrated-terminal-based CLI installation
- [x] Verify background terminal behavior still respects terminal reuse and output-line limits

## 10.4 Final search-based audit

Run repository-wide searches for these strings and inspect the results carefully:

- [x] `@terminal`
- [x] `supportsTerminalMentions`
- [x] `addTerminalOutputToChat`
- [x] `VscodeTerminalManager`
- [x] `VscodeTerminalProcess`
- [x] `getLatestTerminalOutput`
- [x] `openTerminalPanel(`
- [x] `executeCommandInTerminal(`
- [x] `workbench.action.terminal`
- [x] `vscode.window.createTerminal`
- [x] `shellIntegration`

The goal is not necessarily zero matches for every legacy concept in generated or compatibility code. The goal is:

- no user-visible feature remains
- no live runtime dependency remains
- any leftover reference is clearly benign scaffolding, not active behavior

This distinction is essential. Search results alone do not determine success; architectural meaning does.

---

## 11. Recommended PR Structure

To keep the work reviewable and low-risk, use this PR sequence.

### PR 1 — Runtime lock-in + `@terminal` removal

- [x] switch extension terminal manager wiring to `StandaloneTerminalManager`
- [x] remove `@terminal` parser/runtime/UI support
- [x] update associated tests/docs

Why this is a good first PR:

- it removes the most obvious integrated-terminal behavior
- it leaves the old VS Code terminal implementation files present temporarily, which reduces deletion noise while validating the new behavior

### PR 2 — Terminal output command + CLI install surface removal

- [x] remove `addTerminalOutputToChat`
- [x] remove manifest/menu contributions
- [x] remove CLI install UI/backend paths that still depend on the integrated terminal
- [x] update banners and related state only as needed

Why this is a good second PR:

- it removes the remaining user-visible exceptions
- it makes it easier to prove there is no longer a product dependency on the integrated terminal

### PR 3 — Dead file deletion + final cleanup

- [x] delete `src/hosts/vscode/terminal/*`
- [x] delete dead tests
- [x] clean comments and stale references
- [x] run final audit

Why this is a good third PR:

- after PRs 1 and 2, these files should be mechanically dead
- review becomes much easier because the deletion is justified by already-landed behavior changes

If the team prefers fewer PRs, this can still be done in one larger branch. But the mental structure should remain the same: first make the behavior dead, then delete the concrete implementation.

---

## 12. What We Intentionally Keep for Now

The following items should be preserved unless the build or runtime proves they must change:

- [x] `terminalReuseEnabled` setting and related state
- [x] `terminalOutputLineLimit` setting and related state
- [x] shared background-terminal orchestration logic
- [x] shared terminal interfaces that are broader than the current runtime need
- [x] generated RPC/proto code unless removal is cheap and low-risk
- [x] telemetry constants/enums unless directly broken by the removal

### Why these stay

Because they either still power the background terminal path or they are benign compatibility residue. Removing them now would create a larger refactor than this initiative requires.

This section exists partly to protect the project from scope creep. If someone asks, “Why didn’t we also simplify all the shared terminal types while we were here?”, the answer is: because that is a different project.

---

## 13. Acceptance Criteria

This project is complete when all of the following are true:

- [x] Cline in VS Code no longer relies on the integrated terminal for any user-facing feature
- [x] `@terminal` is gone from parser, UI, docs, and tests
- [x] terminal-output-to-chat is gone from command registration and manifest contributions
- [x] integrated-terminal-based CLI install flow is removed or otherwise no longer a live dependency
- [x] the extension bootstrap no longer creates `VscodeTerminalManager`
- [x] the old VS Code terminal implementation files are deleted or fully dead and isolated
- [x] background command execution still works correctly in VS Code
- [x] the repo passes the agreed validation commands
- [x] a final search audit confirms no remaining live dependency on the VS Code integrated terminal

---

## 14. Notes for Future Cleanup (Explicitly Deferred)

These items are valid future cleanup candidates, but they are **not required for this initiative**:

- simplifying `ITerminalProcess` after old VS Code shell-integration assumptions are gone
- removing `waitForShellIntegration` and `no_shell_integration` from shared interfaces
- simplifying telemetry types that distinguish old VS Code terminal output methods
- shrinking `terminalExecutionMode` to a single-mode model in all prompt and type layers
- cleaning up generated host-bridge methods once product and platform contracts are ready for that change

If future developers want to do these, they should do so in a separate cleanup pass after the behavioral removal is already complete and stable.

---

## 15. Summary for the Development Team

The core insight is simple:

**Cline’s VS Code extension already behaves like a background-terminal product for task execution. This plan finishes the job by removing the old integrated-terminal features and deleting the old integrated-terminal code, while deliberately avoiding a broad shared-abstraction refactor.**

If the team follows this document in order, the work stays understandable, reviewable, and low-risk.

The most important implementation habit is disciplined scope control. Remove live behavior. Remove user-visible affordances. Delete dead concrete code. Resist the urge to clean every shared abstraction in the same pass. That is how the team gets to the desired architecture safely.
