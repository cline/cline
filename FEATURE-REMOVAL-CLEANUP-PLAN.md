# Feature Removal Cleanup Plan

## Purpose of this document

This document is a **standalone implementation plan** for cleaning up features that are being removed as part of the SDK migration work in this branch.

It is written to help a developer contribute effectively **without needing to reconstruct the full planning conversation** that led to it.

The goal is not just to delete old code. The goal is to:

- remove product surfaces for features that are no longer part of the intended product,
- delete truly defunct code and tests when it is safe to do so,
- update product documentation so it describes the product we are actually building,
- avoid breaking the branch while it is still in a transitional architecture,
- use the new debugging and verification tools to catch and fix regressions during cleanup.

This plan assumes the codebase is in an **active SDK migration state**, where some old systems are already deprecated in the target architecture but may still exist temporarily for compatibility.

---

## Executive summary

This branch is **not** a finished replacement of the classic extension with the SDK. It is a **staged migration**.

The current development strategy is:

1. Keep the existing user-facing webview UI.
2. Introduce a new SDK adapter layer under `src/sdk/`.
3. Preserve existing settings, task history, and credentials.
4. Gradually move the webview from legacy gRPC-over-`postMessage` communication to typed JSON messages.
5. Delete classic systems only after replacements are proven to work.

Because of that, cleanup work must be done carefully. Some code is:

- **fully dead and safe to remove now**,
- **deprecated but still temporarily required**, or
- **user-visible but still backed by compatibility shims**.

This plan is designed to help the team distinguish among those cases.

---

## Architectural vision overview

### What is changing overall?

Historically, the VS Code extension used a large classic implementation under areas like:

- `src/core/`
- `src/standalone/`
- `proto/cline/`
- generated protobuf and conversion layers

This branch introduces a new SDK-backed path centered on:

- `src/sdk/SdkController.ts`
- `src/sdk/cline-session-factory.ts`
- `src/sdk/grpc-handler.ts`
- `src/sdk/webview-grpc-bridge.ts`
- `src/shared/WebviewMessages.ts`

The intended future state is:

- the SDK handles the core agent/session behavior,
- the webview communicates with the extension using typed JSON messages,
- old product concepts that are no longer part of the vision are removed,
- legacy compatibility code is deleted once the replacement path is solid.

### Why cleanup is tricky in this branch

This branch contains a **transitional architecture**.

That means two statements can be true at the same time:

- “This feature is removed from the long-term product direction.”
- “Some remnants of this feature still exist because the migration is not finished yet.”

For example, the webview is in a hybrid state:

- legacy gRPC-style request/response and streaming still exist,
- typed JSON messages are being introduced in parallel,
- some UI code is already moving toward the new path,
- some compatibility shims still translate old calls into new SDK-backed behavior.

This is why cleanup must be done **incrementally**, not as one large deletion.

### High-level intended product direction

Based on the migration and architecture documents, the intended product direction includes:

- SDK-backed core task/session execution,
- typed webview-extension messaging,
- background terminal execution rather than legacy integrated-terminal modes,
- skills instead of workflows,
- plan/act mode instead of `/deep-planning`,
- a simplified product surface with fewer legacy systems.

### Features planned for removal

The following are explicitly identified as removed, being removed, or superseded in the migration vision:

- browser automation as a built-in product feature,
- legacy terminal execution mode selection and terminal profile workflows,
- shadow-git checkpointing system,
- memory bank,
- focus chain,
- deep planning and the `/deep-planning` command,
- workflows as a product concept (replaced by skills),
- `/reportbug`,
- obsolete classic-core and proto/gRPC plumbing once migration replacement is complete.

### Important caveat

“Removed from the vision” does **not automatically** mean “safe to delete immediately.”

Some items can be removed from:

- docs,
- UI/product copy,
- settings surfaces,
- command registries,

before they can safely be removed from:

- bridge code,
- persistence keys,
- runtime handlers,
- tests,
- build scripts,
- generated artifacts.

---

## What this cleanup effort is trying to accomplish

This cleanup work is responsible for the practical job of:

- removing features we are deleting from `main`,
- deleting defunct or no-longer-correct tests,
- updating product documentation,
- simplifying product surfaces to match the new vision,
- identifying places where cleanup reveals missing migration work,
- fixing minor regressions uncovered during cleanup rather than papering over them.

This work is **not** responsible for inventing the SDK migration itself. It is a cleanup-and-alignment effort that supports the migration.

---

## Guiding principles

- [ ] Treat cleanup as migration work, not cosmetic pruning.
- [ ] Prefer small, reviewable slices over broad deletion sweeps.
- [ ] Do not delete anything just because it looks old.
- [ ] Require evidence before removal.
- [ ] Verify behavior after every slice.
- [ ] Use the debug harness for interactive verification on risky slices.
- [ ] Update docs and product copy as part of the same effort, not as an afterthought.
- [ ] Keep a clear record of what is safe now, what is blocked, and why.

---

## The cleanup operating model

This plan uses two tools together:

1. a **cleanup rubric**, and
2. a **cleanup ledger**.

The rubric is how we make decisions.

The ledger is how we track those decisions and the evidence behind them.

### Why both are needed

Without a rubric, people make inconsistent decisions.

Without a ledger, people repeat investigation work, lose context, and accidentally delete something that another developer already determined was blocked.

Together, they create a lightweight but disciplined process.

---

## Cleanup rubric

### What the rubric is for

The rubric is a standard checklist used on **every cleanup candidate** before code is removed.

Its job is to answer:

- Is this truly safe to remove now?
- Should it only be hidden for now?
- Is it blocked on migration work that is not finished yet?
- What level of verification do we need before and after touching it?

### How to score the rubric

For each cleanup candidate, score each category as:

- **Green** = safe / understood / low concern
- **Yellow** = partially understood / some dependency remains / caution required
- **Red** = active dependency or blocker / do not remove yet
- **Unknown** = not yet investigated enough

### Rubric categories

#### 1. User-visible surface

Questions:

- Is this still visible to users in docs, settings, UI text, tooltips, commands, walkthroughs, onboarding, or help text?
- Is it advertised as a feature?

Meaning:

- If a feature is removed from the product vision but still visible to users, there is often a strong case to clean up the product surface early.
- This does **not** mean internals can automatically be deleted.

#### 2. Current runtime dependency

Questions:

- Is the current branch still calling this code path at runtime?
- Are there direct imports, handlers, subscriptions, UI callbacks, or state-builder defaults still relying on it?

Meaning:

- If the runtime still depends on it, deletion is risky.
- This is one of the most important categories.

#### 3. Bridge dependency

Questions:

- Is the cleanup candidate still required by compatibility code?
- Is it still serving the webview ↔ extension bridge, gRPC shim, typed-message transition, or legacy controller glue?

Meaning:

- Many things that appear obsolete are still bridge-dependent.
- Anything tied to transitional layers must be treated carefully.

#### 4. Persistence and state coupling

Questions:

- Are there stored settings, task history fields, migrations, defaults, or disk-backed files tied to this feature?
- Would deleting this feature change how existing user data is interpreted?

Meaning:

- Cleanup may trigger subtle state regressions.
- This is especially relevant for settings cleanup.

#### 5. Replacement readiness

Questions:

- Is the intended replacement actually implemented and working now?
- Is the new path verified, or only planned?

Meaning:

- A feature should not be hard-deleted if its replacement is still theoretical.

#### 6. Test impact

Questions:

- Are there tests that still depend on the old feature?
- Do replacement tests exist for the new behavior?

Meaning:

- Some tests are defunct and should be deleted.
- Some tests are old but still provide valuable coverage until replacement coverage exists.

#### 7. Verification difficulty

Questions:

- Can we prove this change is safe with search and typecheck alone?
- Do we need SDK tests?
- Do we need interactive UI verification?
- Do we need the debug harness?

Meaning:

- The higher the difficulty, the smaller the cleanup slice should be.

#### 8. Parallel-work coupling

Questions:

- Is another teammate actively modifying this same boundary?
- Is the candidate likely to change under us while we are cleaning it up?

Meaning:

- Strong coupling means higher coordination cost and higher merge risk.

### Rubric-based decisions

After scoring the categories, classify the candidate into one of these outcomes.

#### Delete now

Use this when:

- runtime dependency is Green,
- bridge dependency is Green,
- persistence coupling is Green or negligible,
- replacement readiness is Green if a replacement is needed,
- verification plan is feasible.

Typical examples:

- stale product copy,
- removed command listings that no longer have legitimate product meaning,
- tests for code that has already been deleted,
- docs describing removed features that the product should no longer advertise.

#### Hide now, retain internals

Use this when:

- the feature should no longer be visible to users,
- but internals are still temporarily needed.

Typical examples:

- settings controls whose underlying state is still temporarily flowing through compatibility code,
- commands that should disappear from the UI before backend deletion,
- product help text that should stop advertising a feature before the last implementation pieces disappear.

#### Blocked on cutover

Use this when:

- runtime or bridge dependency is Red,
- replacement readiness is Red,
- or a teammate is still actively landing the replacement path.

Typical examples:

- proto/gRPC deletion while the webview still uses legacy paths,
- removal of state or handlers that the compatibility bridge still requires,
- anything tied to MCP if the SDK-side MCP wiring is not finished.

#### Investigate first

Use this when:

- evidence is weak,
- dependency state is unclear,
- or search results are contradictory.

This is a valid outcome. It is better to investigate than to guess.

---

## Verification classes

Each candidate should also receive a verification class.

### Low verification

Use when the slice is limited to:

- product copy,
- docs,
- comments,
- obviously dead references.

Typical verification:

- search for remaining references,
- typecheck if code was touched,
- quick UI sanity check if user-facing text changed.

### Medium verification

Use when the slice touches:

- UI affordances,
- settings controls,
- command registration,
- state-builder fields,
- slash commands,
- non-critical bridge-adjacent code.

Typical verification:

- search,
- typecheck,
- relevant test subset,
- manual or debug-harness-assisted UI check.

### High verification

Use when the slice touches:

- bridge code,
- webview messaging,
- gRPC compatibility layers,
- persistence/state interpretation,
- task flow,
- auth,
- history,
- MCP,
- terminal execution behavior.

Typical verification:

- search,
- typecheck,
- `npm run test:sdk`,
- additional targeted tests if applicable,
- debug harness validation,
- reload/restart verification,
- persistence verification.

---

## Cleanup ledger

### What the ledger is for

The ledger is the living tracking table for every cleanup candidate.

It should answer, at any time:

- what we found,
- what we decided,
- why we decided it,
- who owns it,
- what remains blocked,
- how we verified it,
- what uncertainty still exists.

### How the ledger should be maintained

- Add a row as soon as a plausible cleanup candidate is discovered.
- Update the row after investigation.
- Update the row again after implementation.
- Do not rely on memory or scattered notes.

### Working cleanup ledger

| Candidate | Category | Target outcome | Evidence | User-visible surface | Runtime dependency | Bridge dependency | Persistence coupling | Replacement path | Replacement readiness | Tests affected | Docs affected | Parallel-work coupling | Risk | Decision | Verification class | Verification plan | Owner | Status | Last findings | Next step |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/deep-planning` | docs / slash commands | Remove command and replace docs guidance with Plan mode | `src/shared/slashCommands.ts`, `docs/core-workflows/using-commands.mdx`, `docs/core-workflows/plan-and-act.mdx`, `docs/docs.json`, doc searches on 2026-04-07, verification artifact `feature-removal-verify-slice-1-final/summary.md` | Green | Green | Green | Green | Plan mode + written implementation plans | Green | `src/test/slash-commands.test.ts` | `docs/core-workflows/using-commands.mdx`, `docs/core-workflows/plan-and-act.mdx`, `docs/contributing/documentation-guide.mdx`, `docs/features/focus-chain.mdx`, `docs/features/memory-bank.mdx`, `docs/getting-started/your-first-project.mdx`, `docs/docs.json` | Low | Low | Delete now | Low | Search for remaining references, run slash-command test, refresh prompt snapshots, note branch-wide typecheck blockers | Cline | Verified | Command removed from user-facing slash command surfaces, docs retargeted to Plan mode, and prompt snapshots refreshed successfully | Move to the next Tier 1 cleanup slice |
| `/reportbug` product surface | docs / tips / prompts / slash commands | Hide the command from user-facing surfaces while retaining compatibility internals for now | `src/shared/slashCommands.ts`, `src/core/controller/slash/reportBug.ts`, `src/sdk/grpc-handler.ts`, `src/shared/WebviewMessages.ts`, `webview-ui/src/components/chat/FeatureTip.tsx`, `cli/src/components/FeatureTip.tsx`, prompt template searches on 2026-04-07, verification artifact `feature-removal-verify-slice-1-final/summary.md` | Green | Yellow | Yellow | Green | GitHub issues + existing internal feedback/reporting plumbing | Yellow | `src/test/slash-commands.test.ts` | tips, docs, prompt templates | Low | Medium | Hide now, retain internals | Medium | Search for remaining user-facing references, run slash-command test, refresh prompt snapshots, note branch-wide typecheck blockers | Cline | Verified | User-facing slash-command exposure, tips, and prompt guidance were removed; compatibility handlers remain intentionally in place for now | Revisit runtime/plumbing cleanup after bridge cutover work advances |
| workflows references in user-facing product surfaces | docs / product copy | Reframe workflows as a legacy compatibility path and direct new users toward skills | `docs/customization/workflows.mdx`, `docs/customization/overview.mdx`, `docs/core-workflows/using-commands.mdx`, `docs/cline-cli/configuration.mdx`, workflows scan artifact `feature-removal-workflows-scan/summary.md`, verification artifact `feature-removal-workflows-verify/summary.md` | Green | Yellow | Yellow | Yellow | Skills for new reusable guidance, legacy workflows only for compatibility | Green | none | `docs/customization/workflows.mdx`, `docs/customization/overview.mdx`, `docs/core-workflows/using-commands.mdx`, `docs/cline-cli/configuration.mdx` | Low | Low | Hide now, retain internals | Low | Search docs for remaining product-surface workflow references and verify no runtime/UI behavior changed | Cline | Verified | Main customization and CLI docs now frame workflows as a legacy compatibility path and direct new reusable behavior toward skills; remaining mentions are intentional compatibility/reference language | Move to the next Tier 1 or Tier 2 slice and reassess workflow UI affordances |
| workflow UI affordances in CLI config | CLI UI / settings surface | Relabel the workflow management tab as legacy so the CLI no longer presents workflows as a first-class feature | `cli/src/components/ConfigView.tsx`, `cli/src/components/ConfigViewComponents.tsx`, workflow UI scan artifact `feature-removal-workflow-ui-scan/summary.md` | Green | Yellow | Yellow | Yellow | Skills for new reusable guidance, workflow toggles retained temporarily for compatibility | Green | none | `cli/src/components/ConfigView.tsx`, `cli/src/components/ConfigViewComponents.tsx` | Low | Low | Hide now, retain internals | Low | Run focused CLI Biome check and keep compatibility plumbing unchanged | Cline | Verified | CLI config now labels the workflow tab, section headers, and empty state as legacy while leaving the toggle machinery intact | Reassess whether any remaining workflow UI affordances should be hidden in other surfaces |
| workflow product copy in secondary docs surfaces | docs / product copy | Remove the last high-visibility workflow-as-primary wording from secondary docs surfaces | `docs/home.mdx`, `docs/cline-cli/installation.mdx`, `docs/contributing/documentation-guide.mdx`, low-risk leftovers scan artifact `feature-removal-low-risk-leftovers-scan/summary.md` | Green | Green | Green | Green | Skills for new reusable guidance, legacy workflows only where explicitly called out | Green | none | `docs/home.mdx`, `docs/cline-cli/installation.mdx`, `docs/contributing/documentation-guide.mdx` | Low | Low | Hide now, retain internals | Low | Search the touched docs for remaining workflow product-copy language and verify only generic/non-product uses remain | Cline | Verified | Secondary docs now use legacy-workflow phrasing where product copy previously presented workflows as a primary feature; remaining workflow mentions are generic process language or intentional legacy references | Move to the next cleanup stream |
| memory bank product surfaces | docs / product copy | Demote Memory Bank from primary feature navigation and frame it as a legacy/manual approach | `docs/features/memory-bank.mdx`, `docs/home.mdx`, `docs/customization/clineignore.mdx`, `docs/docs.json`, memory/focus scan artifact `feature-removal-memory-focus-scan/summary.md`, verification artifact `feature-removal-memory-verify/summary.md` | Green | Green | Green | Green | Plan & Act mode, task management, Cline Rules, and built-in context tools | Green | none | `docs/features/memory-bank.mdx`, `docs/home.mdx`, `docs/customization/clineignore.mdx`, `docs/docs.json` | Low | Low | Hide now, retain internals | Low | Search docs for remaining high-visibility Memory Bank references and verify redirects/navigation still work | Cline | Verified | Memory Bank has been removed from primary home/navigation surfaces and reframed as a legacy manual pattern; remaining references are intentional legacy-page and redirect coverage | Reassess focus-chain product surfaces next |
| focus chain product surfaces | docs / product copy | Demote Focus Chain from primary feature navigation and frame it as a legacy checklist mode | `docs/features/focus-chain.mdx`, `docs/features/auto-compact.mdx`, `docs/docs.json`, memory/focus scan artifact `feature-removal-memory-focus-scan/summary.md`, verification artifact `feature-removal-focus-verify/summary.md` | Green | Yellow | Yellow | Yellow | Plan & Act mode plus built-in task_progress checklists | Yellow | none | `docs/features/focus-chain.mdx`, `docs/features/auto-compact.mdx`, `docs/docs.json` | Low | Medium | Hide now, retain internals | Low | Search docs for remaining high-visibility Focus Chain references and avoid touching the active runtime setting surface yet | Cline | Verified | Focus Chain has been removed from primary docs navigation and reframed as a legacy checklist mode; remaining references are intentional legacy-page, runtime-setting, or redirect coverage | Reassess whether the still-live settings label should be relabeled in a later UI slice |
| focus chain settings surface | webview UI / settings copy | Relabel the still-live Focus Chain setting as legacy without changing runtime behavior | `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`, `webview-ui/src/components/settings/UseCustomPromptCheckbox.tsx`, focus scan artifact `feature-removal-memory-focus-scan/summary.md` | Green | Yellow | Yellow | Yellow | Plan & Act mode plus built-in task_progress checklists | Yellow | none | `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`, `webview-ui/src/components/settings/UseCustomPromptCheckbox.tsx` | Low | Medium | Hide now, retain internals | Low | Run focused webview search/Biome checks and keep active checklist/runtime plumbing intact | Cline | Verified | The remaining user-facing Focus Chain settings copy now calls the feature legacy while leaving the live checklist/task-header behavior untouched | Reassess whether any stronger hide/remove action is safe or move to another cleanup stream |
| task_progress prompt coupling to focus chain | prompts / runtime guidance | Decouple task_progress prompt guidance from the Focus Chain feature flag so checklist guidance matches the current product direction | `src/core/prompts/system-prompt/components/task_progress.ts`, `src/core/prompts/system-prompt/components/tool_use/tools.ts`, `src/core/prompts/system-prompt/components/tool_use/examples.ts`, `src/core/prompts/system-prompt/components/tool_use/formatting.ts`, `src/core/prompts/contextManagement.ts`, `src/core/prompts/commands.ts`, `src/core/prompts/system-prompt/__tests__/integration.test.ts`, `src/core/prompts/system-prompt/__tests__/test-helpers.ts`, post-doc stream scan artifact `feature-removal-post-doc-stream-scan/summary.md` | Yellow | Yellow | Yellow | Yellow | Built-in task_progress guidance independent of legacy Focus Chain UI/runtime | Yellow | `src/core/prompts/system-prompt/__tests__/integration.test.ts` and affected snapshots | prompt system / summarize/condense guidance | Medium | Medium | Hide now, retain internals | Medium | Run focused prompt integration tests, refresh only the affected snapshots, and keep Focus Chain runtime plumbing intact | Cline | Verified | Prompt generation now includes task_progress guidance even when Focus Chain is disabled, and the focused integration test plus updated no-focus-chain snapshots verify the new behavior without touching Focus Chain runtime plumbing | Reassess deeper Focus Chain runtime cleanup |
| feedback prompt coupling to focus chain | prompts / runtime guidance | Ensure bug-report/help guidance remains available even when Focus Chain is disabled | `src/core/prompts/system-prompt/components/feedback.ts`, `src/core/prompts/system-prompt/variants/generic/config.ts`, `src/core/prompts/system-prompt/__tests__/integration.test.ts`, post-doc stream scan artifact `feature-removal-post-doc-stream-scan/summary.md` | Yellow | Green | Green | Green | Shared feedback/help guidance independent of legacy checklist mode | Green | `src/core/prompts/system-prompt/__tests__/integration.test.ts` and affected snapshots | prompt system feedback/help section | Low | Medium | Hide now, retain internals | Medium | Run focused prompt integration tests, refresh the affected snapshots, and keep Focus Chain runtime plumbing untouched | Cline | Verified | Feedback/help guidance now remains present when Focus Chain is disabled, and the focused integration test plus affected snapshots verify the corrected prompt wiring | Continue triaging remaining Focus Chain runtime remnants |
| focus chain file-open affordance in task header | webview UI / product surface | Remove the stale “open/edit focus chain file” affordance now that the backend file-open path is a removed-feature stub | `webview-ui/src/components/chat/task-header/FocusChain.tsx`, `webview-ui/src/components/chat/task-header/TaskHeader.tsx`, `src/core/controller/file/openFocusChainFile.ts`, focus-chain inventory search on 2026-04-07 | Green | Green | Green | Green | Passive checklist display in the task header without dead file-open actions | Green | none | task header UI only | Low | Low | Hide now, retain internals | Low | Run focused webview Biome checks and avoid changing checklist rendering or task-progress parsing behavior | Cline | Verified | The task header no longer exposes the dead file-open/edit affordance, and focused webview checks confirmed there are no remaining `openFocusChainFile` calls from the webview while checklist rendering stays intact | Continue triaging deeper Focus Chain remnants |
| dead focus chain telemetry hooks | telemetry / runtime cleanup | Remove uncalled Focus Chain progress/list telemetry methods and event constants while retaining the still-used enable/disable toggle telemetry | `src/services/telemetry/TelemetryService.ts`, focus-chain telemetry inventory on 2026-04-07 | Green | Green | Green | Green | Retain only the live Focus Chain toggle telemetry path while removing orphaned progress/list telemetry | Green | none | telemetry implementation only | Low | Low | Delete now | Low | Search for remaining callers of the removed telemetry methods/constants and run focused TypeScript/Biome checks | Cline | Verified | Focus Chain progress/list telemetry methods and event constants were removed, focused Biome checks pass, and there are no remaining source callers for the deleted hooks while the toggle telemetry path remains intact | Continue triaging other Focus Chain remnants |
| openFocusChainFile proto/gRPC remnant | proto / generated bridge / controller stub | Remove the obsolete Focus Chain file-open RPC and generated compatibility wiring now that no webview/runtime callers remain | `proto/cline/file.proto`, `src/shared/WebviewMessages.ts`, `src/sdk/grpc-handler.ts`, `webview-ui/src/services/grpc-client.ts`, generated protobus/proto artifacts, `src/core/controller/file/openFocusChainFile.ts` | Green | Green | Green | Green | No replacement needed; the task header now shows checklist state without a file-open action | Green | generated clients/service types only | proto/gRPC compatibility layer | Medium | Medium | Delete now | Medium | Remove the RPC from source definitions, regenerate generated artifacts, verify no source callers remain, and keep other FileService RPCs intact | Cline | Verified | The source RPC, controller stub, generated protobus/proto client wiring, and compatibility-layer references were removed; regeneration succeeded and no `openFocusChainFile` references remain in source TypeScript or proto files | Reassess the remaining Focus Chain/runtime remnants and mark any further proto/gRPC deletions that still depend on broader cutover work |
| generic task-progress checklist UI/runtime decoupling (ranks 1-6) | webview UI / shared helpers / runtime state | Make checklist rendering and task-progress state updates work independently of the legacy Focus Chain toggle, then remove the dead `FocusChainManager` bootstrap stub | `webview-ui/src/components/chat/ChatView.tsx`, `webview-ui/src/components/chat/task-header/TaskHeader.tsx`, `webview-ui/src/components/chat/task-header/TaskProgressChecklist.tsx`, `webview-ui/src/components/common/ChecklistRenderer.tsx`, `cli/src/components/FocusChain.tsx`, `src/shared/checklist-utils.ts`, `src/core/task/ToolExecutor.ts`, `src/core/task/tools/handlers/AttemptCompletionHandler.ts`, `src/core/task/index.ts`, focused Biome check + `webview-ui`/`cli` typecheck on 2026-04-07 | Green | Green | Green | Yellow | Generic task-progress checklist experience that no longer depends on legacy Focus Chain-specific UI/runtime wiring | Green | focused UI/runtime checks only; branch-wide root `tsc` still blocked elsewhere | plan doc plus any future user-facing checklist wording | Medium | Medium | Delete now | Medium | Run focused Biome checks on touched UI/runtime files plus `webview-ui` and `cli` typechecks; note unrelated branch-wide root `tsc` blockers separately | Cline | Verified | Checklist rendering now uses actual checklist content regardless of the legacy toggle, shared parsing helpers were renamed to generic checklist terminology, task-progress state updates no longer depend on `focusChainSettings.enabled`, and the dead `FocusChainManager` bootstrap stub was removed; focused checks pass while unrelated root TypeScript blockers remain in the branch | Move to rank 7: hide the legacy Focus Chain setting from the active settings UI |
| hide legacy Focus Chain setting from active settings UI (rank 7) | webview UI / settings surface | Remove the legacy Focus Chain toggle and reminder slider from the active settings page while leaving compatibility state handling untouched | `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`, `webview-ui/src/components/settings/sections/FeatureSettingsSection.spec.tsx`, focused Biome check + focused Vitest spec on 2026-04-07 | Green | Yellow | Yellow | Yellow | Compatibility-only Focus Chain state with no active user-facing settings control | Green | focused settings spec only | settings UI copy and plan doc | Low | Medium | Hide now, retain internals | Medium | Run focused Biome checks on the settings files plus the `FeatureSettingsSection` Vitest spec; keep controller/state handling unchanged for now | Cline | Verified | The active settings UI no longer renders the legacy Focus Chain toggle or reminder interval slider, and the focused settings spec now asserts the controls stay hidden while compatibility state remains available under the hood | Move to rank 8: downgrade Focus Chain setting writes to compatibility mode |
| downgrade Focus Chain setting writes to compatibility mode (rank 8) | controller state / compatibility behavior | Keep accepting legacy `focusChainSettings` payloads but stop letting new writes re-enable the live toggle path or emit fresh Focus Chain telemetry | `src/core/controller/state/updateSettings.ts`, `src/core/controller/state/updateSettingsCli.ts`, focused Biome check on both controller files plus branch-wide `tsc` output filtered for touched handlers on 2026-04-07 | Green | Yellow | Yellow | Yellow | Compatibility-only persisted Focus Chain shape with no active behavior changes from new writes | Green | no direct handler tests currently present; relied on focused static verification | plan doc only | Low | Medium | Hide now, retain internals | Medium | Run focused Biome checks on both controller handlers and confirm branch-wide type errors do not implicate the touched files; preserve stored shape but avoid new toggle telemetry | Cline | Verified | Both controller update handlers now preserve the stored `focusChainSettings` shape without honoring incoming enable/disable flips or emitting new Focus Chain toggle telemetry, keeping the legacy field compatibility-only while avoiding broader schema removal | Reassess rank 9 prompt-family cleanup versus `/reportbug` compatibility removal and pick the narrower safe slice |
| retire unused legacy prompt families (rank 9) | prompt implementation / dead-code cleanup | Delete the orphaned legacy prompt-family files that still embed stale Focus Chain-gated task_progress/tool text | `src/core/prompts/system-prompt-legacy/families/next-gen-models/gpt-5.ts`, `src/core/prompts/system-prompt-legacy/families/local-models/compact-system-prompt.ts`, reference searches for exported symbols and file paths on 2026-04-07 | Green | Green | Green | Green | No replacement needed because the files were not wired into the active prompt registry | Green | none | plan doc only | Low | Low | Delete now | Low | Prove there are no remaining imports of the file paths or exported prompt constants, delete the files, then rerun source-reference searches and a focused typecheck grep for the removed symbols/paths | Cline | Verified | The two legacy prompt-family files had no remaining source imports or prompt-registry references, were deleted, and follow-up reference searches plus a filtered typecheck grep found no remaining references to their file paths or exported symbols | Reassess rank 10 `/reportbug` compatibility plumbing versus other remaining low-risk cleanup slices |
| retire `/reportbug` compatibility plumbing (rank 10) | slash commands / proto bridge / webview action cleanup | Remove the remaining live `/reportbug` controller, tool, slash RPC, generated bridge wiring, and webview action path now that user-facing command surfaces are gone | `src/core/controller/slash/reportBug.ts`, `src/core/task/tools/handlers/ReportBugHandler.ts`, `src/core/task/tools/ToolExecutorCoordinator.ts`, `src/shared/tools.ts`, `src/shared/ExtensionMessage.ts`, `src/shared/WebviewMessages.ts`, `src/shared/proto-conversions/cline-message.ts`, `src/sdk/grpc-handler.ts`, `src/core/prompts/contextManagement.ts`, `proto/cline/slash.proto`, regenerated slash/protobus/grpc clients, `webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts`, `webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts`, `webview-ui/src/components/chat/chat-view/shared/buttonConfig.test.ts`, `webview-ui/src/App.stories.tsx`, focused Vitest + unit-test grep on 2026-04-07 | Green | Green | Green | Green | No replacement for the removed slash command; generic feedback/help flows remain | Green | focused `buttonConfig` Vitest plus targeted unit-test grep; regenerated bridge artifacts | plan doc only | Medium | Medium | Delete now | Medium | Remove source/controller/tool/slash RPC wiring, regenerate proto/protobus artifacts, remove the last live webview utility action path, then confirm targeted unit-test grep no longer fails on generated imports and note any remaining passive `report_bug` render/schema compatibility separately | Cline | Verified | The `/reportbug` controller/tool/slash RPC path, generated slash/protobus imports, gRPC stub case, prompt mention, and live webview “Report GitHub issue” action/button/story wiring were removed; `npm run protos` regenerated the derived bridge files, the targeted slash-command unit-test grep no longer fails on generated imports, and `npx vitest run webview-ui/src/components/chat/chat-view/shared/buttonConfig.test.ts` passes. Remaining `report_bug` references are limited to passive historical message/schema/rendering compatibility (`proto/cline/ui.proto`, `webview-ui/src/components/chat/ChatRow.tsx`, `cli/src/components/ChatMessage.tsx`, `cli/src/agent/messageTranslator.ts`, and an eval fixture) rather than a live command path | Reassess whether passive historical `report_bug` message/schema compatibility should be removed in a separate broader message-schema cleanup |
| prompt constant naming still tied to focus chain | prompt implementation / maintainability | Rename residual internal `FOCUS_CHAIN_*` prompt constant names to `TASK_PROGRESS_*` now that the emitted behavior is generic task-progress guidance | `src/core/prompts/system-prompt/components/tool_use/tools.ts`, `src/core/prompts/system-prompt/components/tool_use/examples.ts` | Green | Green | Green | Green | Internal prompt code terminology that matches the current task_progress product direction | Green | none | prompt implementation internals only | Low | Low | Delete now | Low | Run focused Biome checks on the touched prompt files and keep emitted prompt text unchanged | Cline | Verified | Internal tool-use prompt identifiers now use `TASK_PROGRESS_*` naming, focused Biome checks pass, and the emitted prompt content remains unchanged | Reassess whether the remaining Focus Chain/runtime surfaces are cutover-dependent |
| tool spec docstrings still tied to focus chain gating | prompt implementation / maintainability | Remove stale `focusChainSettings.enabled` examples from live tool-spec docstrings where `task_progress` is already unconditionally supported by the tool definitions | `src/core/prompts/system-prompt/tools/plan_mode_respond.ts`, `src/core/prompts/system-prompt/tools/use_mcp_tool.ts`, `src/core/prompts/system-prompt/tools/write_to_file.ts` | Green | Green | Green | Green | Tool-spec documentation that matches the current generic task_progress behavior | Green | none | prompt implementation docstrings only | Low | Low | Delete now | Low | Run focused Biome checks on the touched tool-spec files and keep the actual tool schemas unchanged | Cline | Verified | The live tool-spec docstrings now describe `task_progress` unconditionally, focused Biome checks pass, and the actual tool schemas were left unchanged | Mark the remaining Focus Chain runtime/settings surfaces as cutover-dependent unless a narrower safe slice emerges |
| remaining focus chain runtime/settings/state surfaces | runtime / persistence / UI state | Preserve the still-wired Focus Chain state/settings/task plumbing until a broader cutover removes the feature end-to-end | `src/core/task/index.ts`, `src/core/task/TaskState.ts`, `src/core/task/ToolExecutor.ts`, `src/core/controller/state/updateSettings.ts`, `src/core/controller/state/updateSettingsCli.ts`, `src/shared/ExtensionMessage.ts`, `src/shared/storage/state-keys.ts`, `src/sdk/state-builder.ts`, `webview-ui/src/context/ExtensionStateContext.tsx`, `webview-ui/src/components/chat/ChatView.tsx`, `webview-ui/src/components/chat/task-header/TaskHeader.tsx`, focus-chain runtime inventory on 2026-04-07 | Yellow | Red | Yellow | Red | Eventual task_progress/checklist experience without legacy Focus Chain-specific state/settings plumbing | Yellow | multiple prompt/task/runtime tests would need coordinated updates | runtime state, settings, webview state hydration | Medium | High | Blocked on cutover | High | Do not delete piecemeal; wait for a coordinated runtime/state cutover with persistence, UI, and task-flow verification | Cline | Blocked | Remaining Focus Chain references are concentrated in live task execution, persisted settings/state, extension/webview state shape, and checklist rendering paths, so further deletion would be a cross-cutting runtime migration rather than a safe cleanup slice | Leave these paths in place for now and revisit after the broader runtime/state cutover is ready |
| checkpoints product copy and implementation framing | docs / product copy | Clarify that the current checkpoint experience is available but backed by an implementation detail that may change during migration | `docs/core-workflows/checkpoints.mdx`, `docs/core-workflows/task-management.mdx`, `docs/getting-started/your-first-project.mdx`, `README.md`, next-slice scan artifact `feature-removal-next-slice-scan/summary.md`, verification artifact `feature-removal-checkpoints-verify/summary.md` | Green | Yellow | Yellow | Yellow | Future rollback story beyond the current internal snapshot mechanism | Yellow | none | `docs/core-workflows/checkpoints.mdx`, `docs/core-workflows/task-management.mdx`, `docs/getting-started/your-first-project.mdx`, `README.md` | Low | Medium | Hide now, retain internals | Low | Search top docs for remaining “shadow Git” style framing and keep user-facing compare/restore guidance intact | Cline | Verified | Top-level checkpoint docs now describe the current compare/restore behavior without overcommitting to the old shadow-git implementation as the long-term product contract | Reassess checkpoint settings/UI surfaces separately or move to terminal-settings messaging |
| terminal settings messaging | webview UI / docs copy | Reframe terminal settings as fallback/compatibility controls and steer users toward background execution where possible | `webview-ui/src/components/settings/sections/TerminalSettingsSection.tsx`, `docs/troubleshooting/terminal-quick-fixes.mdx`, next-slice scan artifact `feature-removal-next-slice-scan/summary.md` | Green | Yellow | Yellow | Yellow | Background execution preferred, terminal-backed execution retained for compatibility | Yellow | none | `webview-ui/src/components/settings/sections/TerminalSettingsSection.tsx`, `docs/troubleshooting/terminal-quick-fixes.mdx` | Low | Medium | Hide now, retain internals | Low | Run focused UI/doc checks and avoid changing terminal behavior or state handling | Cline | Verified | Terminal settings and troubleshooting docs now frame VS Code terminal controls as fallback/compatibility settings while steering users toward background execution where possible | Reassess whether any deeper terminal mode removal is safe or move to another cleanup stream |

### Recommended ledger columns

| Column | Meaning |
|---|---|
| Candidate | The feature, file group, or cleanup target |
| Category | docs / UI / settings / bridge / runtime / tests / build |
| Target outcome | What “good” looks like |
| Evidence | Files searched, key references, observed behavior |
| User-visible surface | Green / Yellow / Red / Unknown |
| Runtime dependency | Green / Yellow / Red / Unknown |
| Bridge dependency | Green / Yellow / Red / Unknown |
| Persistence coupling | Green / Yellow / Red / Unknown |
| Replacement path | What replaces it, if anything |
| Replacement readiness | Green / Yellow / Red / Unknown |
| Tests affected | Which tests must be updated/removed/added |
| Docs affected | Which docs need alignment |
| Parallel-work coupling | Low / Medium / High |
| Risk | Low / Medium / High |
| Decision | Delete now / Hide now / Blocked / Investigate |
| Verification class | Low / Medium / High |
| Verification plan | Exact checks to run |
| Owner | Person responsible |
| Status | Discovered / Triaged / Ready / In progress / Verified / Blocked / Closed |
| Last findings | What we most recently learned |
| Next step | The next concrete action |

### Suggested ledger status flow

- **Discovered** — candidate identified, not yet triaged
- **Triaged** — rubric applied, evidence gathered
- **Ready** — safe cleanup slice defined
- **In progress** — implementation underway
- **Verified** — changes landed and checks passed
- **Blocked** — waiting on cutover or another dependency
- **Closed** — fully complete

### Example ledger entries

#### Example 1: `/reportbug`

Likely shape:

- User-visible surface: Green-to-remove
- Runtime dependency: likely low
- Bridge dependency: low
- Persistence coupling: none
- Replacement readiness: Green (issue reporting no longer a promoted slash command)
- Decision: Delete now or hide now
- Verification class: Low or Medium

#### Example 2: terminal settings simplification

Likely shape:

- User-visible surface: strong removal target
- Runtime dependency: moderate
- Bridge dependency: moderate/high
- Persistence coupling: high
- Replacement readiness: background-exec path exists, but cleanup must be careful
- Decision: separate dedicated slice
- Verification class: High

#### Example 3: proto/gRPC webview plumbing

Likely shape:

- User-visible surface: mostly invisible
- Runtime dependency: high
- Bridge dependency: high
- Replacement readiness: partial
- Decision: Blocked on cutover
- Verification class: High

---

## Development process for this cleanup effort

This section describes the actual working process developers should follow.

### Phase 0 — Set up the cleanup workstream

- [x] Create or choose a home for the cleanup ledger.
- [x] Seed the ledger with the first known candidates.
- [ ] Align with the teammate doing migration work on which boundaries are actively moving.
- [ ] Confirm who owns docs cleanup vs code cleanup vs bridge cleanup.
- [ ] Agree on review expectations for risky deletions.

### Phase 1 — Inventory and triage candidates

For each feature or subsystem slated for removal:

- [ ] Search product docs for references.
- [ ] Search UI/product surfaces for visible references.
- [ ] Search runtime code for imports, handlers, state, or message flow.
- [ ] Search tests for direct or indirect coverage.
- [ ] Search build/config/generated paths if relevant.
- [ ] Record findings in the ledger.
- [ ] Apply the rubric.
- [ ] Assign decision and verification class.

### Phase 2 — Execute cleanup in narrow slices

Each slice should be small enough that a reviewer can understand exactly what changed and why.

For every slice:

- [ ] Write a short slice goal.
- [ ] Define what is in scope.
- [ ] Define what is explicitly out of scope.
- [ ] List files expected to change.
- [ ] List the verification steps before editing.
- [ ] Implement the smallest useful change.
- [ ] Run verification.
- [ ] Fix regressions exposed by the slice if they are local and necessary.
- [ ] Update the ledger with evidence and outcome.

### Phase 3 — Reassess after each slice

- [ ] Re-run searches for the cleaned-up feature.
- [ ] Revisit any previously blocked candidates that may now be safe.
- [ ] Update docs alignment gaps.
- [ ] Note any newly discovered migration blockers.

### Phase 4 — Final convergence

- [ ] Ensure removed features are no longer advertised.
- [ ] Ensure truly defunct tests are deleted or replaced.
- [ ] Ensure remaining temporary compatibility code is explicitly documented as temporary.
- [ ] Produce a short summary of what is still blocked and why.

---

## Recommended cleanup ordering

The cleanup should proceed in this order.

### Tier 1 — Product surface and docs cleanup

This is the safest and most parallelizable work.

Targets include:

- product docs,
- command descriptions,
- tooltips,
- settings labels and help text,
- onboarding/walkthrough references,
- help pages and feature pages.

Examples from current branch investigation:

- `/deep-planning` references,
- workflows references,
- memory bank references,
- focus chain references,
- `/reportbug` references,
- checkpoints/shadow-git references,
- integrated terminal mode and profile messaging.

### Tier 2 — UI affordance cleanup

After product copy is aligned, remove UI affordances that should no longer be user-visible.

Examples:

- deprecated slash commands,
- settings controls for removed terminal concepts,
- modal tabs or panels tied to removed product concepts,
- lingering labels that imply deprecated behavior.

### Tier 3 — Compatibility simplification

Only after replacements are proven.

Examples:

- removing gRPC subscriptions once typed-message listeners fully replace them,
- removing compatibility handlers that no longer have callers,
- deleting fallback or shim behavior.

### Tier 4 — Runtime deletion and test deletion

The highest-risk stage.

Examples:

- deleting classic-core code no longer needed,
- deleting proto-conversion and generated code,
- deleting tests tied to removed runtime paths,
- removing build steps for removed systems.

---

## Major cleanup streams

The work naturally clusters into the following streams.

### Stream A — Slash commands and user-facing command system

Expected areas:

- `src/shared/slashCommands.ts`
- docs describing commands
- any webview or CLI surfaces that list deprecated commands

Likely targets:

- `/deep-planning`
- `/reportbug`
- workflow-related command descriptions

Goals:

- stop advertising removed commands,
- remove command registrations when safe,
- align docs and product copy.

Verification:

- search command definitions,
- verify command UI no longer exposes removed commands,
- typecheck,
- manual quick UI check.

### Stream B — Workflows → skills product cleanup

Expected areas:

- product docs,
- rules/settings UI,
- command descriptions,
- any modals or labels referencing workflows,
- lingering runtime toggles if still visible.

Goals:

- stop describing workflows as an active product feature,
- preserve only what is still temporarily needed for compatibility,
- align the product toward skills.

Verification:

- docs search,
- UI verification,
- watch for lingering workflow toggles/state.

### Stream C — Deep planning / focus chain / memory bank cleanup

Expected areas:

- docs,
- prompt system remnants,
- telemetry references,
- settings/state defaults,
- tests.

Goals:

- remove user-facing exposure first,
- delete implementation remnants only when current runtime no longer depends on them.

Special caution:

- focus-chain references still appear in runtime-related areas and telemetry,
- this stream requires careful triage before hard deletion.

### Stream D — Terminal settings simplification

This is a key medium-to-high risk stream.

Intended product direction:

- use background execution,
- remove integrated-terminal-specific settings,
- keep only settings that still make sense for captured output.

Likely cleanup targets:

- terminal profile selection,
- shell integration timeout,
- terminal reuse mode settings,
- execution mode choice,
- related state keys,
- related docs.

Special caution:

- these settings touch UI, persistence, handlers, and state defaults.

### Stream E — Checkpoints / shadow-git cleanup

This should start with product surface cleanup and careful runtime investigation.

Likely targets:

- docs advertising checkpoint behavior,
- user guidance that assumes shadow-git checkpoints are part of the target product,
- tests that assume the old system is canonical.

Special caution:

- replacement checkpoint direction is not simply “no checkpoints ever”; it is “not the old shadow-git system.”
- messaging must reflect that nuance.

### Stream F — Proto/gRPC and classic-core deletion

This is later-stage cleanup.

Likely targets:

- proto definitions,
- generated code,
- protobuf conversions,
- gRPC-only webview paths,
- classic controller/task/prompt areas once replacement is complete.

Special caution:

- do not start here,
- only proceed after typed-message cutover is proven.

---

## Prioritized next ten lowest-hanging migration chunks

This section ranks the **simplest remaining migration chunks** that still materially advance the removal plan.

These are ordered to optimize for:

1. visible product improvement,
2. low cross-cutting risk,
3. small reviewable commits,
4. usefulness to the teammate continuing the migration.

The intended workflow is:

- pick the next highest-ranked chunk that is not blocked,
- implement only that chunk,
- verify it thoroughly,
- commit and push it,
- then reassess before starting the next one.

### Ranked backlog summary

| Rank | Migration chunk | Why it is low-hanging | Main files | Expected result | Verification class |
|---|---|---|---|---|---|
| 1 | Render task-progress checklist even when legacy Focus Chain is off | UI-only read-path change, no schema migration required | `webview-ui/src/components/chat/ChatView.tsx` | Checklist appears whenever actual checklist content exists | Medium |
| 2 | Render task header checklist based on checklist content rather than legacy toggle | Small UI condition cleanup adjacent to rank 1 | `webview-ui/src/components/chat/task-header/TaskHeader.tsx` | Task header shows checklist independent of legacy toggle | Medium |
| 3 | Rename `FocusChain` task-header component to generic checklist naming | Mechanical component rename after behavior is decoupled | `webview-ui/src/components/chat/task-header/FocusChain.tsx`, `TaskHeader.tsx`, stories/tests | UI terminology matches product direction | Low |
| 4 | Rename shared Focus Chain checklist parsing helpers to generic checklist/task-progress helpers | Mechanical shared-utility rename with limited import fan-out | `src/shared/focus-chain-utils.ts`, checklist renderer/task-header imports | Shared utility names match generic checklist behavior | Low |
| 5 | Always update in-memory checklist state when `task_progress` is present | Small runtime behavior change with clear call sites | `src/core/task/ToolExecutor.ts`, `src/core/task/tools/handlers/AttemptCompletionHandler.ts` | Checklist state updates no longer depend on legacy Focus Chain enablement | Medium |
| 6 | Remove `FocusChainManager` from task bootstrap path | Existing manager is already a stub; wiring can be simplified after rank 5 | `src/core/task/index.ts`, `src/core/task/focus-chain/index.ts` | Task startup no longer instantiates/stores FocusChain-specific manager state | Medium |
| 7 | Hide legacy Focus Chain setting from active settings UI | Product-surface cleanup once UI/runtime no longer depend on the toggle | `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`, related tests | Users no longer see Focus Chain as an active feature toggle | Medium |
| 8 | Stop honoring Focus Chain setting writes in state update handlers | Small controller cleanup once setting is hidden | `src/core/controller/state/updateSettings.ts`, `updateSettingsCli.ts` | Legacy setting becomes compatibility-only rather than active control flow | Medium |
| 9 | Remove unused legacy prompt-family files or strip their Focus Chain-gated task_progress text | Static evidence suggests these files may be unreferenced; needs one more reference audit | `src/core/prompts/system-prompt-legacy/families/next-gen-models/gpt-5.ts`, `src/core/prompts/system-prompt-legacy/families/local-models/compact-system-prompt.ts` | Legacy prompt surface no longer carries stale Focus Chain gating | Investigate first / Medium |
| 10 | Retire `/reportbug` compatibility plumbing end-to-end | Product surfaces are already gone, remaining code surface is relatively contained | `src/core/controller/slash/reportBug.ts`, `src/sdk/grpc-handler.ts`, `src/shared/WebviewMessages.ts`, `src/shared/tools.ts`, feedback/report-bug handlers/tests | Removed slash command is gone from runtime compatibility plumbing | Medium |

### 1. Render task-progress checklist even when legacy Focus Chain is off

**Why this is first:** This is the smallest user-visible runtime migration chunk. It changes only the webview read path and avoids persistence or protocol churn.

**Goal:** Show checklist content whenever actual task-progress data exists, even if `focusChainSettings.enabled` is false.

**In scope:**

- `webview-ui/src/components/chat/ChatView.tsx`

**Out of scope:**

- renaming state fields,
- removing the Focus Chain setting,
- changing task runtime write paths.

**Implementation checklist**

- [x] Identify the memoized calculation of `lastProgressMessageText`
- [x] Remove the early return that short-circuits checklist display when `focusChainSettings.enabled` is false
- [x] Preserve the current precedence order: `currentFocusChainChecklist` first, latest progress-bearing message second
- [x] Ensure the fallback path still returns `undefined` when no checklist content exists
- [x] Avoid changing any unrelated message grouping or rendering behavior

**Verification checklist**

- [x] Run focused webview Biome/type checks on `ChatView.tsx`
- [x] Verify the checklist still appears when Focus Chain is enabled
- [x] Verify the checklist now also appears when Focus Chain is disabled but `task_progress` content exists
- [x] Verify no checklist appears when there is no checklist content at all
- [ ] Capture a debug-harness screenshot for the teammate if the UI is touched significantly

**Suggested commit boundary:** `Render task progress checklist without focus chain gating`

### 2. Render task header checklist based on checklist content rather than legacy toggle

**Why this is second:** It completes the UI read-path decoupling started in rank 1 with another small, reviewable conditional change.

**Goal:** Make the task header render the checklist because content exists, not because the legacy feature flag is enabled.

**In scope:**

- `webview-ui/src/components/chat/task-header/TaskHeader.tsx`
- any directly adjacent task-header prop plumbing needed for the render condition

**Out of scope:**

- component renaming,
- checklist parsing changes,
- settings or persistence updates.

**Implementation checklist**

- [x] Inspect the existing `focusChainSettings.enabled` guard around `<FocusChain />`
- [x] Replace the render condition with content-based logic (`lastProgressMessageText` and/or placeholder policy)
- [x] Keep the checkpoint error and other header sections unchanged
- [x] Confirm that the task header still collapses/expands normally

**Verification checklist**

- [x] Run focused webview Biome/type checks on `TaskHeader.tsx`
- [x] Verify checklist appears in the header when content exists and Focus Chain is disabled
- [x] Verify no blank checklist card renders when there is no checklist content
- [x] Verify checkpoint error rendering is unaffected

**Suggested commit boundary:** `Render task header checklist based on task progress content`

### 3. Rename `FocusChain` task-header component to generic checklist naming

**Why this is third:** Once behavior is decoupled from the legacy flag, the remaining component name mismatch becomes a mechanical cleanup.

**Goal:** Rename the visible task-header checklist component to match generic task-progress terminology.

**In scope:**

- `webview-ui/src/components/chat/task-header/FocusChain.tsx`
- `webview-ui/src/components/chat/task-header/TaskHeader.tsx`
- `webview-ui/src/components/chat/task-header/TaskHeader.stories.tsx`

**Out of scope:**

- shared state field renames,
- utility renames outside the task header,
- settings/runtime changes.

**Implementation checklist**

- [x] Rename the component file to a neutral name such as `TaskProgressChecklist.tsx`
- [x] Rename the exported component and props to generic checklist/task-progress terminology
- [x] Update all task-header imports and story references
- [x] Adjust story descriptions so they no longer call the component “FocusChain”
- [x] Keep rendered markup and behavior identical

**Verification checklist**

- [x] Run focused webview Biome/type checks on the renamed files
- [x] Verify Storybook/task-header stories still compile if applicable
- [x] Search for remaining task-header imports of `FocusChain`

**Suggested commit boundary:** `Rename task header focus chain component`

### 4. Rename shared Focus Chain checklist parsing helpers to generic checklist/task-progress helpers

**Why this is fourth:** The shared parsing helpers are already effectively generic, so this is a low-risk name-alignment slice.

**Goal:** Rename shared checklist helpers so they no longer imply a removed product feature.

**In scope:**

- `src/shared/focus-chain-utils.ts`
- imports in task-header/checklist-rendering components

**Out of scope:**

- changing the parsing regex behavior,
- touching runtime state fields,
- removing compatibility exports unless all call sites are updated safely.

**Implementation checklist**

- [x] Choose a neutral helper name/module path, e.g. `task-progress-utils.ts` or `checklist-utils.ts`
- [x] Rename exported helpers to generic names where helpful
- [x] Update all imports in webview/shared consumers
- [x] Keep behavior byte-for-byte equivalent where possible
- [x] Optionally preserve temporary re-exports only if needed for a staged rollout

**Verification checklist**

- [x] Run focused Biome/type checks on renamed shared/webview files
- [x] Search for remaining imports from `focus-chain-utils`
- [x] Verify checklist parsing/rendering still matches current behavior

**Suggested commit boundary:** `Rename shared checklist parsing helpers`

### 5. Always update in-memory checklist state when `task_progress` is present

**Why this is fifth:** This is the smallest backend/runtime behavior change that makes generic task-progress state real instead of UI-inferred only.

**Goal:** Update task-progress state whenever a tool returns `task_progress`, regardless of `focusChainSettings.enabled`.

**In scope:**

- `src/core/task/ToolExecutor.ts`
- `src/core/task/tools/handlers/AttemptCompletionHandler.ts`

**Out of scope:**

- persisted field renames,
- Task bootstrapping changes,
- settings removal.

**Implementation checklist**

- [x] Find every `config.focusChainSettings.enabled` guard around `updateFCListFromToolResponse`
- [x] Remove the guard so updates run whenever `task_progress` is present and the block is final/non-partial
- [x] Keep existing partial-stream safeguards intact
- [x] Confirm attempt-completion still updates before the user sees the final result where intended
- [x] Add/update focused tests if the handler path already has unit coverage

**Verification checklist**

- [x] Run focused unit tests for tool handler/update paths
- [x] Run focused Biome/type checks on touched runtime files
- [x] Verify that tasks with `task_progress` update checklist state even when Focus Chain is disabled

**Suggested commit boundary:** `Update task progress state without focus chain gating`

### 6. Remove `FocusChainManager` from task bootstrap path

**Why this is sixth:** The manager is already a stub, so once rank 5 lands we can simplify the remaining bootstrap/callback wiring.

**Goal:** Stop constructing and threading a FocusChain-specific manager through task startup.

**In scope:**

- `src/core/task/index.ts`
- `src/core/task/focus-chain/index.ts`

**Out of scope:**

- state field renames,
- UI renames,
- setting removal.

**Implementation checklist**

- [x] Identify where `FocusChainManager` is instantiated and stored on `Task`
- [x] Replace the manager callback plumbing with a generic task-progress updater or direct no-op where appropriate
- [x] Remove dead setup/dispose/checkIncompleteProgress scaffolding if nothing still calls it meaningfully
- [x] Keep task startup ordering, checkpoint startup, and hook initialization unchanged
- [x] Decide whether the stub file should remain as a compatibility shim or be deleted in the same slice

**Verification checklist**

- [x] Run focused task/runtime unit tests if present
- [x] Run focused Biome/type checks on `Task` and adjacent files
- [x] Verify task startup still works and no runtime accesses expect `this.FocusChainManager`

**Suggested commit boundary:** `Remove focus chain manager bootstrap wiring`

### 7. Hide legacy Focus Chain setting from active settings UI

**Why this is seventh:** After the UI and runtime stop depending on the toggle, hiding it becomes a straightforward product-surface cleanup.

**Goal:** Remove the legacy setting from active user-facing settings UI while preserving compatibility in stored state.

**In scope:**

- `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`
- `webview-ui/src/components/settings/sections/FeatureSettingsSection.spec.tsx`

**Out of scope:**

- removing the stored key,
- controller-side write handling,
- telemetry or migrations.

**Implementation checklist**

- [x] Remove or hide the feature card/toggle for Focus Chain from the settings UI
- [x] Remove the interval slider tied to the toggle if it becomes unreachable
- [x] Update tests/specs to match the new UI
- [x] Ensure other feature settings still render in stable order

**Verification checklist**

- [x] Run focused webview/spec checks for the feature settings section
- [x] Verify the setting no longer appears in the UI
- [x] Verify no console/runtime errors occur from missing rendered controls

**Suggested commit boundary:** `Hide legacy focus chain setting from settings UI`

### 8. Stop honoring Focus Chain setting writes in state update handlers

**Why this is eighth:** Once the UI no longer exposes the setting, controller-side write handling can be downgraded to compatibility mode.

**Goal:** Make incoming Focus Chain setting writes no longer alter active behavior or emit fresh product telemetry.

**In scope:**

- `src/core/controller/state/updateSettings.ts`
- `src/core/controller/state/updateSettingsCli.ts`

**Out of scope:**

- deleting the persisted key,
- historical migration logic,
- ExtensionState schema removal.

**Implementation checklist**

- [x] Decide whether incoming `focusChainSettings` should be ignored, normalized, or retained without behavioral effect
- [x] Remove active-behavior branching/telemetry emission tied solely to the legacy toggle
- [x] Keep backward compatibility for old persisted state reads if still needed
- [x] Add comments clarifying that the key is compatibility-only until final schema cleanup

**Verification checklist**

- [x] Run focused controller/state tests or add targeted coverage if missing
- [x] Run focused Biome/type checks on the two handler files
- [x] Verify no user-facing behavior changes when old state includes `focusChainSettings`

**Suggested commit boundary:** `Downgrade focus chain setting writes to compatibility mode`

### 9. Remove unused legacy prompt-family files or strip their Focus Chain-gated task_progress text

**Why this is ninth:** Static search currently suggests these legacy prompt-family files may be unreferenced, but that needs one deliberate proof step before deletion.

**Goal:** Either delete unreferenced legacy prompt files or, if they are still reachable, remove their stale Focus Chain gating in one focused slice.

**In scope:**

- `src/core/prompts/system-prompt-legacy/families/next-gen-models/gpt-5.ts`
- `src/core/prompts/system-prompt-legacy/families/local-models/compact-system-prompt.ts`

**Out of scope:**

- current prompt registry/runtime prompt generation,
- generic prompt component rewrites outside these files.

**Implementation checklist**

- [x] Prove whether each file is reachable through imports, registry wiring, or dynamic loading
- [x] If unreachable, delete the files and any dead exports/comments associated with them
- [x] If reachable, remove stale `focusChainSettings.enabled` gating around generic `task_progress` guidance
- [x] Add or update focused tests only if these files are still in active use

**Verification checklist**

- [x] Search for remaining references/imports after the change
- [x] Run focused prompt tests or registry tests if these files remain live
- [x] Ensure no build/test path expects deleted exports

**Suggested commit boundary:** `Retire unused legacy prompt families` or `Decouple legacy prompt families from focus chain gating`

### 10. Retire `/reportbug` compatibility plumbing end-to-end

**Why this is tenth:** User-facing surfaces are already gone, and the remaining runtime surface is relatively contained compared with workflows or checkpoints.

**Goal:** Remove the remaining compat plumbing for `/reportbug` after confirming no active product surface depends on it.

**In scope:**

- `src/core/controller/slash/reportBug.ts`
- `src/sdk/grpc-handler.ts`
- `src/shared/WebviewMessages.ts`
- `src/shared/tools.ts`
- report-bug tool handler/tests and any compatibility-only ask mapping

**Out of scope:**

- generic user feedback collection,
- GitHub issue guidance in prompt/help text unless directly required.

**Implementation checklist**

- [x] Inventory the remaining runtime call path from slash-command/tool schema to handler execution
- [x] Confirm there is no active UI or docs surface that can still trigger `/reportbug`
- [x] Remove the controller/tool/compat wiring in one slice
- [x] Update or delete tests that still encode report-bug runtime behavior
- [x] Preserve generic feedback/help behavior that is not specific to `/reportbug`

**Verification checklist**

- [x] Search for remaining `reportBug` / `report_bug` references after the slice
- [x] Run focused slash-command / prompt / handler tests
- [x] Verify removed command no longer appears and no dead runtime path remains

**Suggested commit boundary:** `Remove reportbug compatibility plumbing`

### How to use this ranked list

- Start with ranks **1–2** as the next teammate-facing migration chunk if the goal is maximum progress with minimum risk.
- Treat ranks **3–6** as the next staircase once checklist rendering and updates are decoupled.
- Treat ranks **7–8** as cleanup that becomes safe only after the runtime no longer depends on the legacy setting.
- Treat ranks **9–10** as opportunistic follow-ons that should be revalidated immediately before implementation.

---

## Detailed step-by-step execution template for each cleanup slice

Use the following sequence for every slice.

### Step 1 — Name the slice clearly

Example:

- “Remove `/reportbug` from product surface and docs.”
- “Simplify terminal settings to background-exec-only.”
- “Remove deep planning references from docs and slash commands.”

Checklist:

- [ ] Slice name written down
- [ ] Clear goal defined
- [ ] In-scope files listed
- [ ] Out-of-scope items listed

### Step 2 — Investigate dependencies

Checklist:

- [ ] Search docs
- [ ] Search source code
- [ ] Search tests
- [ ] Search settings/state references
- [ ] Search bridge/message references if applicable
- [ ] Update ledger row with evidence
- [ ] Apply rubric

### Step 3 — Decide the slice type

Checklist:

- [ ] Delete now
- [ ] Hide now, retain internals
- [ ] Blocked on cutover
- [ ] Investigate more before proceeding

### Step 4 — Define verification before editing

Checklist:

- [ ] Search-based verification plan written
- [ ] Automated test plan written
- [ ] Interactive verification plan written if needed
- [ ] Debug harness steps identified if needed

### Step 5 — Implement the smallest meaningful change

Checklist:

- [ ] Remove/adjust visible product surface
- [ ] Update docs in same slice if applicable
- [ ] Remove internals only if rubric says safe
- [ ] Update affected tests
- [ ] Keep changes scoped to the named slice

### Step 6 — Run verification

Checklist:

- [ ] Search for remaining references
- [ ] Run typecheck/lint as needed
- [ ] Run targeted tests
- [ ] Run `npm run test:sdk` for higher-risk SDK-adjacent slices
- [ ] Use debug harness when UI/bridge behavior is affected
- [ ] Verify reload/restart behavior if state or persistence changed

### Step 7 — Fix local regressions accurately

Checklist:

- [ ] Identify whether regression is local or indicates broader migration dependency
- [ ] Apply small fix if local and necessary
- [ ] If blocked, mark ledger and stop broadening scope blindly
- [ ] Re-run verification after fix

### Step 8 — Close the slice cleanly

Checklist:

- [ ] Ledger updated with final decision and evidence
- [ ] Verification results recorded
- [ ] Remaining blocked follow-ups noted
- [ ] Reviewer can understand what changed and why

---

## Verification strategy

Verification must scale with the risk of the slice.

### Baseline verification commands

Use the lightest set that is credible for the slice.

Common commands:

```bash
npm run check-types
npm run lint
npm run test:sdk
```

Use targeted testing when possible before broader runs.

### Build commands relevant to this branch

```bash
npm run protos
IS_DEV=true node esbuild.mjs
```

### Debug harness quick start

This branch introduces a new HTTP-controlled debug harness for the VS Code extension.

It can be used to:

- launch the extension,
- interact with the UI,
- take screenshots,
- inspect both extension-host and webview behavior,
- set breakpoints,
- evaluate expressions,
- step through code,
- reproduce and verify cleanup-related regressions.

Launch:

```bash
npx tsx src/dev/debug-harness/server.ts --auto-launch --skip-build
```

Or with build:

```bash
npx tsx src/dev/debug-harness/server.ts --auto-launch
```

Basic usage:

```bash
curl localhost:19229/api -d '{"method":"status"}'
curl localhost:19229/api -d '{"method":"ui.open_sidebar"}'
curl localhost:19229/api -d '{"method":"ui.screenshot"}'
```

If the Kanban promo appears, dismiss it before testing the UI.

Example:

```bash
curl localhost:19229/api -d '{
  "method": "ui.locator",
  "params": {"text": "Dismiss", "frame": "sidebar", "action": "click"}
}'
```

### When the debug harness should be required

Use the debug harness for any slice that touches:

- top-bar navigation,
- settings behavior,
- task creation/resume flow,
- account/auth behavior,
- history flow,
- typed-message or gRPC bridge behavior,
- webview rendering after cleanup,
- state changes that are difficult to prove via tests alone.

### Suggested smoke checklist after risky slices

- [ ] Open sidebar successfully
- [ ] Dismiss promo if present
- [ ] Start a new task
- [ ] Switch Plan/Act mode if relevant
- [ ] Open Settings
- [ ] Open History
- [ ] Open Account
- [ ] Send a message
- [ ] Confirm no immediate webview crash
- [ ] Confirm the cleaned-up feature is no longer exposed incorrectly

### Suggested breakpoint targets for migration-sensitive regressions

If cleanup breaks behavior, inspect these areas first:

- `src/hosts/vscode/VscodeWebviewProvider.ts`
- `src/sdk/webview-grpc-bridge.ts`
- `src/sdk/grpc-handler.ts`
- `src/sdk/SdkController.ts`
- `webview-ui/src/context/ExtensionStateContext.tsx`
- any specific UI component you changed

This helps determine whether the break is:

- product-surface-only,
- state-related,
- bridge-related,
- persistence-related,
- or caused by an incomplete migration replacement.

---

## How to handle regressions discovered during cleanup

Cleanup work will likely reveal some migration holes. That is expected.

When a regression appears:

### First classify the regression

- [ ] Did we delete something still in use?
- [ ] Did we remove only the UI while leaving inconsistent state assumptions behind?
- [ ] Did we expose a missing typed-message replacement?
- [ ] Did we remove coverage before replacement behavior was tested?
- [ ] Did we uncover a pre-existing branch bug rather than introducing a new one?

### Then choose the correct response

#### If the regression is local and small

- [ ] Fix it within the slice
- [ ] Re-run verification

#### If the regression reveals a blocked dependency

- [ ] Stop broad deletion
- [ ] Restore or preserve the necessary dependency
- [ ] Mark the ledger as blocked on cutover
- [ ] Record the evidence clearly

#### If the regression reveals missing replacement work

- [ ] Decide whether the replacement fix is small enough to include safely
- [ ] If yes, implement narrowly and verify
- [ ] If no, split it into a separate dependency slice and block the original cleanup

The key idea is:

**Do not power through uncertainty with larger deletions.**

---

## Coordination guidance for parallel work

This cleanup effort is intentionally parallel to ongoing migration work.

To avoid collisions:

- [ ] Identify migration boundaries currently under active development
- [ ] Avoid large refactors in those areas without coordination
- [ ] Prefer product-surface/doc cleanup first when boundaries are moving
- [ ] Use the ledger to mark ownership and blocked items
- [ ] Revisit blocked items after teammate changes land

### Recommended division of labor

The cleanup workstream is best suited to own:

- docs cleanup,
- user-facing terminology cleanup,
- slash command cleanup,
- settings-surface simplification,
- deletion of clearly defunct tests,
- preparation for later runtime deletion.

The active migration workstream is best suited to own:

- deep SDK behavioral changes,
- typed-message cutover completion,
- replacement path implementation,
- MCP/session architecture changes,
- final bridge retirement.

---

## Known high-priority candidate areas to seed into the ledger

These are good starting points.

### Candidate group 1 — Command and product-surface cleanup

- [x] `/deep-planning`
- [x] `/reportbug`
- [x] workflows references in user-facing product surfaces

Likely files:

- `src/shared/slashCommands.ts`
- docs describing slash commands and workflows

### Candidate group 2 — Documentation cleanup

- [x] deep planning docs
- [x] focus chain docs
- [x] memory bank docs
- [x] workflows docs
- [x] checkpoints docs
- [x] terminal-mode docs
- [x] getting-started/home pages that still advertise removed features

### Candidate group 3 — Terminal settings simplification

- [ ] remove deprecated terminal-mode settings
- [ ] simplify UI to background-exec-oriented behavior
- [ ] remove no-longer-correct help text
- [ ] carefully assess state keys and handlers before deletion

### Candidate group 4 — Focus chain remnants

- [ ] inventory runtime references
- [ ] inventory telemetry references
- [ ] inventory tests
- [ ] determine what is safe to remove now versus later

### Candidate group 5 — Proto/gRPC retirement preparation

- [ ] identify legacy subscriptions still in active use
- [ ] identify typed-message replacements already in place
- [ ] mark blocked deletions clearly

### Candidate group 6 — Defunct tests

- [ ] tests for already-deleted deep planning behavior
- [ ] tests for obsolete classic paths
- [ ] tests whose assertions no longer match target product behavior
- [ ] ensure replacement coverage exists before deletion where needed

---

## Documentation-specific requirements

This cleanup effort includes product documentation, not just code.

### Documentation goals

- [ ] Remove references to product features that are being removed
- [ ] Avoid promising behavior that no longer matches the product direction
- [ ] Avoid documenting transitional compatibility details as if they are the intended long-term product
- [ ] Keep documentation understandable for non-developers
- [ ] Distinguish current product direction from implementation transition details when necessary

### Documentation tone guidance

When updating docs:

- explain changes in plain language,
- avoid internal jargon unless needed,
- do not describe removed features as recommended workflows,
- do not over-explain transitional engineering details in end-user docs,
- reserve transitional details for engineering docs like this one.

---

## Definition of done

This cleanup effort is complete when:

- [ ] removed features are no longer incorrectly advertised in product docs and user-facing surfaces,
- [ ] clearly defunct tests are deleted or replaced,
- [ ] cleanup slices have been executed with evidence-based verification,
- [ ] any remaining compatibility remnants are explicitly identified as temporary or blocked,
- [ ] the branch still works after cleanup,
- [ ] the team has a clear record of what was removed now versus what must wait for later cutover work.

---

## Working checklist for the overall effort

### Setup

- [x] Create the cleanup ledger
- [x] Seed ledger with known candidate groups
- [ ] Align with teammate on active migration boundaries
- [ ] Decide owners per stream

### Investigation

- [ ] Inventory docs references
- [ ] Inventory product-surface references
- [ ] Inventory runtime references
- [ ] Inventory bridge dependencies
- [ ] Inventory persistence/state coupling
- [ ] Inventory test dependencies
- [ ] Apply rubric to each candidate

### Execution

- [x] Complete Tier 1 product-surface/doc cleanup slices
- [ ] Complete Tier 2 UI affordance cleanup slices
- [ ] Complete Tier 3 compatibility simplification slices when ready
- [ ] Complete Tier 4 runtime/test deletion slices when safe

### Verification

- [x] Maintain per-slice verification plans
- [ ] Use `npm run check-types` as needed
- [ ] Use `npm run lint` as needed
- [ ] Use `npm run test:sdk` for SDK-adjacent and high-risk slices
- [ ] Use debug harness on risky UI/bridge slices
- [ ] Keep a current smoke checklist and re-run it after risky changes

### Closure

- [x] Update ledger to reflect final outcomes
- [x] Record remaining blocked items
- [ ] Summarize what is still waiting on migration cutover

---

## Final note to developers

If this effort is done well, the result will not just be “less code.”

It will be:

- a product surface that accurately reflects the direction of the SDK migration,
- a safer path to later deletion of legacy systems,
- a cleaner test suite,
- clearer product documentation,
- and a much lower risk of accidental regressions during the transition.

The important mindset is:

**cleanup is a controlled, verified migration activity.**

That means every deletion should have:

- evidence,
- a reason,
- a verification plan,
- and a record of what we learned.
