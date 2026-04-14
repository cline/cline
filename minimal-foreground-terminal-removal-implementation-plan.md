# Minimal Foreground Terminal Removal Implementation Plan

## Purpose

This document describes the cleanest path for **removing foreground terminal functionality from the `cline/` repository** while keeping the implementation as close as possible to what exists on `main`.

This plan is intentionally different from a migration plan that replaces the old terminal architecture with a new unified runtime. The goal here is **not** to redesign terminal execution. The goal is to:

- remove the **foreground terminal mode** and its user-visible plumbing,
- preserve the currently working terminal behavior that users still need,
- minimize the number of touched files,
- minimize the amount of new terminal logic introduced, and
- leave the codebase structurally recognizable to anyone familiar with `main`.

This document should stand on its own. A developer should be able to work from it without reading prior chat history.

---

## Executive Summary

The safest low-churn approach is:

1. **Do not continue from the large migration branch as the implementation base.**
2. **Start a fresh branch from `main`.**
3. **Treat the existing `eve/delete-foreground-terminal` branch as a reference branch only.**
4. **Implement the smallest possible semantic change:** remove the foreground terminal pathway and its surface area, while preserving all other currently supported terminal behavior.
5. **Cherry-pick ideas, not architecture.** Reuse tiny techniques or bug fixes only if they are clearly necessary on top of `main`.

In plain language: this plan avoids turning a deletion task into a terminal rearchitecture.

---

## Why We Need a Different Plan Than the Current Branch

The existing `eve/delete-foreground-terminal` branch already evolved into a broad migration. Historically, that branch did not stop at removing foreground terminal mode. It continued by:

- removing the old VS Code terminal runtime,
- collapsing execution onto a unified standalone runtime,
- restoring profile and timeout settings against that new runtime,
- adding readiness probing,
- adding shell command markers,
- adding telemetry and diagnostics,
- adding regression coverage for the replacement behavior, and
- adding UI compatibility fixes for the new output patterns.

That is a valid engineering direction if the product goal is "make standalone the single terminal authority."

It is **not** the right shape if the product goal is "delete foreground terminal with the smallest reasonable diff."

This distinction matters because the work required for those two goals is very different:

- A **migration branch** introduces replacement behavior.
- A **minimal removal branch** should primarily delete conditionals, UI choices, dead wiring, and mode-specific branches.

This plan is for the second option.

---

## Architectural Vision

### Desired mental model

After this work, developers should think of the terminal system like this:

- There is **one supported command execution path**.
- Users do **not** choose between foreground and background terminal modes.
- Cline still runs commands, captures output, supports continuation/cancellation where already supported, and preserves any terminal settings that remain valid.
- The code remains structurally similar to `main`, except that the foreground-specific branches are gone.

### What this plan is trying to avoid

This plan explicitly tries to avoid:

- replacing one terminal runtime with another,
- introducing a new session model unless strictly required,
- adding new shell-readiness abstractions unless a pre-existing bug on `main` forces it,
- rewriting reuse logic unless foreground removal itself makes that necessary, and
- widening the scope from "remove mode" to "redesign terminal execution."

### Plain-language explanation

Imagine the codebase currently has a fork in the road:

- if terminal mode is foreground, go left,
- if terminal mode is background, go right.

The minimal-change version of this work says:

- remove the sign that points left,
- remove the unused road on the left,
- make sure the right-hand road still works,
- do not rebuild the whole highway system.

That is the design principle behind this plan.

---

## Product Goal

## Core product outcome

The finished work should accomplish this exact product outcome:

- Cline no longer offers foreground terminal mode as a supported feature.
- Users cannot select or rely on foreground terminal mode.
- The remaining command execution behavior continues to work.
- The resulting code looks like a **simplified version of `main`**, not like a newly invented terminal subsystem.

## Non-goals

This work is **not** trying to:

- introduce new terminal capabilities,
- improve the standalone runtime beyond what is required for parity,
- solve every historical terminal issue,
- reintroduce deleted settings unless they are still meaningful in the surviving runtime, or
- adopt every technique from `eve/delete-foreground-terminal`.

---

## Definition of Success

This project is successful when all of the following are true:

- Foreground terminal mode is removed from user-facing settings and behavior.
- Any code path that only existed to support foreground mode is deleted or simplified.
- Existing supported command execution still works.
- Tests prove the remaining path works.
- The diff is materially smaller and conceptually narrower than the current migration branch.
- A reviewer familiar with `main` can still recognize the terminal architecture.

---

## Recommended Strategy

## Recommended branch strategy

The implementation should happen on a **fresh branch from `main`**.

The existing `eve/delete-foreground-terminal` branch should remain available as a **reference branch** only. Developers should inspect it when they want to understand how a previous attempt solved a problem, but they should not treat it as the codebase they are gradually polishing into shape. In this plan, `main` is the source of truth and the migration branch is supporting research material.

That distinction is important. A reference branch is where you borrow ideas. An implementation branch is where you make the product change. Mixing those roles is how a deletion task turns into an accidental redesign.

### Why this is the recommended strategy

Trying to reduce the current migration branch down to a minimal patch would require developers to untangle many dependent decisions that were already made in favor of a new architecture. That is usually riskier than re-implementing the narrowly scoped behavior from `main`.

In practice, a fresh branch from `main` gives the team three benefits:

1. **Clarity**: the team can define exactly what to remove.
2. **Smaller diff**: only essential files are touched.
3. **Lower risk**: fewer hidden dependencies from migration commits.

---

## Reference-Branch Usage Rules

Developers may inspect `eve/delete-foreground-terminal`, but should follow these rules.

### Safe things to reuse

The team should feel comfortable reusing:

- small test ideas that validate behavior already needed on `main`,
- tiny bug fixes that clearly apply regardless of architecture,
- wording or documentation fragments, and
- small UI compatibility fixes if the same issue appears in the minimal branch.

### Things to avoid reusing by default

The team should avoid reusing, unless a concrete bug forces it:

- runtime-unification commits,
- standalone-shell session redesigns,
- command-marker infrastructure,
- new readiness or telemetry frameworks, and
- large controller/task wiring rewrites that only exist because the migration branch removed the old runtime.

### Practical rule of thumb

If a piece of code exists only because the migration branch chose to make standalone the universal runtime, it should **not** be copied into the minimal branch unless the team can prove it is necessary independently.

---

## High-Level Development Order

The recommended order is:

1. Clarify exact behavior and scope.
2. Inventory foreground-specific code on `main`.
3. Remove UI/config surface for foreground mode.
4. Remove controller/state plumbing that only supports foreground mode.
5. Simplify task/execution routing to the surviving supported mode.
6. Delete dead runtime code that is now unreachable.
7. Repair any regressions introduced by simplification.
8. Add/adjust tests.
9. Run manual verification.
10. Write final cleanup notes and follow-up recommendations.

This order matters because it keeps the work deletion-first. It prevents developers from prematurely inventing replacement machinery before proving it is needed.

---

## Phase 0: Requirements Clarification

### Goal

Freeze the exact meaning of "remove foreground terminal" before code changes begin.

### What this phase must produce

Before anyone edits code, the team needs a plain-language requirements note that answers five questions:

1. What terminal behavior must still work after the change?
2. What exact foreground-terminal behavior must stop existing?
3. Which remaining settings are still truthful and useful once foreground mode is gone?
4. Are temporary compatibility shims acceptable, or should the branch be clean from the start?
5. How will reviewers judge whether the resulting diff is actually "minimal"?

This is not bureaucratic ceremony. It is architectural guardrail-setting. If those questions are left fuzzy, individual developers will fill in the blanks differently, and the code will drift.

### Why these questions matter technically

- If the team does not define the **surviving behavior**, developers will reintroduce infrastructure defensively.
- If the team does not define the **deleted behavior**, foreground concepts will survive under new names.
- If the team does not define the **settings contract**, the UI may promise behavior the runtime does not actually implement.
- If the team does not define what counts as **minimal**, reviewers will have no basis for rejecting architectural expansion.

### Why this phase matters

Most scope drift starts here. If the team does not define what must remain, developers will start rebuilding behavior out of caution. A good deletion plan depends on a precise boundary.

---

## Phase 1: Main-Branch Inventory

### Goal

Identify the smallest set of files on `main` that encode foreground terminal behavior or foreground/background mode selection.

### Implementation tasks

- [ ] Trace all user-visible terminal mode controls from settings UI to state updates.
- [ ] Trace all code paths that branch on terminal execution mode.
- [ ] Identify which files are truly foreground-specific versus shared.
- [ ] Classify each touched file as remove entirely, simplify, leave alone, or revisit only if regressions appear.

### Likely areas to inspect on `main`

- `webview-ui/src/components/settings/sections/TerminalSettingsSection.tsx`
- `src/core/controller/ui/setTerminalExecutionMode.ts`
- `src/core/controller/state/updateSettings.ts`
- `src/core/controller/index.ts`
- `src/core/task/index.ts`
- `src/integrations/terminal/CommandExecutor.ts`
- `src/integrations/terminal/types.ts`
- `src/hosts/vscode/terminal/*`
- `src/integrations/terminal/standalone/*`
- `src/shared/ExtensionMessage.ts`
- any state-keys or serialization files that expose terminal mode

### What the developer is really doing here

This phase is a dependency-mapping exercise. The developer is not just listing files. They are determining where the idea of a "foreground terminal" actually lives.

In many codebases, mode concepts appear in more places than expected:

- in the visible settings panel,
- in state serialization,
- in controller methods,
- in task configuration,
- in runtime routing logic,
- in tests, and
- in user-facing copy.

The purpose of the inventory is to distinguish **the places where foreground mode is defined** from **the places where terminal behavior merely passes through**. Only the first category should be the primary removal target.

### Why this phase matters

This is the phase where the team prevents unnecessary changes. Developers should not touch 25 files if 8 files actually contain the mode-specific logic.

---

## Phase 2: Remove User-Facing Foreground Mode Surface

### Goal

Eliminate all explicit UI surface that exposes foreground terminal mode.

### Files likely to change

- `webview-ui/src/components/settings/sections/TerminalSettingsSection.tsx`
- related settings helpers or state context files if they expose execution mode

### Tasks

- [ ] Remove the terminal execution mode selector from settings UI.
- [ ] Remove any explanatory text that refers to foreground terminal mode.
- [ ] Remove any UI state or hydration that exists only for that selector.
- [ ] Preserve unrelated terminal settings that still make sense.
- [ ] Verify the settings page still reads clearly to a non-expert user.

### How to think about this phase

The job here is not only to hide a control. The job is to remove the product concept.

If the UI still suggests there are two terminal execution modes, then foreground mode still exists in the mental model of the product even if no code path supports it. That creates support burden and future implementation confusion. Developers reading the code later will assume the feature still matters because the UI still tells users it matters.

For that reason, the UI should not merely disable the old option. It should express the new simpler truth: there is one supported command execution model.

### Layperson explanation

This is the product-facing cleanup. If users can still see a setting for foreground mode, then the feature is not truly removed, even if the backend no longer supports it.

### Verification

- [ ] The settings page no longer mentions foreground terminal mode.
- [ ] No empty gaps or broken labels remain.
- [ ] Existing unrelated terminal controls still render and save correctly.

---

## Phase 3: Remove Foreground Mode State and Controller Plumbing

### Goal

Delete the state, update handlers, and controller wiring whose only purpose was to persist or toggle foreground mode.

### Files likely to change

- `src/core/controller/state/updateSettings.ts`
- `src/core/controller/ui/setTerminalExecutionMode.ts`
- `src/shared/ExtensionMessage.ts`
- state/defaults files exposed to webview and controller

### Tasks

- [x] Remove persisted state fields for terminal mode if they only exist for foreground/background selection.
- [x] Remove update handlers that only support changing that mode.
- [x] Remove extension message fields or webview contract values tied only to that mode.
- [x] Remove controller methods that are now dead.
- [x] Update any consumers still reading terminal mode to use the surviving behavior directly.

### Architectural explanation

This phase is where the codebase stops *thinking in two modes*.

User interfaces can lie. State layers are harder to notice. If a field like `terminalExecutionMode` survives in extension state, protobuf messages, or update handlers, then the architecture still carries the old abstraction even after the UI disappears.

That matters because stale abstractions attract new code. Future contributors see the field, assume it still has meaning, and thread it into unrelated changes. Removing the field entirely is often cleaner than setting it permanently to one value.

### Important design rule

Prefer **deleting the branch variable entirely** over leaving a constant like `terminalMode = "background"` everywhere. A minimal branch should simplify logic, not preserve dead abstractions.

### Verification

- [x] No settings update path still writes foreground/background mode.
- [x] No controller route still exists only to switch terminal mode.
- [x] The webview no longer expects terminal mode state.

---

## Phase 4: Simplify Execution Routing

### Goal

Collapse command execution routing onto the surviving supported path without redesigning the runtime.

### Files likely to change

- `src/core/controller/index.ts`
- `src/core/task/index.ts`
- `src/integrations/terminal/CommandExecutor.ts`
- `src/integrations/terminal/types.ts`
- potentially a small subset of terminal manager wiring files

### Tasks

- [ ] Identify where command execution currently branches by mode on `main`.
- [ ] Remove the foreground branch.
- [ ] Ensure the remaining branch still receives the necessary config.
- [ ] Remove config fields that only existed to support branching.
- [ ] Keep interface changes small and local where possible.

### Architectural explanation

This is the most important technical phase in the whole plan.

In the minimal branch, developers should think in terms of **route simplification**, not **runtime replacement**.

The correct question is:

> "Where does the code currently decide between foreground and non-foreground behavior, and how do we reduce that to one path?"

The incorrect question is:

> "What new shared runtime should replace both old modes?"

That second question is what produces a migration branch. This plan is deliberately trying not to ask it unless forced by a real bug.

### What to avoid

- [ ] Do not introduce new runtime abstractions unless the existing path truly breaks without them.
- [ ] Do not rename large portions of the system unless needed for correctness.
- [ ] Do not merge unrelated terminal runtimes unless that is explicitly approved as a separate architectural goal.

### Layperson explanation

This is where developers remove the "if foreground do this, otherwise do that" logic and keep only the branch that still matters.

### Verification

- [ ] Commands still execute through the supported path.
- [ ] Cancellation still works.
- [ ] Any existing continuation/background behavior still works.

---

## Phase 5: Remove Dead Foreground-Specific Runtime Code

### Goal

Delete runtime files or methods that are now unreachable after mode removal.

### Potential areas

- `src/hosts/vscode/terminal/*` if parts are purely foreground-mode infrastructure
- terminal registries/managers or helper types that are only referenced by deleted branches

### Tasks

- [ ] Build a list of files that are now unused after routing simplification.
- [ ] Remove dead classes, methods, and helpers.
- [ ] Remove dead tests that only cover deleted behavior.
- [ ] Keep shared reusable utilities if they still serve the surviving path.

### How to execute this phase safely

Dead-code removal is tempting to do early because it feels tidy. In this project, it should happen later.

The safe order is:

1. simplify routing,
2. prove the surviving path works,
3. only then remove unreachable code.

That sequence matters because some files that look foreground-specific may still contain helper logic the remaining path depends on indirectly. The team should only delete code after the simplified control flow proves it no longer participates in real behavior.

### Important caution

Be conservative here. Dead-code removal should happen **after** routing simplification is proven. If a file still supports the remaining path in any real way, it should stay.

### Verification

- [ ] No imports reference deleted foreground-only files.
- [ ] Typecheck passes after deletions.
- [ ] No tests fail because shared logic was accidentally removed.

---

## Phase 6: Evaluate Remaining Terminal Settings

### Goal

Decide which terminal-related settings should remain in the minimal branch and ensure their semantics are still honest.

### Key question

After foreground mode is removed, do the remaining settings still correspond to real behavior on `main`?

### Tasks

- [x] Review `defaultTerminalProfile` usage on `main`.
- [x] Review `shellIntegrationTimeout` usage on `main`.
- [x] Determine whether each setting:
  - [ ] remains valid as-is,
  - [x] should be removed in the minimal branch,
  - [ ] needs a tiny adjustment to remain truthful.

### Detailed guidance

This phase exists to prevent a subtle but common failure mode: leaving behind a setting whose label sounds reasonable but whose implementation has quietly disappeared.

For example, a setting might still be persisted, still show up in UI, and still round-trip through state — but no longer affect runtime behavior in any real way. From the user’s perspective that is worse than simply removing the setting, because it creates false confidence.

So the developer should evaluate each surviving terminal setting with one hard question:

> If I change this value on `main` after foreground mode is removed, what exact runtime behavior changes because of it?

If the answer is vague, indirect, or speculative, the setting probably does not belong in the minimal branch.

### Recommendation

Do **not** restore or preserve a setting merely because it existed historically. A minimal branch should only keep a setting if the remaining runtime genuinely honors it.

### Why this matters

A settings panel that promises behavior the runtime does not actually implement is worse than a smaller settings panel with fewer options. Minimal change should still be honest change.

---

## Phase 7: Bug-Fix Gap Analysis Against the Reference Branch

### Goal

Use `eve/delete-foreground-terminal` as a learning source to identify bugs that might also exist in the minimal branch.

### Candidate bug-fix categories to evaluate

- [ ] command output rendering edge cases
- [ ] cancellation messaging consistency
- [ ] continuation/background output display
- [ ] terminal settings persistence regressions
- [ ] shell/profile mismatch bugs, but only if they already exist on `main`

### Why this phase is important

The reference branch contains two kinds of changes mixed together:

1. changes that exist because of the new architecture, and
2. changes that fix genuine bugs which may also matter on `main`.

This phase helps developers separate those two categories.

That separation is critical. Without it, a team often ports a large commit because it contains one good fix hidden inside five architectural assumptions.

### Rules for porting fixes

- [ ] Port a fix only if the same bug reproduces on the new minimal branch.
- [ ] Prefer porting the smallest local patch, not the entire chain of commits that originally introduced it.
- [ ] Rephrase or re-implement if that yields a smaller diff on top of `main`.

### Example

The chat UI compatibility fix for standalone `command_output` is a good example of something that can be ported independently if the minimal branch reproduces the same UI issue. The broader runtime migration that created the message pattern should **not** be ported just to make that fix feel contextually complete.

---

## Phase 8: Testing Strategy

### Goal

Prove that foreground mode is gone and the surviving path still works.

### Required test categories

#### Settings/UI tests

- [ ] Terminal settings no longer expose foreground mode.
- [ ] Remaining terminal settings render correctly.
- [ ] Removed state does not reappear in hydration.

#### Controller/state tests

- [ ] Updating settings no longer persists terminal execution mode.
- [ ] No UI/controller flows depend on a terminal mode toggle.

#### Runtime/execution tests

- [ ] Command execution still works through the remaining path.
- [ ] Cancellation still works.
- [ ] Proceed-while-running or background continuation still works, if supported on `main`.
- [ ] Output processing still works.

#### Regression tests

- [ ] Existing non-foreground terminal features still behave the same.
- [ ] Removing foreground mode does not break command output rendering.

### Testing philosophy

The tests should prove two things at the same time:

1. **negative proof**: the removed feature is truly gone, and
2. **positive proof**: the remaining supported path still behaves correctly.

Deletion work is easy to under-test because teams focus on what disappears and forget to validate the path that remains. In this project, the remaining path is the real product, so it deserves most of the confidence-building effort.

### Likely files to update

- `webview-ui/src/components/settings/sections/TerminalSettingsSection.spec.tsx`
- `src/core/controller/state/updateSettings.test.ts`
- `src/integrations/terminal/CommandExecutor.test.ts`
- `src/integrations/terminal/CommandOrchestrator.test.ts`
- targeted webview chat tests if command-output presentation changes

### Why this matters

Minimal diffs can still be dangerous if they delete a switch that hidden logic depended on. The tests need to prove that simplification did not remove a behavior people still use.

---

## Phase 9: Manual Verification Plan

### Goal

Validate the behavior a real user would observe after the removal.

### Suggested QA checklist

- [ ] Open Terminal Settings and confirm foreground mode is no longer visible.
- [ ] Confirm remaining terminal settings still appear correctly.
- [ ] Run a simple command and verify normal output appears.
- [ ] Run a long-running command and verify continuation/background behavior still works if expected.
- [ ] Cancel a running command and verify UI state remains coherent.
- [ ] Reload the extension and confirm removed mode state does not return.
- [ ] Confirm no user-facing text still references foreground terminal mode.

### How to interpret manual verification

Manual QA here is not an afterthought. It is the only place where the team verifies that the product story now feels coherent.

The code can be technically correct while the experience still feels inconsistent. For example:

- a hidden state field may keep affecting behavior,
- a removed option may still be referenced by old help text,
- a cancel button may still behave as if two terminal modes exist, or
- a settings page may feel conceptually broken even though it compiles.

The manual pass catches those cross-cutting mismatches.

### Platform guidance

- [ ] Test on macOS
- [ ] Test on Linux if release requirements need it
- [ ] Test on Windows if release requirements need it

### Why this matters

Mode-removal projects often leave behind "ghost UI" or behavior that only shows up during a real manual flow. The final manual pass is where teams catch those last inconsistencies.

---

## File-by-File Implementation Map

This section is intentionally practical. It tells the developer where to look and why.

### Very likely to edit

- `webview-ui/src/components/settings/sections/TerminalSettingsSection.tsx`
  - remove foreground terminal mode controls and explanatory text
- `src/core/controller/ui/setTerminalExecutionMode.ts`
  - remove the setter or retire it if no longer needed
- `src/core/controller/state/updateSettings.ts`
  - remove updates for terminal execution mode
- `src/shared/ExtensionMessage.ts`
  - remove any state fields that only exist for foreground/background mode
- `src/core/controller/index.ts`
  - simplify wiring that passes or reads execution mode
- `src/core/task/index.ts`
  - simplify task config if it still carries terminal mode
- `src/integrations/terminal/CommandExecutor.ts`
  - remove mode-based execution branching if present on `main`

### How developers should use this map

This map is not a guarantee that every listed file must change. It is a triage tool.

The workflow should be:

1. inspect the file,
2. confirm whether it actually contains foreground-specific logic on `main`,
3. make the smallest viable edit,
4. move on.

The presence of a file in this list means "start here when investigating," not "rewrite this file by default."

### Likely to inspect, but edit only if necessary

- `src/integrations/terminal/types.ts`
- `src/hosts/vscode/terminal/*`
- `src/integrations/terminal/standalone/*`
- `webview-ui/src/context/ExtensionStateContext.tsx`
- `src/shared/storage/state-keys.ts`

### Likely to update for tests

- `webview-ui/src/components/settings/sections/TerminalSettingsSection.spec.tsx`
- `src/core/controller/state/updateSettings.test.ts`
- `src/integrations/terminal/CommandExecutor.test.ts`
- `src/integrations/terminal/CommandOrchestrator.test.ts`

### Probably should not change unless a real bug appears

- command markers
- readiness probing
- telemetry for shell readiness
- profile-aware reuse redesign
- standalone session identity model

Those belong to the migration branch vision, not the minimal-removal vision, unless proven otherwise.

---

## What to Remove, What to Keep, What to Watch

### Remove

- [ ] Foreground terminal mode UI
- [ ] Foreground terminal mode state
- [ ] Foreground-only routing branches
- [ ] Dead foreground-specific helpers/tests

### Keep

- [ ] The surviving command execution path on `main`
- [ ] Existing background/continuation behavior on `main`
- [ ] Any terminal settings that still map to real behavior
- [ ] Shared terminal utilities still used by the remaining path

### Watch carefully

- [ ] command output formatting and rendering
- [ ] cancellation state and button behavior
- [ ] stale settings fields in hydrated extension state
- [ ] tests that implicitly assumed both modes still exist

---

## Risks and Mitigations

## Risk 1: The minimal branch accidentally reintroduces migration behavior

### Risk

Developers may import large techniques from the reference branch out of caution and silently recreate the same architectural expansion.

### Mitigation

- [ ] Require every imported idea from the reference branch to justify itself against `main`.
- [ ] Prefer local re-implementation over cherry-picking large commits.

## Risk 2: Removed mode state still lingers in serialization or UI hydration

### Risk

The UI may appear to remove foreground mode while stale state fields remain in the contract.

### Mitigation

- [ ] Audit state keys, extension message types, and webview hydration carefully.
- [ ] Add tests that ensure removed fields do not reappear.

## Risk 3: Simplifying routing breaks subtle runtime behavior

### Risk

Deleting one branch may remove side effects that the remaining path relied on indirectly.

### Mitigation

- [ ] Add focused runtime tests before and after simplification.
- [ ] Keep deletion order disciplined: UI first, routing second, dead runtime cleanup third.

## Risk 4: The team spends more time pruning than rebuilding

### Risk

Trying to reuse the migration branch too aggressively can turn into a reverse-engineering exercise.

### Mitigation

- [ ] Use `main` as the implementation base.
- [ ] Use the migration branch only as a reference source.

---

## Recommended Working Agreement for the Team

The team should treat this as a **deletion and simplification project**, not a redesign project.

Success should be measured partly by reduced touched-file count and reduced new infrastructure. If a change only makes sense in a world where standalone becomes the universal terminal authority, it should be viewed skeptically in this branch.

If a truly architectural fix becomes necessary, it should be split into a separate, explicit follow-up project rather than hidden inside the removal branch.

---

## Suggested Deliverables

By the end of the work, the team should ideally have:

- a fresh branch from `main`,
- a compact implementation diff for foreground-terminal removal,
- updated tests proving the remaining execution path still works, and
- a short note documenting any intentionally deferred follow-up cleanup.

---

## Recommended Immediate Next Steps

1. **Create a new branch from `main`.**
2. **Produce a foreground-specific inventory** from that branch.
3. **Mark all candidate files as remove/simplify/leave alone.**
4. **Implement only the UI/state/routing deletions first.**
5. **Run targeted tests and manual checks.**
6. **Only then evaluate whether any isolated fixes from `eve/delete-foreground-terminal` are worth porting.**

---

## Progress Checklist

### Planning

- [x] Create a fresh branch from `main`
- [x] Write down the exact semantic definition of "remove foreground terminal" for the branch
- [x] Confirm which remaining terminal settings still map to real runtime behavior

### Inventory

- [x] Audit foreground-specific UI
- [x] Audit foreground-specific state and controller plumbing
- [x] Audit foreground-specific runtime branches
- [x] Classify files as remove / simplify / leave alone

### Implementation

- [x] Remove foreground mode UI
- [x] Remove foreground mode state persistence
- [x] Remove controller update paths for terminal mode
- [x] Simplify command execution routing
- [ ] Remove dead foreground-only runtime code
- [x] Apply only essential compatibility fixes

### Testing

- [ ] Update UI tests
- [ ] Update controller/state tests
- [ ] Update runtime tests
- [ ] Run manual verification

### Review and Cleanup

- [ ] Confirm branch remains minimal in scope
- [ ] Document any intentionally deferred follow-up work
- [ ] Prepare branch for code review

---

## Final Guidance to Developers

If you are ever deciding between:

- a change that makes the code look more like `main` with one mode removed, and
- a change that makes the code more elegant by redesigning terminal execution,

choose the first one for this project.

This work should solve the product problem with the smallest honest change set. If the team later wants a better terminal architecture, that should be a separate, explicit project.
