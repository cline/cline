## Remove Terminal Settings from the Cline VS Code Extension Safely

### Standalone implementation plan for removing the Terminal Settings view, deleting the remaining terminal settings, and preserving the background-terminal behavior that still matters

---

## Progress Checklist

- [x] Remove the Terminal Settings UI surface from the webview
- [x] Remove `terminalOutputLineLimit` as a persisted/user-facing setting while preserving fixed internal output limiting
- [x] Remove `terminalReuseEnabled` as a persisted/user-facing setting while preserving internal aggressive reuse defaulting to `true`
- [x] Simplify controller, task, terminal, proto, and generated-code plumbing to match the new architecture
- [x] Clean up stale tests, stories, RPCs, comments, and references
- [x] Validate the extension end to end and confirm the final architecture behaves as intended

---

## 1. Purpose of This Document

This document is a **standalone implementation guide** for removing the remaining **Terminal Settings** feature from the Cline VS Code extension.

It is designed to be handed directly to the development team. A developer should be able to read this file in isolation and understand:

- what the current terminal-settings architecture is,
- why the Terminal Settings view still exists even after foreground terminal removal,
- which settings are still truly live,
- why those settings should now be removed,
- what behavior must stay in place after the settings are deleted,
- what code needs to change,
- how generated state/proto surfaces are involved,
- and how to verify that the extension still works after the cleanup.

This plan is intentionally detailed. The goal is not only to tell someone *what to delete*, but to explain *what the code is doing today*, *why it was built that way*, and *what architectural story the repository should tell after the change*.

In other words: this is both a work plan and an architecture explainer.

---

## 2. Executive Summary

The Cline VS Code extension used to expose terminal behavior as a user-facing settings area because terminal execution and terminal UX were more intertwined with the VS Code integrated terminal.

That is no longer the product direction.

In the current branch, Cline’s task command execution path in VS Code has already moved to the **background terminal implementation**. However, the settings UI still contains a **Terminal Settings** tab, and two remaining settings are still wired into the runtime:

- `terminalOutputLineLimit`
- `terminalReuseEnabled`

These settings are not fully dead today. They still affect the background terminal manager.

The desired end state is therefore **not** just “hide the tab.” It is:

1. remove the Terminal Settings view,
2. remove those two settings as persisted/user-facing configuration,
3. keep the useful runtime behavior as internal defaults,
4. delete the plumbing that only exists to let users configure those behaviors.

That means the background terminal system should still:

- limit/truncate command output internally, and
- aggressively reuse compatible background terminals,

but those behaviors should become **implementation details**, not settings.

This is a subtractive cleanup effort. It should be approached as a careful removal, not as a redesign of the terminal subsystem.

---

## 3. Architectural Vision Overview

### 3.1 What the final product should feel like

After this work is complete, the extension should present a simpler mental model to users:

- Cline has settings for the things users truly need to configure.
- Cline does **not** expose an entire Terminal Settings area for low-level background execution policies.
- The extension still runs commands safely and efficiently in the background.

From the user’s perspective, the terminal subsystem should feel more like infrastructure and less like a configurable feature surface.

### 3.2 What the final codebase should communicate

Today, the codebase still tells a partially outdated story:

- the integrated-terminal runtime path has largely been removed from the live task flow,
- but the settings model still behaves as though terminal execution policy is something the user should configure.

After this cleanup, the repository should communicate a clearer truth:

> In VS Code, Cline runs commands through the background terminal runtime. Output limiting and terminal reuse are internal operating policies of that runtime, not user-facing extension settings.

That architectural truth is important because codebases teach future developers how the system is supposed to work. If the repository continues to expose stale settings surfaces and stale plumbing, it implies that terminal execution mode and terminal tuning are still part of the product contract when they no longer should be.

### 3.3 Why internal defaults are the right abstraction now

The background terminal runtime already has several internal safety mechanisms. These are not hypothetical future ideas; they exist in the code today.

Examples include:

- a default terminal output line limit constant,
- large-output protection,
- file-based logging thresholds,
- full-output memory caps,
- truncation logic for command output sent back to the model.

That means the slider is not the only protection keeping terminal output under control. The system already knows how to protect itself.

Likewise, aggressive terminal reuse is now mainly an internal optimization for background terminal reuse. It is no longer part of a user decision between foreground and background execution modes.

Because of that, the architecture should shift from:

- “users control these terminal policies”

to:

- “the runtime owns sensible defaults for these terminal policies.”

This is a better abstraction boundary. The runtime should own runtime policy unless there is a real product need to expose that policy to users.

---

## 4. Current Architecture: How Terminal Settings Work Today

This section explains the current wiring end to end. The point is not just to list files, but to show the full flow so developers understand why the cleanup touches multiple layers.

### 4.1 The webview settings UI still exposes a Terminal tab

Relevant files:

- `webview-ui/src/components/settings/SettingsView.tsx`
- `webview-ui/src/components/settings/sections/TerminalSettingsSection.tsx`
- `webview-ui/src/components/settings/TerminalOutputLineLimitSlider.tsx`

What happens today:

1. `SettingsView.tsx` defines a `terminal` tab.
2. When that tab is active, it renders `TerminalSettingsSection`.
3. That section currently renders:
   - a checkbox for aggressive terminal reuse, and
   - a slider for terminal output line limit.

Why this layer matters:

This is the part users actually see. If this tab remains in the UI, the product still implies that terminal behavior is a supported user-tunable concern. Removing only the backend settings while leaving the UI behind would be inconsistent and confusing.

### 4.2 The webview sends terminal-setting updates through the generic settings pipeline

Relevant file:

- `webview-ui/src/components/settings/utils/settingsHandlers.ts`

What happens today:

- UI controls call `updateSetting(field, value)`.
- That helper constructs an `UpdateSettingsRequest`.
- It sends that request through `StateServiceClient.updateSettings(...)`.

Why this matters:

The terminal settings are not using a one-off custom local mechanism in the webview. They are part of the same generic settings architecture as other persistent settings. That means removing them is not only a UI edit; it also affects the shared request types and the controller-side update handlers.

### 4.3 The settings still exist in the extension’s durable state model

Relevant file:

- `src/shared/storage/state-keys.ts`

What happens today:

- `terminalReuseEnabled` exists as a state key with a default value.
- `terminalOutputLineLimit` exists as a settings key with a default value.

Why this matters:

This file is not “just another config file.” It is the **source of truth** for the extension’s durable settings/state model.

In this repository, removing a field from `state-keys.ts` is meaningful because that file influences:

- TypeScript state types,
- default-value tables,
- key arrays,
- proto generation,
- generated gRPC surfaces.

So deleting a setting here is the start of a larger cascade, not the end of the job.

### 4.4 The controller still reads these values and publishes them to the webview

Relevant file:

- `src/core/controller/index.ts`

What happens today:

There are two distinct controller responsibilities involved here:

#### A. Task initialization

When a task is initialized, the controller reads the terminal settings from state and passes them into the `Task` constructor.

This means the settings are not just cosmetic. They actively influence the runtime that will execute commands for a task.

#### B. Webview state hydration

When the controller builds `ExtensionState` to send to the webview, it still includes these fields. That allows the UI to render them and display their current values.

Why this matters:

To remove the settings cleanly, both responsibilities must change:

- the controller must stop supplying these values to the runtime, and
- the controller must stop exposing them to the webview.

If only one side changes, the system becomes inconsistent.

### 4.5 `Task` still applies the settings to the background terminal manager

Relevant file:

- `src/core/task/index.ts`

What happens today:

The live task runtime in the current branch already uses background execution. That is an important architectural fact.

However, even though foreground/integrated terminal execution has already been removed from the task path, `Task` still receives and applies the remaining terminal settings. In practice, that means:

- the task runtime still treats these values as task configuration inputs,
- and still forwards them into the background terminal manager.

Why this matters:

This is the key reason the settings are still live today. The Terminal Settings UI is not merely stale decoration; it still feeds runtime behavior through `Task`.

That also means `Task` is the right place to replace configurable behavior with fixed internal defaults. Once the settings are removed, `Task` should no longer carry those parameters at all.

### 4.6 `StandaloneTerminalManager` still consumes both settings

Relevant files:

- `src/integrations/terminal/standalone/StandaloneTerminalManager.ts`
- `src/integrations/terminal/constants.ts`

What happens today:

#### Output limiting

`StandaloneTerminalManager.processOutput(...)` uses the configured output-line limit to decide when and how to truncate terminal output before it is returned to the model.

That is the piece of code that makes the slider “real.”

#### Terminal reuse

`StandaloneTerminalManager.getOrCreateTerminal(...)` checks whether aggressive reuse is enabled before deciding whether to reuse an available idle terminal or create a new one.

That is the piece of code that makes the reuse toggle “real.”

#### Existing internal safeguards

The terminal subsystem also already contains broader internal safeguards such as:

- `DEFAULT_TERMINAL_OUTPUT_LINE_LIMIT = 500`
- output buffering limits
- large-output cutover to file logging
- max full-output size caps
- unretrieved-output truncation logic

Why this matters:

These runtime behaviors should remain. What should disappear is the external configuration layer that currently feeds them.

### 4.7 `CommandExecutor` still contains compatibility copying logic

Relevant file:

- `src/integrations/terminal/CommandExecutor.ts`

What happens today:

`CommandExecutor` has logic that copies terminal-related settings from one terminal manager into an internally created standalone manager in fallback paths.

That copying logic made sense when terminal behavior was configurable and the system needed to keep separate manager instances behaviorally aligned.

Why this matters:

Once the settings are removed and the runtime owns fixed defaults, that copy-through logic likely becomes partly or entirely unnecessary. It should be reviewed and simplified after the settings plumbing is deleted.

### 4.8 Proto and generated code still expose these settings

Relevant files:

- `scripts/generate-state-proto.mjs`
- `proto/cline/state.proto`
- `src/shared/proto/cline/state.ts`

What happens today:

- `state-keys.ts` drives generated state/proto surfaces.
- `UpdateSettingsRequest` still includes terminal-related fields.
- `StateService` still includes `updateTerminalReuseEnabled(BooleanRequest)`.

Why this matters:

If the repository removes the settings from application code but leaves them in proto/grpc surfaces, the codebase will still advertise a stale public contract internally. That is exactly the kind of drift this cleanup should eliminate.

---

## 5. Scope and Non-Goals

### 5.1 In scope

This plan covers:

- removing the Terminal Settings tab from the settings UI,
- deleting the terminal settings section component and slider,
- deleting `terminalOutputLineLimit` as persisted/user-facing configuration,
- deleting `terminalReuseEnabled` as persisted/user-facing configuration,
- deleting controller, task, webview, proto, and generated-code plumbing that exists only for those settings,
- preserving internal output limiting as a fixed runtime policy,
- preserving aggressive background terminal reuse as a fixed runtime policy defaulting to `true`,
- deleting obsolete tests, stories, comments, and RPCs related to those settings.

### 5.2 Out of scope

This plan does **not** aim to:

- redesign the standalone terminal subsystem broadly,
- remove background terminal reuse behavior itself,
- change the output-limit default unless there is a separate product decision to do so,
- revisit every terminal abstraction in the repository,
- redesign the overall settings UX beyond removing the Terminal Settings feature.

### 5.3 Core safety rule

This work removes **configurability**, not the underlying background terminal capability.

That means the development team should keep asking a simple question:

> Is this code implementing a real runtime behavior we still want, or is it only here to support a setting we no longer want users to control?

If the answer is “it only exists to support the removed setting,” it should be deleted.

If the answer is “it implements runtime behavior we still want,” it should usually remain, but be driven by internal defaults instead of user state.

---

## 6. Target End State

After the implementation is complete, the architecture should look like this:

- The settings UI has no Terminal tab.
- The webview does not know about `terminalReuseEnabled` or `terminalOutputLineLimit`.
- The controller does not publish or read those settings.
- `Task` does not accept those settings as constructor/config inputs.
- `StandaloneTerminalManager` still truncates output using an internal fixed default.
- `StandaloneTerminalManager` still aggressively reuses compatible background terminals by default.
- `UpdateSettingsRequest` no longer exposes those fields.
- `updateTerminalReuseEnabled` no longer exists as an RPC.
- Generated TypeScript and proto surfaces match the new reality.

That is the architectural completion condition.

---

## 7. Recommended Implementation Sequence

The safest implementation order is:

1. remove the Terminal Settings UI surface,
2. remove `terminalOutputLineLimit` as a setting while preserving fixed internal output limiting,
3. remove `terminalReuseEnabled` as a setting while preserving fixed internal aggressive reuse,
4. simplify terminal runtime plumbing that only existed for configurability,
5. clean up generated surfaces, RPCs, tests, stories, and stale references,
6. run validation and search-based audits.

This order is intentional.

It starts with the user-facing feature surface, then removes the persisted state contract, then simplifies internal code, then performs cleanup and validation. That keeps the blast radius manageable and makes regressions easier to reason about.

---

## 8. Workstream 1: Remove the Terminal Settings UI Surface

### Why this workstream exists

The Terminal Settings tab is the product’s most visible signal that users are still expected to tune terminal behavior. Removing the UI is therefore the clearest first step in aligning the product with the new architecture.

### Primary files

- `webview-ui/src/components/settings/SettingsView.tsx`
- `webview-ui/src/components/settings/sections/TerminalSettingsSection.tsx`
- `webview-ui/src/components/settings/TerminalOutputLineLimitSlider.tsx`
- `webview-ui/src/components/settings/sections/TerminalSettingsSection.spec.tsx`
- `webview-ui/src/components/settings/sections/TerminalSettingsSection.stories.tsx`

### Implementation steps

1. Remove the `terminal` tab definition from `SettingsView.tsx`.
2. Remove the tab’s content mapping so the settings view no longer attempts to render `TerminalSettingsSection`.
3. Remove now-unused imports such as the terminal-specific icon and section import.
4. Delete `TerminalSettingsSection.tsx`.
5. Delete `TerminalOutputLineLimitSlider.tsx`.
6. Delete the terminal-settings webview test and Storybook story.

### Design note

It is better to **delete** the terminal-specific section files than to leave dormant components around. Leaving them in place makes the codebase look as though the feature may still be intended to exist.

---

## 9. Workstream 2: Remove `terminalOutputLineLimit` as a Setting While Preserving Internal Output Limiting

### Why this workstream exists

This is the more subtle of the two settings.

The output-line-limit slider is user-facing configuration, but the underlying behavior—truncating output before it is fed back to the model—is still useful and still needed. The cleanup must therefore separate the **setting** from the **runtime policy**.

### Desired behavioral result

After this workstream:

- users cannot configure the output-line limit,
- the extension no longer persists or transmits the value,
- but the background terminal runtime still uses a fixed internal limit,
- specifically the existing default policy unless the product decides otherwise.

### Primary files

- `src/shared/storage/state-keys.ts`
- `src/shared/ExtensionMessage.ts`
- `webview-ui/src/context/ExtensionStateContext.tsx`
- `src/core/controller/index.ts`
- `src/core/controller/state/updateSettings.ts`
- `src/core/task/index.ts`
- `src/integrations/terminal/CommandExecutor.ts`
- `src/integrations/terminal/standalone/StandaloneTerminalManager.ts`
- `proto/cline/state.proto`
- `src/shared/proto/cline/state.ts`

### Implementation steps

1. Remove `terminalOutputLineLimit` from `src/shared/storage/state-keys.ts`.
2. Regenerate state/proto surfaces with `npm run protos`.
3. Remove the field from `ExtensionState` so the webview no longer expects it.
4. Remove webview default/hydration code for the field in `ExtensionStateContext.tsx`.
5. Remove controller handling of `request.terminalOutputLineLimit` in `updateSettings.ts`.
6. Remove controller reads of that setting in `src/core/controller/index.ts`.
7. Remove the field from `TaskParams` and any related constructor plumbing.
8. Remove the call that applies the setting to the terminal manager.
9. Ensure the runtime still uses `DEFAULT_TERMINAL_OUTPUT_LINE_LIMIT` internally.
10. Simplify any compatibility copy logic that only existed to propagate the deleted setting.

### Important architectural explanation

The background terminal manager should still be responsible for deciding how much output is returned to the model. That is still necessary to protect token usage, memory use, and readability.

What changes here is **where the decision comes from**.

- Before: the value came from persisted user settings.
- After: the value comes from a runtime-owned constant/default.

That is the core architectural move.

### Proto and compatibility guidance

`UpdateSettingsRequest` currently uses field number `12` for `terminal_output_line_limit`.

When removing it, the team should explicitly review `proto/cline/state.proto` after regeneration and decide whether to reserve the slot manually, for example:

```proto
reserved 12; // was terminal_output_line_limit
```

Even if the generator keeps existing numbers stable for surviving fields, deleted field numbers should be handled consciously so they do not get accidentally reused later.

---

## 10. Workstream 3: Remove `terminalReuseEnabled` as a Setting While Preserving Internal Aggressive Reuse

### Why this workstream exists

This setting is conceptually similar to the output-line-limit setting, but the behavioral goal is even simpler: aggressive background terminal reuse should remain on by default, and users should no longer be asked to manage it.

### Desired behavioral result

After this workstream:

- users cannot disable aggressive terminal reuse from settings,
- the setting is no longer stored or transmitted,
- background terminals are still aggressively reused,
- and `true` becomes the fixed internal default behavior.

### Primary files

- `src/shared/storage/state-keys.ts`
- `src/shared/ExtensionMessage.ts`
- `webview-ui/src/context/ExtensionStateContext.tsx`
- `src/core/controller/index.ts`
- `src/core/controller/state/updateSettings.ts`
- `src/core/controller/state/updateTerminalReuseEnabled.ts`
- `src/core/task/index.ts`
- `src/integrations/terminal/CommandExecutor.ts`
- `src/integrations/terminal/standalone/StandaloneTerminalManager.ts`
- `proto/cline/state.proto`
- `src/shared/proto/cline/state.ts`

### Implementation steps

1. Remove `terminalReuseEnabled` from `state-keys.ts`.
2. Regenerate proto/state surfaces with `npm run protos`.
3. Remove the field from `ExtensionState`.
4. Remove any webview state defaults/hydration related to it.
5. Remove `request.terminalReuseEnabled` handling from `updateSettings.ts`.
6. Remove controller reads of the field in `src/core/controller/index.ts`.
7. Remove the field from `TaskParams` and any constructor plumbing.
8. Remove task-level application of the setting to the terminal manager.
9. Delete `src/core/controller/state/updateTerminalReuseEnabled.ts`.
10. Remove any remaining references to the deleted handler or RPC.
11. Simplify any terminal-manager compatibility copy logic that only existed to preserve this configurability.

### Important architectural explanation

This workstream is about making reuse a **runtime policy** rather than a **user preference**.

That means the background terminal manager should simply retain its internal default of `true`. No higher layer should need to thread that value down anymore.

The more layers that stop caring about reuse as a configurable setting, the clearer the architecture becomes.

### Proto and RPC guidance

This setting currently appears in two important proto places:

1. `UpdateSettingsRequest` field `9` (`terminal_reuse_enabled`)
2. `StateService.updateTerminalReuseEnabled(BooleanRequest)`

Both should be removed.

The team should also explicitly review whether to reserve the deleted field number in `UpdateSettingsRequest`, for example:

```proto
reserved 9; // was terminal_reuse_enabled
```

The RPC removal matters because it prevents the repository from advertising a stale settings contract after the setting itself is gone.

---

## 11. Workstream 4: Simplify Runtime Plumbing After Configurability Is Gone

### Why this workstream exists

Removing settings often leaves behind compatibility seams that are no longer justified.

Examples in this case include:

- task constructor parameters that only existed to carry removed settings,
- setter calls that no longer need external inputs,
- fallback manager-copy logic in `CommandExecutor` whose purpose was to preserve configurable behavior across manager instances.

### Primary files

- `src/core/task/index.ts`
- `src/integrations/terminal/CommandExecutor.ts`
- `src/integrations/terminal/standalone/StandaloneTerminalManager.ts`
- `src/integrations/terminal/types.ts`

### Implementation steps

1. Remove deleted setting fields from task/runtime type definitions.
2. Remove terminal-manager configuration calls that no longer have meaning.
3. Review whether setter methods such as `setTerminalReuseEnabled(...)` and `setTerminalOutputLineLimit(...)` still serve a legitimate internal purpose.
4. Remove any runtime code whose only reason to exist was to mirror or forward the deleted settings.

### Design guidance

This is the place where developers should be disciplined about **bounded cleanup**.

The goal is not to “finally clean up the whole terminal architecture.” The goal is narrower:

- if configurability disappears, code that only supported configurability should disappear too.

If a method or type still provides a useful internal seam, it may remain. If it is now only scaffolding for removed settings, it should go.

---

## 12. Workstream 5: Clean Up Generated Surfaces, Tests, Stories, and References

### Why this workstream exists

Even when runtime behavior is correct, stale artifacts can leave the repository in a misleading state. That is especially true in a codebase with generated types, tests, stories, and documentation that all reflect the intended architecture.

### Primary files and surfaces

- `proto/cline/state.proto`
- `src/shared/proto/cline/state.ts`
- `src/shared/storage/__tests__/state-keys.test.ts`
- `src/integrations/terminal/__tests__/CommandExecutor.test.ts`
- webview tests/stories already noted above
- comments and docs referring to the removed settings/UI

### Implementation steps

1. Regenerate state/proto surfaces.
2. Review generated TypeScript output for deleted settings/RPCs.
3. Update tests that still assert the existence or propagation of the deleted settings.
4. Remove stories that describe the terminal settings UI as a supported product surface.
5. Search for lingering user-facing strings such as:
   - `Terminal Settings`
   - `Enable aggressive terminal reuse`
   - `Terminal output limit`
6. Remove or update comments that describe those settings as product behavior.

### Important explanation for maintainers

This workstream is not cosmetic. Repositories accumulate “architectural residue”: tests, stories, comments, and generated interfaces that continue to describe old behavior long after the product has moved on.

If this cleanup is skipped, future developers will have to rediscover the same architectural truth the hard way.

---

## 13. Generated Code and Schema Guidance

This section exists because this repository’s settings architecture is generated in part from `state-keys.ts`, and that makes field removal slightly more subtle than ordinary hand-edited settings cleanup.

### 13.1 Source of truth model

The important chain is:

1. `src/shared/storage/state-keys.ts` defines settings/state fields.
2. `scripts/generate-state-proto.mjs` reads that file.
3. `proto/cline/state.proto` is regenerated from that source.
4. generated TypeScript surfaces such as `src/shared/proto/cline/state.ts` are regenerated from the proto.

This means developers should think of these changes as a **schema cleanup**, not merely as a handful of UI edits.

### 13.2 What to review after regeneration

After `npm run protos`, review at least the following deliberately:

- that the deleted settings no longer appear in `UpdateSettingsRequest`,
- that generated TS message types no longer expose them,
- that `updateTerminalReuseEnabled` is gone if removed from the proto service,
- that field-number handling remains safe.

### 13.3 Field-number hygiene

Deleted proto fields should not be treated casually. Even if this is an internal contract, the repository should still preserve clarity around removed fields.

The relevant field numbers currently are:

- `9` for `terminal_reuse_enabled`
- `12` for `terminal_output_line_limit`

Recommended practice is to review whether explicit `reserved` entries should be added for those field numbers after deletion.

That makes the removal self-documenting and reduces the chance of accidental future reuse.

---

## 14. Validation Strategy

Validation should aim to prove two things:

1. the settings/UI are truly gone, and
2. the background terminal runtime still behaves correctly.

### 14.1 Recommended automated commands

Use the repository’s existing scripts:

1. `npm run protos`
2. `npm run check-types`
3. `npm run lint`
4. `npm run build:webview`
5. `npm run compile`
6. `npm run test:unit`
7. `npm run test:webview`

If the change surface ends up larger than expected, add:

8. `npm run test:integration`

### 14.2 Runtime behaviors that should still be true afterward

After implementation, developers should verify that:

- the settings UI no longer contains a Terminal tab,
- background commands still execute successfully,
- command output is still truncated or summarized appropriately when large,
- background terminal reuse still happens in ordinary compatible command sequences,
- the webview does not crash due to missing extension-state fields,
- and no stale RPC or generated type is still being referenced at runtime.

### 14.3 How to debug if something fails

If regressions appear, inspect the system in this order:

#### A. Generated-surface drift

- Was `npm run protos` run after editing `state-keys.ts`?
- Do generated TS types match the new proto?

#### B. Webview-state mismatch

- Was the field removed from `ExtensionState`?
- Was it also removed from `ExtensionStateContext` defaults/hydration?
- Is any webview component still destructuring the deleted field?

#### C. Controller/task mismatch

- Did the controller stop reading and passing the deleted settings?
- Did `TaskParams` stop expecting them?

#### D. Runtime-policy regression

- Does the background terminal manager still enforce output limiting internally?
- Does aggressive reuse still default to `true` internally?

#### E. Test expectations that now describe old behavior

- Are failures caused by stale tests rather than real product regressions?

---

## 15. File Touch List

This is a compact reference list for the development team.

### UI and webview

- `webview-ui/src/components/settings/SettingsView.tsx`
- `webview-ui/src/components/settings/sections/TerminalSettingsSection.tsx`
- `webview-ui/src/components/settings/TerminalOutputLineLimitSlider.tsx`
- `webview-ui/src/components/settings/sections/TerminalSettingsSection.spec.tsx`
- `webview-ui/src/components/settings/sections/TerminalSettingsSection.stories.tsx`
- `webview-ui/src/context/ExtensionStateContext.tsx`

### Shared state/types

- `src/shared/storage/state-keys.ts`
- `src/shared/ExtensionMessage.ts`
- `src/shared/storage/__tests__/state-keys.test.ts`

### Controller/runtime

- `src/core/controller/index.ts`
- `src/core/controller/state/updateSettings.ts`
- `src/core/controller/state/updateTerminalReuseEnabled.ts`
- `src/core/task/index.ts`
- `src/integrations/terminal/CommandExecutor.ts`
- `src/integrations/terminal/standalone/StandaloneTerminalManager.ts`
- `src/integrations/terminal/__tests__/CommandExecutor.test.ts`

### Proto/generated

- `proto/cline/state.proto`
- `src/shared/proto/cline/state.ts`
- `scripts/generate-state-proto.mjs` (for reference; probably not to modify unless needed)

---

## 16. Acceptance Criteria

The work should be considered complete when all of the following are true:

- The settings UI no longer exposes a Terminal Settings tab.
- There is no user-facing terminal output limit slider.
- There is no user-facing aggressive terminal reuse toggle.
- `terminalOutputLineLimit` no longer exists as extension state, settings request input, or task/runtime wiring.
- `terminalReuseEnabled` no longer exists as extension state, settings request input, or task/runtime wiring.
- The background terminal runtime still truncates output using fixed internal defaults.
- The background terminal runtime still aggressively reuses compatible terminals by default.
- The dedicated `updateTerminalReuseEnabled` RPC/handler is gone.
- Generated TypeScript/proto surfaces match the new architecture.
- The extension builds and relevant tests pass.

---

## 17. Recommended Search Audit Before Marking the Work Finished

Before closing the work, run targeted searches for the removed settings and related strings. At minimum, review results for:

- `terminalReuseEnabled`
- `terminalOutputLineLimit`
- `updateTerminalReuseEnabled`
- `TerminalSettingsSection`
- `TerminalOutputLineLimitSlider`
- `Enable aggressive terminal reuse`
- `Terminal Settings`

Any remaining result should be classified deliberately as one of:

- legitimate internal behavior that should still exist,
- generated code that has not yet been regenerated,
- stale code that should still be deleted,
- or intentional historical/documentation context.

The point of this audit is to make sure the repository tells one coherent story when the work is done.

---

## 18. Final Guidance for the Implementation Team

The safest way to think about this work is:

- **do not redesign the terminal system**,
- **do not remove background terminal capabilities that still matter**,
- **do remove the obsolete settings surface and the plumbing that only exists to support it**.

The architectural truth we want the codebase to express afterward is simple:

- Cline in VS Code uses the background terminal runtime.
- Output limiting and aggressive reuse are internal runtime policies.
- Users are no longer asked to configure those policies through a Terminal Settings UI.

If the implementation preserves that truth consistently across UI, state, controller, runtime, proto, and tests, then the cleanup is successful.
