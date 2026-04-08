# Background-Terminal-Only Migration Plan

## Purpose

This document explains how to remove Cline's IDE-based terminal execution path and move to a **single command-execution runtime** based on the existing **background / standalone terminal integration**.

It is written to stand alone as a development handoff artifact. A developer should be able to read this file and understand:

- what terminal integrations exist today
- how each one works
- why the team wants to remove the IDE-based path
- what code needs to change
- what order to make those changes in
- what to debug, verify, and clean up
- what a successful end state looks like

The writing is intentionally a little more verbose than a typical engineering checklist so that both developers and non-specialists can follow the plan.

---

## Executive Summary

Today, Cline supports two different terminal execution models in VS Code:

1. **IDE terminal execution** using the VS Code integrated terminal APIs.
2. **Background execution** using the standalone terminal runtime backed by direct child processes.

These two models sit behind shared abstractions, but they behave differently in important ways. The IDE path depends on VS Code shell integration, has weaker cancellation, and needs special warning/fallback UX. The background path is already more reliable and is already used by:

- CLI / standalone environments
- JetBrains / external-host flows
- subagent execution

The proposed vision is to make the **background terminal runtime the only execution runtime** for commands, including in VS Code. This means:

- one terminal execution architecture instead of two
- simpler command lifecycle handling
- more reliable cancellation and timeout behavior
- no shell-integration-specific warnings or fallback logic
- less product and test surface area to maintain

The main tradeoff is that commands would no longer execute through VS Code's integrated terminal runtime. That is a deliberate product simplification and should be treated as such.

---

## Overall Progress Checklist

- [ ] Confirm product decisions for shell/profile behavior and settings removal
- [x] Prove that VS Code can execute all commands through `StandaloneTerminalManager`
- [x] Simplify core task/runtime selection so command execution no longer branches by terminal mode
- [x] Remove IDE-terminal-specific execution classes and tests
- [ ] Remove terminal mode state, controller plumbing, and prompt context references
- [x] Remove shell-integration-specific warnings, suggestions, and obsolete UI toggle surface
- [ ] Update docs, stories, and developer references
- [ ] Run full verification and complete release-readiness checks

---

## Architectural Vision

### Desired end state

After this work is complete, Cline should have **one command execution runtime** everywhere:

- **Execution runtime:** `StandaloneTerminalManager` + `StandaloneTerminalProcess`
- **Shared orchestration:** `CommandExecutor` + `CommandOrchestrator`
- **VS Code-specific terminal code:** retained only where it serves some separate UI/helper purpose, not command execution

In plain language: the app should stop asking "Should this command run through the IDE terminal or the background terminal?" and instead always run commands through the same background runtime.

### What this means in practice

- `execute_command` in VS Code, CLI, JetBrains, and subagents should all share the same execution behavior.
- Cancellation should work the same way everywhere.
- "Proceed While Running" should always use real background tracking with log files.
- There should no longer be a user-facing toggle that switches between IDE terminal execution and background execution.
- There should no longer be shell-integration warning cards suggesting that the user switch modes, because there would no longer be multiple modes.

---

## Current Architecture (Before Migration)

## 1) Shared cross-platform terminal layer

These files define the common contracts and shared orchestration logic:

- `src/integrations/terminal/types.ts`
- `src/integrations/terminal/CommandExecutor.ts`
- `src/integrations/terminal/CommandOrchestrator.ts`
- `src/integrations/terminal/constants.ts`

### Why this layer matters

This is the seam that already makes migration possible.

The codebase already has a clear idea of:

- what a terminal manager is
- what a terminal process is
- how command output is buffered and streamed
- how "Proceed While Running" works
- how command results are formatted for the model and UI

Because this shared layer already exists, we do **not** need to redesign the entire command system. We mainly need to:

1. standardize which concrete implementation sits behind the abstraction, and then
2. delete the code that is no longer needed.

## 2) IDE-based terminal execution path

These files implement the VS Code integrated-terminal path:

- `src/hosts/vscode/terminal/VscodeTerminalManager.ts`
- `src/hosts/vscode/terminal/VscodeTerminalProcess.ts`
- `src/hosts/vscode/terminal/VscodeTerminalRegistry.ts`
- `src/hosts/vscode/terminal/get-latest-output.ts`
- wired from `src/extension.ts`

### What it does

This path uses `vscode.window.createTerminal(...)` and then tries to capture command output using VS Code shell integration APIs.

### Why it is harder to maintain

This path introduces complexity because:

- shell integration may or may not be available
- shell integration may appear after a delay
- commands may fall back to `sendText()` with weaker observability
- cancellation is not as robust as direct child-process control
- extra warning and fallback UI is needed to help users recover

### Human explanation

This path is the equivalent of asking another application (the IDE terminal) to run the command for us and hoping that it also gives us structured output and lifecycle information. Sometimes it does; sometimes it does not. That is the root of the instability.

## 3) Background / standalone execution path

These files implement the background runtime:

- `src/integrations/terminal/standalone/StandaloneTerminalManager.ts`
- `src/integrations/terminal/standalone/StandaloneTerminalProcess.ts`
- `src/integrations/terminal/standalone/StandaloneTerminalRegistry.ts`
- `src/integrations/terminal/standalone/StandaloneTerminal.ts`

### What it does

This path spawns child processes directly and captures stdout/stderr itself.

### Why it is the right long-term runtime

This path already supports the behaviors we want from a single universal runtime:

- direct output capture
- process-tree termination
- background tracking after "Proceed While Running"
- log files for long-running or detached commands
- consistent behavior across non-VS Code environments

### Human explanation

This path runs the command itself rather than outsourcing command execution to the IDE terminal. That means Cline controls the process lifecycle directly and can observe it more reliably.

## 4) How mode selection works today

Mode selection is currently controlled by the `vscodeTerminalExecutionMode` state value.

Important files:

- `src/shared/storage/state-keys.ts`
- `src/shared/ExtensionMessage.ts`
- `src/core/controller/index.ts`
- `src/core/controller/state/updateSettings.ts`
- `src/core/controller/ui/setTerminalExecutionMode.ts`
- `src/core/task/index.ts`
- `webview-ui/src/components/settings/sections/TerminalSettingsSection.tsx`

### Current behavior

- If the mode is `"vscodeTerminal"`, a task uses the host-provided terminal manager.
- In VS Code, that means `VscodeTerminalManager`.
- If the mode is `"backgroundExec"`, the task uses `StandaloneTerminalManager`.

This branching is the central behavior we want to remove.

---

## Why This Migration Is Worth Doing

## Benefits

- **Fewer code paths:** one execution model instead of two
- **Higher reliability:** no shell integration dependency for core command execution
- **Better cancellation:** child-process control instead of best-effort IDE terminal interaction
- **Better background behavior:** true background tracking already exists in the standalone path
- **Less user confusion:** no need to explain when to use one mode versus another
- **Cleaner UI:** no more shell-integration warnings and mode-switch suggestions
- **Less testing overhead:** fewer matrix combinations and fewer environment-specific bugs

## Tradeoff to accept explicitly

The main tradeoff is that command execution in VS Code will stop using the IDE terminal integration as the actual runtime.

This does **not** mean every terminal-related VS Code helper must disappear. It means the **execution engine** should no longer depend on the VS Code integrated terminal.

---

## Non-Goals

To avoid scope creep, this project should **not** quietly expand into a general terminal refactor.

Non-goals:

- rewriting all terminal-adjacent UI from scratch
- redesigning the command approval model
- changing CLI or JetBrains behavior beyond what is needed for consistency
- adding a third execution mode
- preserving every nuance of VS Code terminal profile behavior unless the team explicitly decides to do so

---

## Guiding Implementation Patterns

These are the patterns the implementation should follow.

### Pattern 1: Prove the unified runtime before deleting the old one

Do not start by deleting everything. First, make VS Code use the standalone runtime and verify that the product still works. Once that is stable, remove the obsolete code.

### Pattern 2: Separate execution from helper UI

Some files mention terminals but are not part of command execution. For example, opening the terminal panel or sending a command into a brand-new terminal window may still be useful as a helper feature. Do not confuse these helpers with the execution engine.

### Pattern 3: Remove dead state after behavior is proven

User-facing toggles, proto fields, generated files, and prompt context should be removed **after** execution is already working through the unified runtime.

### Pattern 4: Prefer deletion over compatibility shims

If the product vision is "background-only execution," then a long tail of partial compatibility flags should be avoided. The finished design should be simple enough that a new developer can understand it quickly.

### Pattern 5: Treat generated code as derived, not hand-edited

Once proto or state schema changes are made, regenerate generated artifacts instead of patching generated files manually.

---

## Key Product / Technical Decisions To Confirm Up Front

These decisions should be explicitly agreed on before implementation gets deep.

- [ ] **Decision:** Is background execution the only command runtime in VS Code, with no user toggle back to IDE execution?
- [ ] **Decision:** What should happen to `defaultTerminalProfile`?
  - remove it entirely
  - keep it but reinterpret it for the standalone runtime
  - reimplement true profile-to-shell resolution for background execution
- [ ] **Decision:** What should happen to `shellIntegrationTimeout`?
  - remove it entirely
  - keep it temporarily for compatibility
- [ ] **Decision:** Should terminal-helper features such as `executeCommandInTerminal` remain if they are not part of the main command-execution path?
- [ ] **Decision:** Are we comfortable with the background runtime using system/login shell semantics rather than VS Code integrated-terminal semantics?

Recommended default answers for this migration:

- background-only execution: **yes**
- `defaultTerminalProfile`: **remove unless preserving it is a product requirement**
- `shellIntegrationTimeout`: **remove**
- VS Code helper commands: **keep only if they serve separate UX value**
- shell semantics standardization: **yes, accept background runtime semantics**

---

## Implementation Plan

## Phase 0 — Preparation and alignment

Goal: lock down the product decisions and create a safe execution order.

- [ ] Confirm the decisions listed above
- [ ] Share this plan with the team and identify owners for runtime, UI, docs, and test work
- [ ] Decide whether the migration will ship behind a short-lived internal branch only, or behind a temporary hidden flag during rollout

### Developer notes

This phase is mostly about preventing churn. The biggest source of rework would be deleting settings like `defaultTerminalProfile` and later discovering the team actually wanted to preserve them.

---

## Phase 1 — Make VS Code use the standalone runtime first

Goal: change the runtime in practice before deleting all the old plumbing.

- [x] Update `src/extension.ts`
  - Replace the VS Code terminal manager factory with `StandaloneTerminalManager`
  - Specifically, change the host provider factory from `new VscodeTerminalManager()` to `new StandaloneTerminalManager()`
- [x] Verify that VS Code tasks still start and commands still run
- [x] Keep the old setting temporarily, but make sure real execution is using the background runtime

### Phase 1 status

Completed by switching the VS Code host-provider terminal factory to `StandaloneTerminalManager` and validating the repo still typechecks with `npm run check-types`. The legacy `vscodeTerminalExecutionMode` state remains in place temporarily, but VS Code now resolves its task runtime through the standalone terminal manager path.

### Why this phase matters

This is the safest proving move. It lets the team validate real behavior with minimal conceptual change:

- the UI can still carry old state for a moment
- the task/controller plumbing can still look familiar
- but the actual runtime has already been unified

### Important files

- `src/extension.ts`
- potentially `src/hosts/host-provider.ts` only if any typing or comments need cleanup

### What to watch for

- commands still executing successfully in VS Code
- environment details still making sense
- cancellation still working
- no unexpected assumptions that the host provider must return a VS Code-specific manager

---

## Phase 2 — Simplify `Task` so it no longer chooses between two runtimes

Goal: remove the core branching logic that selects one terminal manager or the other.

- [x] Update `src/core/task/index.ts`
  - remove the `if (this.terminalExecutionMode === "backgroundExec") ... else ...` runtime split
  - always create/use the unified terminal manager for command execution
- [x] Decide whether to keep `terminalExecutionMode` temporarily as a compatibility field or remove it immediately
- [x] Ensure the task still applies relevant settings to the unified manager

### Phase 2 status

Completed by making `Task` always construct its command runtime from the unified host-provided standalone terminal manager while temporarily preserving the `terminalExecutionMode` field as a compatibility value for later prompt/context cleanup. Runtime settings like reuse, output limits, shell timeout, and terminal profile still flow into the unified manager.

### Human explanation

Right now the task object acts like a traffic controller deciding which road a command should take. After this phase, there should be only one road.

### Important caution

If `defaultTerminalProfile` and `shellIntegrationTimeout` remain in the code at this stage, they may still be getting passed into the terminal manager. That is acceptable temporarily, but make sure the behavior is understood and documented.

---

## Phase 3 — Simplify `CommandExecutor` to one execution model

Goal: remove dual-manager logic and shell-integration suggestion logic from the shared executor.

- [x] Update `src/integrations/terminal/CommandExecutor.ts`
  - remove `terminalExecutionMode` branching
  - remove `terminalManager` vs `standaloneManager` split
  - make command execution use one manager consistently
- [x] Remove `shouldShowBackgroundTerminalSuggestion()` and related warning-tracking state
- [x] Decide whether `useBackgroundExecution` should be removed from `CommandExecutionOptions`
  - recommended: keep temporarily if needed for API stability, but make it a no-op
  - cleanest end-state: remove it once all callers no longer need it

### Phase 3 status

Completed by collapsing `CommandExecutor` onto a single `StandaloneTerminalManager` path, keeping `useBackgroundExecution` only as a documented no-op compatibility flag, and validating the updated runtime wiring with `npm run check-types`.

### Why this phase matters

Even after Phase 2, `CommandExecutor` can still contain mental overhead from the old world. This phase removes that leftover branching and makes the shared layer reflect the actual product vision.

---

## Phase 4 — Remove IDE-terminal-specific execution classes

Goal: delete the execution implementation that is no longer used.

- [x] Delete `src/hosts/vscode/terminal/VscodeTerminalManager.ts`
- [x] Delete `src/hosts/vscode/terminal/VscodeTerminalProcess.ts`
- [x] Delete `src/hosts/vscode/terminal/VscodeTerminalRegistry.ts`
- [ ] Delete `src/hosts/vscode/terminal/get-latest-output.ts` if no longer referenced
- [x] Delete or update tests tied only to the removed runtime, especially `src/hosts/vscode/terminal/VscodeTerminalProcess.test.ts`

### Phase 4 status

Completed by removing the obsolete VS Code command-execution classes and their dedicated integration test, while intentionally retaining `get-latest-output.ts` because it is still used by terminal mention/helper flows outside the main command runtime. A repo-wide reference scan for `VscodeTerminalManager`, `VscodeTerminalProcess`, and `VscodeTerminalRegistry` now returns zero live TypeScript references, and `npm run check-types` still passes.

### Keep vs remove guidance

Keep these only if still useful for other features:

- `src/hosts/vscode/hostbridge/workspace/executeCommandInTerminal.ts`
- `src/hosts/vscode/hostbridge/workspace/openTerminalPanel.ts`

These are terminal helpers, not necessarily part of the command execution engine.

### How to confirm deletion is safe

Before deleting each file, search for all references and verify that the only remaining uses are dead paths.

---

## Phase 5 — Remove terminal-mode state, controller plumbing, and prompt context

Goal: remove the concept of switching between execution modes from state and runtime configuration.

- [ ] Remove `vscodeTerminalExecutionMode` from `src/shared/storage/state-keys.ts`
- [ ] Remove it from `src/shared/ExtensionMessage.ts`
- [ ] Remove reads/writes in `src/core/controller/index.ts`
- [ ] Remove update handling in `src/core/controller/state/updateSettings.ts`
- [ ] Delete `src/core/controller/ui/setTerminalExecutionMode.ts`
- [ ] Remove it from task/tool config files:
  - `src/core/task/ToolExecutor.ts`
  - `src/core/task/tools/types/TaskConfig.ts`
  - `src/core/task/tools/utils/ToolConstants.ts`
- [ ] Remove prompt-context references:
  - `src/core/prompts/system-prompt/types.ts`
  - `src/core/prompts/system-prompt/components/system_info.ts`

### Important behavior change to reflect

The system prompt currently tells the model which shell will be used depending on terminal mode. Once there is only one runtime, that logic should become simple and direct.

### Additional code to revisit

- `src/core/task/tools/handlers/ExecuteCommandToolHandler.ts`
  - currently uses `config.vscodeTerminalExecutionMode === "backgroundExec"` in timeout logic
  - replace that with logic that reflects the new always-managed runtime
- `src/core/task/tools/subagent/SubagentRunner.ts`
  - remove explicit background-mode assumptions that were only there to opt into the special mode

---

## Phase 6 — Remove shell-integration-specific UX and dead runtime concepts

Goal: delete warnings and concepts that only existed because the IDE path depended on shell integration.

- [ ] Remove `no_shell_integration` from shared types if no longer needed
- [ ] Remove `showShellIntegrationSuggestion` from `OrchestrationOptions`
- [ ] Remove shell-integration warning message types from the shared message model if they become unreachable
- [ ] Remove UI warning cards and suggestion CTA logic from chat rendering
- [ ] Remove telemetry paths that only describe shell-integration failure states for command execution

### Important files

- `src/integrations/terminal/types.ts`
- `src/integrations/terminal/CommandOrchestrator.ts`
- `src/shared/ExtensionMessage.ts`
- `src/shared/proto-conversions/cline-message.ts`
- `webview-ui/src/components/chat/ChatRow.tsx`
- `webview-ui/src/App.stories.tsx`

### Human explanation

If the product no longer uses the fragile shell-integration-based runtime, then the app should stop warning users about shell integration as though it were still central to command execution.

---

## Phase 7 — Remove the user-facing mode toggle and simplify the command UI

Goal: make the UI match the new architecture.

- [ ] Remove the terminal execution mode dropdown from `webview-ui/src/components/settings/sections/TerminalSettingsSection.tsx`
- [ ] Remove default state for `vscodeTerminalExecutionMode` from `webview-ui/src/context/ExtensionStateContext.tsx`
- [ ] Simplify `webview-ui/src/components/chat/CommandOutputRow.tsx`
  - remove `isBackgroundExec` branching
  - remove the alert telling users to switch modes
  - treat commands as cancelable according to the unified runtime
- [ ] Simplify `webview-ui/src/components/chat/ChatRow.tsx`
  - remove references to the old mode
  - remove suggestion UI that flips modes
- [ ] Update Storybook stories in `webview-ui/src/App.stories.tsx`
  - remove mode-specific warning stories that should no longer exist
  - fix the stale `"integrated"` story value while touching this area

### Why this phase matters

Even if the backend is fully unified, leaving the old dropdown in the UI would teach users that the old architecture still exists. This phase removes that conceptual debt.

---

## Phase 8 — Decide what to do with `defaultTerminalProfile` and `shellIntegrationTimeout`

Goal: clean up remaining settings whose meaning came from the IDE runtime.

## Option A (recommended): remove both settings

- [ ] Remove `shellIntegrationTimeout` from state, UI, and controller logic
- [ ] Remove `defaultTerminalProfile` from state, UI, and controller logic

This is the simplest and clearest end-state.

## Option B: keep `defaultTerminalProfile`, remove `shellIntegrationTimeout`

- [ ] Remove `shellIntegrationTimeout`
- [ ] Reinterpret `defaultTerminalProfile` as a shell-selection input for the standalone runtime
- [ ] Implement reliable mapping between VS Code profile choice and the shell used by `StandaloneTerminalProcess`

This option is more work and should be taken only if the team explicitly wants to preserve that user-facing behavior.

### Recommendation

Prefer **Option A** unless preserving profile selection is an explicit product requirement.

---

## Phase 9 — Update proto/schema plumbing and regenerate derived code

Goal: remove dead API/schema surface cleanly.

- [ ] Remove `setTerminalExecutionMode` from `proto/cline/ui.proto`
- [ ] Remove `vscodeTerminalExecutionMode` from the state schema source of truth
- [ ] Regenerate protobuf and generated TypeScript artifacts
- [ ] Remove any generated references from:
  - `src/shared/proto/cline/ui.ts`
  - `src/shared/proto/cline/state.ts`
  - `src/generated/grpc-js/cline/*.ts`
  - `src/generated/nice-grpc/cline/*.ts`

### Regeneration commands

Use repository scripts rather than editing generated files manually:

```bash
npm run protos
```

Relevant supporting scripts and conventions:

- `package.json` → `"protos": "node scripts/build-proto.mjs"`
- `package.json` → post-proto formatting already runs automatically
- `src/shared/storage/state-keys.ts` has a lint-staged rule that regenerates `proto/cline/state.proto` when state keys change

### Important note

If the migration changes `src/shared/storage/state-keys.ts`, make sure the derived state proto reflects the new schema before checking in the work.

---

## Phase 10 — Documentation and developer artifact cleanup

Goal: ensure all docs tell the truth about the new product behavior.

- [ ] Update troubleshooting docs that currently tell users to switch to Background Exec
- [ ] Remove references to mode switching from docs and stories
- [ ] Update any internal architecture notes that still describe dual runtime behavior
- [ ] Keep this plan document updated as implementation decisions change

Likely docs to update:

- `docs/troubleshooting/terminal-quick-fixes.mdx`
- `docs/running-models-locally/overview.mdx`
- any terminal-related feature docs discovered during implementation

### Human explanation

Once background execution is the only command runtime, docs should stop describing it as a workaround or optional mode. It becomes the default design.

---

## File-by-File Change Map

This table is a practical summary for developers.

| File / Area | Action | Why |
|---|---|---|
| `src/extension.ts` | Edit | Make VS Code host provider create `StandaloneTerminalManager` |
| `src/core/task/index.ts` | Edit | Remove terminal mode branching |
| `src/integrations/terminal/CommandExecutor.ts` | Edit | Collapse to one runtime and remove shell-warning suggestion logic |
| `src/integrations/terminal/CommandOrchestrator.ts` | Edit | Remove shell-integration-specific message paths if obsolete |
| `src/integrations/terminal/types.ts` | Edit | Remove dead mode/shell-integration concepts |
| `src/hosts/vscode/terminal/*` | Delete | Remove IDE execution implementation |
| `src/shared/storage/state-keys.ts` | Edit | Remove `vscodeTerminalExecutionMode`; possibly remove other dead settings |
| `src/shared/ExtensionMessage.ts` | Edit | Remove old state/message fields |
| `src/core/controller/index.ts` | Edit | Stop reading/posting removed state |
| `src/core/controller/state/updateSettings.ts` | Edit | Remove update handling for deleted settings |
| `src/core/controller/ui/setTerminalExecutionMode.ts` | Delete | Toggle no longer needed |
| `src/core/task/ToolExecutor.ts` | Edit | Remove mode field plumbing |
| `src/core/task/tools/types/TaskConfig.ts` | Edit | Remove mode field from tool config |
| `src/core/task/tools/utils/ToolConstants.ts` | Edit | Remove config key exposure |
| `src/core/task/tools/handlers/ExecuteCommandToolHandler.ts` | Edit | Replace background-mode checks with unified-runtime logic |
| `src/core/task/tools/subagent/SubagentRunner.ts` | Edit | Remove explicit opt-in to background-only mode |
| `src/core/prompts/system-prompt/types.ts` | Edit | Remove terminal mode from prompt context |
| `src/core/prompts/system-prompt/components/system_info.ts` | Edit | Simplify shell reporting logic |
| `webview-ui/src/components/settings/sections/TerminalSettingsSection.tsx` | Edit | Remove terminal mode selector; maybe remove dead settings |
| `webview-ui/src/context/ExtensionStateContext.tsx` | Edit | Remove default state for deleted fields |
| `webview-ui/src/components/chat/ChatRow.tsx` | Edit | Remove shell-integration suggestion UI and mode-switch CTA |
| `webview-ui/src/components/chat/CommandOutputRow.tsx` | Edit | Simplify cancel behavior and remove mode-specific messaging |
| `webview-ui/src/App.stories.tsx` | Edit | Remove obsolete stories and stale mode values |
| `proto/cline/ui.proto` | Edit | Remove `setTerminalExecutionMode` RPC |
| generated proto TS files | Regenerate | Keep derived code in sync with source schema |
| docs under `docs/` | Edit | Remove references to mode switching / shell integration as central execution behavior |

---

## Debugging Guide

Use this section if the migration compiles but behavior is wrong.

## Symptom: commands no longer run in VS Code

Check:

- `src/extension.ts` host provider factory
- `src/core/task/index.ts` manager construction
- `src/integrations/terminal/CommandExecutor.ts` manager selection logic

Likely cause:

- runtime selection still assumes a VS Code manager exists
- or the unified manager is not being instantiated/passed correctly

## Symptom: cancel button appears but does not stop the process

Check:

- `StandaloneTerminalProcess.terminate()`
- `CommandExecutor.cancelBackgroundCommand()`
- `CommandOutputRow.tsx` cancel-button path

Likely cause:

- UI still assumes old mode-specific behavior
- or merged process promises no longer expose `terminate()` correctly

## Symptom: shell-integration warnings still appear

Check:

- `CommandOrchestrator.ts`
- `ExtensionMessage.ts`
- `ChatRow.tsx`
- proto conversion / message mapping files

Likely cause:

- dead warning message paths remain reachable

## Symptom: type errors around removed state/config fields

Check:

- `TaskConfig`
- `ToolExecutor`
- `ExtensionState`
- generated proto/state files

Likely cause:

- field removed from one layer but not another

## Symptom: docs/tests still reference `vscodeTerminalExecutionMode`

Run a repo-wide search and remove or rewrite all hits. This migration should end with **zero meaningful live references** to the old mode toggle.

---

## Verification Plan

## Automated verification

Run these at minimum:

- [ ] `npm run protos`
- [ ] `npm run check-types`
- [ ] `npm run lint`
- [ ] `npm run test:webview`
- [ ] `npm run test:unit`

If the migration touches extension/runtime behavior deeply, also run:

- [ ] `npm run test:integration`

If there are changes in standalone/runtime packaging behavior, consider:

- [ ] `npm run compile-standalone`

## Manual verification scenarios

These scenarios should be tested in VS Code after the migration.

- [ ] Start a new task and run a simple command like `pwd`
- [ ] Run a command with substantial output and confirm streaming works
- [ ] Run a long-running command and click **Proceed While Running**
- [ ] Confirm a log file is produced and linked correctly
- [ ] Run a command that times out and confirm it transitions to background tracking cleanly
- [ ] Cancel a running command and confirm the process really stops
- [ ] Verify command output still appears correctly in chat rows
- [ ] Verify background command summaries still appear in environment details when relevant
- [ ] Verify subagents still execute commands correctly
- [ ] Verify multi-root workspace command execution still respects workspace hints
- [ ] Verify no shell-integration warning UI appears anywhere
- [ ] Verify the Settings UI no longer offers a terminal execution mode choice

## Manual regression checks outside VS Code

- [ ] Confirm CLI / standalone still works as before
- [ ] Confirm external-host / JetBrains-style flows still work as before

---

## Definition of Done

This migration is complete when all of the following are true:

- [ ] VS Code command execution uses only the standalone/background runtime
- [ ] There is no longer a product-level toggle between IDE and background execution
- [ ] IDE execution classes have been removed from the codebase
- [ ] Shell-integration warning/suggestion flows are gone or unreachable
- [ ] User-facing docs no longer describe Background Exec as an optional workaround
- [ ] Tests, stories, and generated files are updated
- [ ] The team has verified cancellation, timeout handling, and background logging end-to-end

---

## Rollback Strategy

If the migration exposes serious regressions, the safest rollback path is:

1. restore the `src/extension.ts` host provider factory to `VscodeTerminalManager`
2. restore the `Task` / `CommandExecutor` branching if it was removed
3. keep the schema/UI changes isolated in separate commits if possible so they can be reverted cleanly

This is another reason the migration should be implemented in phases rather than as one giant delete-first change.

---

## Recommended Delivery Strategy

Recommended implementation order for real development:

1. **Runtime unification first**
2. **Behavior verification second**
3. **State/UI cleanup third**
4. **Deletion of IDE runtime code fourth**
5. **Docs/schema/generated cleanup last**

This sequence gives the team a stable point to debug behavior before deleting the reference implementation.

---

## Final Recommendation

The migration should proceed.

The codebase is already structured in a way that makes this achievable without a fundamental redesign. The shared terminal abstractions are mature enough, and the background runtime already has the capabilities that the unified product vision needs.

The most important thing is not to treat this as "just delete the VS Code files." The correct implementation is:

1. **standardize execution on the standalone runtime**, then
2. **remove the old mode and the code that only existed to support it**.

If the team follows that sequence, the result should be a simpler, more reliable, and easier-to-maintain terminal architecture.