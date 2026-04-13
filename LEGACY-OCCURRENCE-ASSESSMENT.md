# Eve Legacy Occurrence Assessment

This document inventories every occurrence of the word `legacy` introduced by the `eve/sdk-migration` branch according to:

```bash
git --no-pager diff $(git merge-base dpc/sdk-migration eve/sdk-migration)..eve/sdk-migration | grep legacy
```

The purpose of this file is to support a **review-first cleanup pass**. It does **not** apply the changes yet. Instead, each checkbox records one occurrence and a rubric-based assessment of what should happen later, how to approach it, and why that is the right disposition.

## Disposition legend

- **Remove `legacy` branding**: keep the feature/behavior, but stop calling it legacy.
- **Rename active adapter/runtime terminology**: the code stays, but the naming should become precise and neutral.
- **Keep behavior, narrow wording**: preserve a real compatibility path, but describe the exact old format/boundary instead of saying `legacy`.
- **Delete stale surface**: if the thing is truly dead or misleading, remove the whole surface rather than relabeling it.

## Review notes

- All checkboxes start unchecked because this file is intended to track implementation progress later.
- `dpc changed after eve` indicates whether the file received follow-on edits on `dpc/sdk-migration`; those entries require forward edits rather than reverting to an eve-era version.
- The assessments below intentionally bias toward **deleting dead things, renaming active things, and reserving `legacy` only for real compatibility boundaries**.

## `ARCHITECTURE.md`

- [ ] **Occurrence 001 — `ARCHITECTURE.md:66`**
  - **Introduced text:** `Terminal integration: There is legacy code in the VSCode extension,`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 002 — `ARCHITECTURE.md:394`**
  - **Introduced text:** ``LegacySessionBackend` adapter wraps the existing`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 003 — `ARCHITECTURE.md:644`**
  - **Introduced text:** `  session-backend.ts    — LegacySessionBackend adapter`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 004 — `ARCHITECTURE.md:646`**
  - **Introduced text:** `  provider-migration.ts — Legacy provider settings migration`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 005 — `ARCHITECTURE.md:768`**
  - **Introduced text:** `1. **Legacy provider settings migration** —`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 006 — `ARCHITECTURE.md:769`**
  - **Introduced text:** `   `migrateLegacyProviderSettings()` reads `globalState.json` +`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 007 — `ARCHITECTURE.md:787`**
  - **Introduced text:** `   legacy format migration.`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `CAVEATS.md`

- [ ] **Occurrence 008 — `CAVEATS.md:3`**
  - **Introduced text:** `Tracking issues found during the migration from the legacy inference system to the ClineCore SDK.`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** yes
  - **Rubric result:** Reword this caveat or fix note to describe the exact pre-SDK system or adapter involved, and follow any future adapter renames instead of locking the document to eve-era `legacy` terminology.
  - **Assessment:** This occurrence is explanatory documentation about migration behavior. The implementation should keep the factual caveat or fix description, but rename the underlying concepts precisely—such as `pre-SDK inference stack`, `stored disk state`, or whatever the adapter is ultimately called—rather than keeping `legacy` as the headline term. That is appropriate because the document should help future maintainers understand what was fixed without freezing in transitional naming debt. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 009 — `CAVEATS.md:26`**
  - **Introduced text:** `**Fix:** `SdkController` now persists tasks on three paths: (1) `done` event updates `currentTaskItem` with final usage and calls `persistCurrentTask()`, (2) `clearTask()` calls `persistCurrentTask()` before resetting, (3) `cancelTask()` persists the in-progress task. `LegacyStateReader` gained `saveTaskHistory()`, `saveUiMessages()`, and `deleteTaskDirectory()` methods for disk I/O.`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** yes
  - **Rubric result:** Reword this caveat or fix note to describe the exact pre-SDK system or adapter involved, and follow any future adapter renames instead of locking the document to eve-era `legacy` terminology.
  - **Assessment:** This occurrence is explanatory documentation about migration behavior. The implementation should keep the factual caveat or fix description, but rename the underlying concepts precisely—such as `pre-SDK inference stack`, `stored disk state`, or whatever the adapter is ultimately called—rather than keeping `legacy` as the headline term. That is appropriate because the document should help future maintainers understand what was fixed without freezing in transitional naming debt. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 010 — `CAVEATS.md:31`**
  - **Introduced text:** `**Fix:** `showTaskWithId()` now finds the task in history, loads saved UI messages via `legacyState.readUiMessages()`, restores them into the translator, and sets `currentTaskItem`. The task view renders with full message history.`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** yes
  - **Rubric result:** Reword this caveat or fix note to describe the exact pre-SDK system or adapter involved, and follow any future adapter renames instead of locking the document to eve-era `legacy` terminology.
  - **Assessment:** This occurrence is explanatory documentation about migration behavior. The implementation should keep the factual caveat or fix description, but rename the underlying concepts precisely—such as `pre-SDK inference stack`, `stored disk state`, or whatever the adapter is ultimately called—rather than keeping `legacy` as the headline term. That is appropriate because the document should help future maintainers understand what was fixed without freezing in transitional naming debt. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 011 — `CAVEATS.md:36`**
  - **Introduced text:** `**Fix:** `updateSettings()` now persists settings to `globalState.json` via `legacyState.saveApiConfiguration()`. `updateAutoApprovalSettings()` also persists via the same mechanism.`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** yes
  - **Rubric result:** Reword this caveat or fix note to describe the exact pre-SDK system or adapter involved, and follow any future adapter renames instead of locking the document to eve-era `legacy` terminology.
  - **Assessment:** This occurrence is explanatory documentation about migration behavior. The implementation should keep the factual caveat or fix description, but rename the underlying concepts precisely—such as `pre-SDK inference stack`, `stored disk state`, or whatever the adapter is ultimately called—rather than keeping `legacy` as the headline term. That is appropriate because the document should help future maintainers understand what was fixed without freezing in transitional naming debt. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

## `FEATURE-REMOVAL-CLEANUP-PLAN.md`

- [ ] **Occurrence 012 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:30`**
  - **Introduced text:** `4. Gradually move the webview from legacy gRPC-over-`postMessage` communication to typed JSON messages.`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 013 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:67`**
  - **Introduced text:** `- legacy compatibility code is deleted once the replacement path is solid.`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 014 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:80`**
  - **Introduced text:** `- legacy gRPC-style request/response and streaming still exist,`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 015 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:93`**
  - **Introduced text:** `- background terminal execution rather than legacy integrated-terminal modes,`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 016 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:96`**
  - **Introduced text:** `- a simplified product surface with fewer legacy systems.`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 017 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:103`**
  - **Introduced text:** `- legacy terminal execution mode selection and terminal profile workflows,`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 018 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:236`**
  - **Introduced text:** `- Is it still serving the webview ↔ extension bridge, gRPC shim, typed-message transition, or legacy controller glue?`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 019 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:346`**
  - **Introduced text:** `- proto/gRPC deletion while the webview still uses legacy paths,`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 020 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:454`**
  - **Introduced text:** `| workflows references in user-facing product surfaces | docs / product copy | Reframe workflows as a legacy compatibility path and direct new users toward skills | `docs/customization/workflows.mdx`, `docs/customization/overview.mdx`, `docs/core-workflows/using-commands.mdx`, `docs/cline-cli/configuration.mdx`, workflows scan artifact `feature-removal-workflows-scan/summary.md`, verification artifact `feature-removal-workflows-verify/summary.md` | Green | Yellow | Yellow | Yellow | Skills for new reusable guidance, legacy workflows only for compatibility | Green | none | `docs/customization/workflows.mdx`, `docs/customization/overview.mdx`, `docs/core-workflows/using-commands.mdx`, `docs/cline-cli/configuration.mdx` | Low | Low | Hide now, retain internals | Low | Search docs for remaining product-surface workflow references and verify no runtime/UI behavior changed | Cline | Verified | Main customization and CLI docs now frame workflows as a legacy compatibility path and direct new reusable behavior toward skills; remaining mentions are intentional compatibility/reference language | Move to the next Tier 1 or Tier 2 slice and reassess workflow UI affordances |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 021 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:455`**
  - **Introduced text:** `| workflow UI affordances in CLI config | CLI UI / settings surface | Relabel the workflow management tab as legacy so the CLI no longer presents workflows as a first-class feature | `cli/src/components/ConfigView.tsx`, `cli/src/components/ConfigViewComponents.tsx`, workflow UI scan artifact `feature-removal-workflow-ui-scan/summary.md` | Green | Yellow | Yellow | Yellow | Skills for new reusable guidance, workflow toggles retained temporarily for compatibility | Green | none | `cli/src/components/ConfigView.tsx`, `cli/src/components/ConfigViewComponents.tsx` | Low | Low | Hide now, retain internals | Low | Run focused CLI Biome check and keep compatibility plumbing unchanged | Cline | Verified | CLI config now labels the workflow tab, section headers, and empty state as legacy while leaving the toggle machinery intact | Reassess whether any remaining workflow UI affordances should be hidden in other surfaces |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 022 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:456`**
  - **Introduced text:** `| workflow product copy in secondary docs surfaces | docs / product copy | Remove the last high-visibility workflow-as-primary wording from secondary docs surfaces | `docs/home.mdx`, `docs/cline-cli/installation.mdx`, `docs/contributing/documentation-guide.mdx`, low-risk leftovers scan artifact `feature-removal-low-risk-leftovers-scan/summary.md` | Green | Green | Green | Green | Skills for new reusable guidance, legacy workflows only where explicitly called out | Green | none | `docs/home.mdx`, `docs/cline-cli/installation.mdx`, `docs/contributing/documentation-guide.mdx` | Low | Low | Hide now, retain internals | Low | Search the touched docs for remaining workflow product-copy language and verify only generic/non-product uses remain | Cline | Verified | Secondary docs now use legacy-workflow phrasing where product copy previously presented workflows as a primary feature; remaining workflow mentions are generic process language or intentional legacy references | Move to the next cleanup stream |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 023 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:457`**
  - **Introduced text:** `| memory bank product surfaces | docs / product copy | Demote Memory Bank from primary feature navigation and frame it as a legacy/manual approach | `docs/features/memory-bank.mdx`, `docs/home.mdx`, `docs/customization/clineignore.mdx`, `docs/docs.json`, memory/focus scan artifact `feature-removal-memory-focus-scan/summary.md`, verification artifact `feature-removal-memory-verify/summary.md` | Green | Green | Green | Green | Plan & Act mode, task management, Cline Rules, and built-in context tools | Green | none | `docs/features/memory-bank.mdx`, `docs/home.mdx`, `docs/customization/clineignore.mdx`, `docs/docs.json` | Low | Low | Hide now, retain internals | Low | Search docs for remaining high-visibility Memory Bank references and verify redirects/navigation still work | Cline | Verified | Memory Bank has been removed from primary home/navigation surfaces and reframed as a legacy manual pattern; remaining references are intentional legacy-page and redirect coverage | Reassess focus-chain product surfaces next |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 024 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:458`**
  - **Introduced text:** `| focus chain product surfaces | docs / product copy | Demote Focus Chain from primary feature navigation and frame it as a legacy checklist mode | `docs/features/focus-chain.mdx`, `docs/features/auto-compact.mdx`, `docs/docs.json`, memory/focus scan artifact `feature-removal-memory-focus-scan/summary.md`, verification artifact `feature-removal-focus-verify/summary.md` | Green | Yellow | Yellow | Yellow | Plan & Act mode plus built-in task_progress checklists | Yellow | none | `docs/features/focus-chain.mdx`, `docs/features/auto-compact.mdx`, `docs/docs.json` | Low | Medium | Hide now, retain internals | Low | Search docs for remaining high-visibility Focus Chain references and avoid touching the active runtime setting surface yet | Cline | Verified | Focus Chain has been removed from primary docs navigation and reframed as a legacy checklist mode; remaining references are intentional legacy-page, runtime-setting, or redirect coverage | Reassess whether the still-live settings label should be relabeled in a later UI slice |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 025 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:459`**
  - **Introduced text:** `| focus chain settings surface | webview UI / settings copy | Relabel the still-live Focus Chain setting as legacy without changing runtime behavior | `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`, `webview-ui/src/components/settings/UseCustomPromptCheckbox.tsx`, focus scan artifact `feature-removal-memory-focus-scan/summary.md` | Green | Yellow | Yellow | Yellow | Plan & Act mode plus built-in task_progress checklists | Yellow | none | `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`, `webview-ui/src/components/settings/UseCustomPromptCheckbox.tsx` | Low | Medium | Hide now, retain internals | Low | Run focused webview search/Biome checks and keep active checklist/runtime plumbing intact | Cline | Verified | The remaining user-facing Focus Chain settings copy now calls the feature legacy while leaving the live checklist/task-header behavior untouched | Reassess whether any stronger hide/remove action is safe or move to another cleanup stream |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 026 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:460`**
  - **Introduced text:** `| task_progress prompt coupling to focus chain | prompts / runtime guidance | Decouple task_progress prompt guidance from the Focus Chain feature flag so checklist guidance matches the current product direction | `src/core/prompts/system-prompt/components/task_progress.ts`, `src/core/prompts/system-prompt/components/tool_use/tools.ts`, `src/core/prompts/system-prompt/components/tool_use/examples.ts`, `src/core/prompts/system-prompt/components/tool_use/formatting.ts`, `src/core/prompts/contextManagement.ts`, `src/core/prompts/commands.ts`, `src/core/prompts/system-prompt/__tests__/integration.test.ts`, `src/core/prompts/system-prompt/__tests__/test-helpers.ts`, post-doc stream scan artifact `feature-removal-post-doc-stream-scan/summary.md` | Yellow | Yellow | Yellow | Yellow | Built-in task_progress guidance independent of legacy Focus Chain UI/runtime | Yellow | `src/core/prompts/system-prompt/__tests__/integration.test.ts` and affected snapshots | prompt system / summarize/condense guidance | Medium | Medium | Hide now, retain internals | Medium | Run focused prompt integration tests, refresh only the affected snapshots, and keep Focus Chain runtime plumbing intact | Cline | Verified | Prompt generation now includes task_progress guidance even when Focus Chain is disabled, and the focused integration test plus updated no-focus-chain snapshots verify the new behavior without touching Focus Chain runtime plumbing | Reassess deeper Focus Chain runtime cleanup |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 027 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:461`**
  - **Introduced text:** `| feedback prompt coupling to focus chain | prompts / runtime guidance | Ensure bug-report/help guidance remains available even when Focus Chain is disabled | `src/core/prompts/system-prompt/components/feedback.ts`, `src/core/prompts/system-prompt/variants/generic/config.ts`, `src/core/prompts/system-prompt/__tests__/integration.test.ts`, post-doc stream scan artifact `feature-removal-post-doc-stream-scan/summary.md` | Yellow | Green | Green | Green | Shared feedback/help guidance independent of legacy checklist mode | Green | `src/core/prompts/system-prompt/__tests__/integration.test.ts` and affected snapshots | prompt system feedback/help section | Low | Medium | Hide now, retain internals | Medium | Run focused prompt integration tests, refresh the affected snapshots, and keep Focus Chain runtime plumbing untouched | Cline | Verified | Feedback/help guidance now remains present when Focus Chain is disabled, and the focused integration test plus affected snapshots verify the corrected prompt wiring | Continue triaging remaining Focus Chain runtime remnants |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 028 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:465`**
  - **Introduced text:** `| generic task-progress checklist UI/runtime decoupling (ranks 1-6) | webview UI / shared helpers / runtime state | Make checklist rendering and task-progress state updates work independently of the legacy Focus Chain toggle, then remove the dead `FocusChainManager` bootstrap stub | `webview-ui/src/components/chat/ChatView.tsx`, `webview-ui/src/components/chat/task-header/TaskHeader.tsx`, `webview-ui/src/components/chat/task-header/TaskProgressChecklist.tsx`, `webview-ui/src/components/common/ChecklistRenderer.tsx`, `cli/src/components/FocusChain.tsx`, `src/shared/checklist-utils.ts`, `src/core/task/ToolExecutor.ts`, `src/core/task/tools/handlers/AttemptCompletionHandler.ts`, `src/core/task/index.ts`, focused Biome check + `webview-ui`/`cli` typecheck on 2026-04-07 | Green | Green | Green | Yellow | Generic task-progress checklist experience that no longer depends on legacy Focus Chain-specific UI/runtime wiring | Green | focused UI/runtime checks only; branch-wide root `tsc` still blocked elsewhere | plan doc plus any future user-facing checklist wording | Medium | Medium | Delete now | Medium | Run focused Biome checks on touched UI/runtime files plus `webview-ui` and `cli` typechecks; note unrelated branch-wide root `tsc` blockers separately | Cline | Verified | Checklist rendering now uses actual checklist content regardless of the legacy toggle, shared parsing helpers were renamed to generic checklist terminology, task-progress state updates no longer depend on `focusChainSettings.enabled`, and the dead `FocusChainManager` bootstrap stub was removed; focused checks pass while unrelated root TypeScript blockers remain in the branch | Move to rank 7: hide the legacy Focus Chain setting from the active settings UI |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 029 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:466`**
  - **Introduced text:** `| hide legacy Focus Chain setting from active settings UI (rank 7) | webview UI / settings surface | Remove the legacy Focus Chain toggle and reminder slider from the active settings page while leaving compatibility state handling untouched | `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`, `webview-ui/src/components/settings/sections/FeatureSettingsSection.spec.tsx`, focused Biome check + focused Vitest spec on 2026-04-07 | Green | Yellow | Yellow | Yellow | Compatibility-only Focus Chain state with no active user-facing settings control | Green | focused settings spec only | settings UI copy and plan doc | Low | Medium | Hide now, retain internals | Medium | Run focused Biome checks on the settings files plus the `FeatureSettingsSection` Vitest spec; keep controller/state handling unchanged for now | Cline | Verified | The active settings UI no longer renders the legacy Focus Chain toggle or reminder interval slider, and the focused settings spec now asserts the controls stay hidden while compatibility state remains available under the hood | Move to rank 8: downgrade Focus Chain setting writes to compatibility mode |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 030 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:467`**
  - **Introduced text:** `| downgrade Focus Chain setting writes to compatibility mode (rank 8) | controller state / compatibility behavior | Keep accepting legacy `focusChainSettings` payloads but stop letting new writes re-enable the live toggle path or emit fresh Focus Chain telemetry | `src/core/controller/state/updateSettings.ts`, `src/core/controller/state/updateSettingsCli.ts`, focused Biome check on both controller files plus branch-wide `tsc` output filtered for touched handlers on 2026-04-07 | Green | Yellow | Yellow | Yellow | Compatibility-only persisted Focus Chain shape with no active behavior changes from new writes | Green | no direct handler tests currently present; relied on focused static verification | plan doc only | Low | Medium | Hide now, retain internals | Medium | Run focused Biome checks on both controller handlers and confirm branch-wide type errors do not implicate the touched files; preserve stored shape but avoid new toggle telemetry | Cline | Verified | Both controller update handlers now preserve the stored `focusChainSettings` shape without honoring incoming enable/disable flips or emitting new Focus Chain toggle telemetry, keeping the legacy field compatibility-only while avoiding broader schema removal | Reassess rank 9 prompt-family cleanup versus `/reportbug` compatibility removal and pick the narrower safe slice |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 031 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:468`**
  - **Introduced text:** `| retire unused legacy prompt families (rank 9) | prompt implementation / dead-code cleanup | Delete the orphaned legacy prompt-family files that still embed stale Focus Chain-gated task_progress/tool text | `src/core/prompts/system-prompt-legacy/families/next-gen-models/gpt-5.ts`, `src/core/prompts/system-prompt-legacy/families/local-models/compact-system-prompt.ts`, reference searches for exported symbols and file paths on 2026-04-07 | Green | Green | Green | Green | No replacement needed because the files were not wired into the active prompt registry | Green | none | plan doc only | Low | Low | Delete now | Low | Prove there are no remaining imports of the file paths or exported prompt constants, delete the files, then rerun source-reference searches and a focused typecheck grep for the removed symbols/paths | Cline | Verified | The two legacy prompt-family files had no remaining source imports or prompt-registry references, were deleted, and follow-up reference searches plus a filtered typecheck grep found no remaining references to their file paths or exported symbols | Reassess rank 10 `/reportbug` compatibility plumbing versus other remaining low-risk cleanup slices |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 032 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:472`**
  - **Introduced text:** `| remaining focus chain runtime/settings/state surfaces | runtime / persistence / UI state | Preserve the still-wired Focus Chain state/settings/task plumbing until a broader cutover removes the feature end-to-end | `src/core/task/index.ts`, `src/core/task/TaskState.ts`, `src/core/task/ToolExecutor.ts`, `src/core/controller/state/updateSettings.ts`, `src/core/controller/state/updateSettingsCli.ts`, `src/shared/ExtensionMessage.ts`, `src/shared/storage/state-keys.ts`, `src/sdk/state-builder.ts`, `webview-ui/src/context/ExtensionStateContext.tsx`, `webview-ui/src/components/chat/ChatView.tsx`, `webview-ui/src/components/chat/task-header/TaskHeader.tsx`, focus-chain runtime inventory on 2026-04-07 | Yellow | Red | Yellow | Red | Eventual task_progress/checklist experience without legacy Focus Chain-specific state/settings plumbing | Yellow | multiple prompt/task/runtime tests would need coordinated updates | runtime state, settings, webview state hydration | Medium | High | Blocked on cutover | High | Do not delete piecemeal; wait for a coordinated runtime/state cutover with persistence, UI, and task-flow verification | Cline | Blocked | Remaining Focus Chain references are concentrated in live task execution, persisted settings/state, extension/webview state shape, and checklist rendering paths, so further deletion would be a cross-cutting runtime migration rather than a safe cleanup slice | Leave these paths in place for now and revisit after the broader runtime/state cutover is ready |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 033 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:822`**
  - **Introduced text:** `| 1 | Render task-progress checklist even when legacy Focus Chain is off | UI-only read-path change, no schema migration required | `webview-ui/src/components/chat/ChatView.tsx` | Checklist appears whenever actual checklist content exists | Medium |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 034 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:823`**
  - **Introduced text:** `| 2 | Render task header checklist based on checklist content rather than legacy toggle | Small UI condition cleanup adjacent to rank 1 | `webview-ui/src/components/chat/task-header/TaskHeader.tsx` | Task header shows checklist independent of legacy toggle | Medium |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 035 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:826`**
  - **Introduced text:** `| 5 | Always update in-memory checklist state when `task_progress` is present | Small runtime behavior change with clear call sites | `src/core/task/ToolExecutor.ts`, `src/core/task/tools/handlers/AttemptCompletionHandler.ts` | Checklist state updates no longer depend on legacy Focus Chain enablement | Medium |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 036 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:828`**
  - **Introduced text:** `| 7 | Hide legacy Focus Chain setting from active settings UI | Product-surface cleanup once UI/runtime no longer depend on the toggle | `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`, related tests | Users no longer see Focus Chain as an active feature toggle | Medium |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 037 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:829`**
  - **Introduced text:** `| 8 | Stop honoring Focus Chain setting writes in state update handlers | Small controller cleanup once setting is hidden | `src/core/controller/state/updateSettings.ts`, `updateSettingsCli.ts` | Legacy setting becomes compatibility-only rather than active control flow | Medium |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 038 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:830`**
  - **Introduced text:** `| 9 | Remove unused legacy prompt-family files or strip their Focus Chain-gated task_progress text | Static evidence suggests these files may be unreferenced; needs one more reference audit | `src/core/prompts/system-prompt-legacy/families/next-gen-models/gpt-5.ts`, `src/core/prompts/system-prompt-legacy/families/local-models/compact-system-prompt.ts` | Legacy prompt surface no longer carries stale Focus Chain gating | Investigate first / Medium |`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 039 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:833`**
  - **Introduced text:** `### 1. Render task-progress checklist even when legacy Focus Chain is off`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 040 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:867`**
  - **Introduced text:** `### 2. Render task header checklist based on checklist content rather than legacy toggle`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 041 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:871`**
  - **Introduced text:** `**Goal:** Make the task header render the checklist because content exists, not because the legacy feature flag is enabled.`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 042 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:902`**
  - **Introduced text:** `**Why this is third:** Once behavior is decoupled from the legacy flag, the remaining component name mismatch becomes a mechanical cleanup.`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 043 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:1033`**
  - **Introduced text:** `### 7. Hide legacy Focus Chain setting from active settings UI`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 044 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:1037`**
  - **Introduced text:** `**Goal:** Remove the legacy setting from active user-facing settings UI while preserving compatibility in stored state.`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 045 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:1063`**
  - **Introduced text:** `**Suggested commit boundary:** `Hide legacy focus chain setting from settings UI``
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 046 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:1085`**
  - **Introduced text:** `- [x] Remove active-behavior branching/telemetry emission tied solely to the legacy toggle`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 047 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:1097`**
  - **Introduced text:** `### 9. Remove unused legacy prompt-family files or strip their Focus Chain-gated task_progress text`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 048 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:1099`**
  - **Introduced text:** `**Why this is ninth:** Static search currently suggests these legacy prompt-family files may be unreferenced, but that needs one deliberate proof step before deletion.`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 049 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:1101`**
  - **Introduced text:** `**Goal:** Either delete unreferenced legacy prompt files or, if they are still reachable, remove their stale Focus Chain gating in one focused slice.`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 050 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:1105`**
  - **Introduced text:** `- `src/core/prompts/system-prompt-legacy/families/next-gen-models/gpt-5.ts``
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 051 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:1106`**
  - **Introduced text:** `- `src/core/prompts/system-prompt-legacy/families/local-models/compact-system-prompt.ts``
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 052 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:1126`**
  - **Introduced text:** `**Suggested commit boundary:** `Retire unused legacy prompt families` or `Decouple legacy prompt families from focus chain gating``
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 053 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:1167`**
  - **Introduced text:** `- Treat ranks **7–8** as cleanup that becomes safe only after the runtime no longer depends on the legacy setting.`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 054 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:1494`**
  - **Introduced text:** `- [ ] identify legacy subscriptions still in active use`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 055 — `FEATURE-REMOVAL-CLEANUP-PLAN.md:1594`**
  - **Introduced text:** `- a safer path to later deletion of legacy systems,`
  - **Surface:** cleanup-plan document
  - **dpc changed after eve:** no
  - **Rubric result:** Rewrite this plan entry to name the exact compatibility boundary or removal decision instead of using `legacy` as a catch-all category.
  - **Assessment:** This occurrence lives in the cleanup ledger itself, so the implementation should improve the plan language rather than code behavior: name the actual boundary (for example, the gRPC-over-`postMessage` bridge, old terminal mode, or file-based workflow support), state whether it is being kept or removed, and remove success criteria that amount to “relabel it as legacy.” That is appropriate because this document should drive precise cleanup decisions, not perpetuate vague transitional vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `cli/src/components/ConfigView.tsx`

- [ ] **Occurrence 056 — `cli/src/components/ConfigView.tsx:3`**
  - **Introduced text:** ` * Supports tabs for Settings, Rules, legacy Workflows, Hooks, and Skills`
  - **Surface:** user-facing UI surface
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 057 — `cli/src/components/ConfigView.tsx:519`**
  - **Introduced text:** `								No legacy workflows configured. Add workflow files only if you still need `/file.md``
  - **Surface:** user-facing UI surface
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 058 — `cli/src/components/ConfigView.tsx:539`**
  - **Introduced text:** `													? "Global Legacy Workflows:"`
  - **Surface:** user-facing UI surface
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 059 — `cli/src/components/ConfigView.tsx:540`**
  - **Introduced text:** `													: "Workspace Legacy Workflows:"`
  - **Surface:** user-facing UI surface
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `cli/src/components/ConfigViewComponents.tsx`

- [ ] **Occurrence 060 — `cli/src/components/ConfigViewComponents.tsx:74`**
  - **Introduced text:** `	{ key: "workflows", label: "Legacy Workflows" },`
  - **Surface:** user-facing UI surface
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/cline-cli/configuration.mdx`

- [ ] **Occurrence 061 — `docs/cline-cli/configuration.mdx:41`**
  - **Introduced text:** `View and manage [legacy workflows](/customization/workflows):`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/cline-cli/installation.mdx`

- [ ] **Occurrence 062 — `docs/cline-cli/installation.mdx:272`**
  - **Introduced text:** `    Configure settings, rules, skills, legacy workflows, and environment variables.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/contributing/documentation-guide.mdx`

- [ ] **Occurrence 063 — `docs/contributing/documentation-guide.mdx:197`**
  - **Introduced text:** `  <Card title="Legacy Workflows" icon="diagram-project" href="/customization/workflows">`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 064 — `docs/contributing/documentation-guide.mdx:198`**
  - **Introduced text:** `    Learn about Cline's legacy workflow compatibility path.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/core-workflows/using-commands.mdx`

- [ ] **Occurrence 065 — `docs/core-workflows/using-commands.mdx:56`**
  - **Introduced text:** `Beyond the built-in slash commands, Cline still supports legacy workflow files that can be invoked as `/your-workflow.md`. Use this compatibility path only when you specifically need file-based slash commands; for new reusable guidance, prefer [Skills](/customization/skills).`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 066 — `docs/core-workflows/using-commands.mdx:58`**
  - **Introduced text:** `For migration guidance and the remaining compatibility behavior, see [Legacy Workflows](/customization/workflows).`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/customization/overview.mdx`

- [ ] **Occurrence 067 — `docs/customization/overview.mdx:4`**
  - **Introduced text:** `description: "Understand how Rules, Skills, legacy Workflows, Hooks, and .clineignore fit together in Cline customization."`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 068 — `docs/customization/overview.mdx:9`**
  - **Introduced text:** `Cline offers four primary systems plus a legacy compatibility path: Rules, Skills, Hooks, `.clineignore`, and legacy Workflows. Each serves a different purpose and activates at different times.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 069 — `docs/customization/overview.mdx:17`**
  - **Introduced text:** `| **[Legacy Workflows](/customization/workflows)** | File-based slash-command compatibility | Invoked with `/workflow.md` | Existing `/file.md` automations you still need while migrating to skills |`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 070 — `docs/customization/overview.mdx:27`**
  - **Introduced text:** `**[Legacy Workflows](/customization/workflows)** are explicit task scripts you invoke on demand. They remain useful when you already depend on a repeatable `/file.md` flow and need backward compatibility, but they are no longer the preferred direction for new reusable behavior. For new work, reach for [Skills](/customization/skills) first.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 071 — `docs/customization/overview.mdx:39`**
  - **Introduced text:** `3. **Legacy workflows** can still provide the explicit `/release.md` sequence while you migrate that automation toward skills`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 072 — `docs/customization/overview.mdx:51`**
  - **Introduced text:** `| Legacy Workflows | `~/Documents/Cline/Workflows/` | `.clinerules/workflows/` |`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 073 — `docs/customization/overview.mdx:57`**
  - **Introduced text:** `**Start with project storage.** Most customizations belong in your project's directory because they're tied to that specific codebase. Team coding standards, deployment skills, legacy workflows, and architectural constraints all live with the code they describe. This also means your customizations travel with the repository, so collaborators get them automatically and changes can be reviewed in pull requests.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/customization/workflows.mdx`

- [ ] **Occurrence 074 — `docs/customization/workflows.mdx:2`**
  - **Introduced text:** `title: "Legacy Workflows"`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 075 — `docs/customization/workflows.mdx:3`**
  - **Introduced text:** `sidebarTitle: "Legacy Workflows"`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 076 — `docs/customization/workflows.mdx:4`**
  - **Introduced text:** `description: "Use Markdown workflow files only when you need legacy slash-command compatibility while migrating to skills."`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 077 — `docs/customization/workflows.mdx:7`**
  - **Introduced text:** `Workflows are a legacy compatibility feature for file-based slash commands like `/deploy.md`. If you're starting fresh, use [Skills](/customization/skills) instead. Skills are the preferred product direction for reusable guidance because they load on demand, support bundled resources cleanly, and align with the rest of the SDK migration.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 078 — `docs/customization/workflows.mdx:57`**
  - **Introduced text:** `**Prefer skills for new reusable guidance.** After finishing something you'll need to repeat, ask Cline whether it should become a skill or a legacy workflow. Choose a workflow only if you specifically want a `/file.md` command for backward compatibility.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 079 — `docs/customization/workflows.mdx:62`**
  - **Introduced text:** `Type `/` in the chat input to see available legacy workflows. Cline shows autocomplete suggestions as you type, so `/rel` would match `release-prep.md`. Select a workflow and press Enter to start it.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 080 — `docs/customization/workflows.mdx:68`**
  - **Introduced text:** `Every workflow has a toggle to enable or disable it. This lets you control which legacy workflows appear in the `/` menu without deleting the file.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/features/auto-compact.mdx`

- [ ] **Occurrence 081 — `docs/features/auto-compact.mdx:38`**
  - **Introduced text:** `Auto Compact works well with Cline's built-in task-progress tracking and, if you still use it, [Legacy Focus Chain](/features/focus-chain). When Focus Chain is enabled, todo lists persist across summarizations.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/features/focus-chain.mdx`

- [ ] **Occurrence 082 — `docs/features/focus-chain.mdx:2`**
  - **Introduced text:** `title: "Legacy Focus Chain"`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 083 — `docs/features/focus-chain.mdx:3`**
  - **Introduced text:** `sidebarTitle: "Legacy Focus Chain"`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 084 — `docs/features/focus-chain.mdx:4`**
  - **Introduced text:** `description: "A legacy todo-tracking feature kept for compatibility while Cline shifts toward built-in task_progress checklists and Plan & Act workflows."`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 085 — `docs/features/focus-chain.mdx:7`**
  - **Introduced text:** `Focus Chain is a legacy todo-tracking feature that maintains a visible checklist across long-running tasks. It is still available in this branch, but it is no longer the primary product direction for task planning and progress tracking.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/features/memory-bank.mdx`

- [ ] **Occurrence 086 — `docs/features/memory-bank.mdx:2`**
  - **Introduced text:** `title: "Legacy Memory Bank"`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` branding from the Memory Bank page title and copy, while keeping any truthful explanation that this is a manual pattern rather than a primary product direction.
  - **Assessment:** This page is user-facing documentation, not an internal migration shim. The implementation should rewrite the title and descriptive text so they describe Memory Bank as a manual documentation approach, optionally noting that it is no longer the preferred path, without leading with `legacy`. That is appropriate because the current wording reads like product-surface demotion rather than clear guidance. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 087 — `docs/features/memory-bank.mdx:3`**
  - **Introduced text:** `sidebarTitle: "Legacy Memory Bank"`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` branding from the Memory Bank page title and copy, while keeping any truthful explanation that this is a manual pattern rather than a primary product direction.
  - **Assessment:** This page is user-facing documentation, not an internal migration shim. The implementation should rewrite the title and descriptive text so they describe Memory Bank as a manual documentation approach, optionally noting that it is no longer the preferred path, without leading with `legacy`. That is appropriate because the current wording reads like product-surface demotion rather than clear guidance. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 088 — `docs/features/memory-bank.mdx:4`**
  - **Introduced text:** `description: "A legacy documentation methodology for users who still want to maintain manual cross-session context outside Cline's core product direction."`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` branding from the Memory Bank page title and copy, while keeping any truthful explanation that this is a manual pattern rather than a primary product direction.
  - **Assessment:** This page is user-facing documentation, not an internal migration shim. The implementation should rewrite the title and descriptive text so they describe Memory Bank as a manual documentation approach, optionally noting that it is no longer the preferred path, without leading with `legacy`. That is appropriate because the current wording reads like product-surface demotion rather than clear guidance. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 089 — `docs/features/memory-bank.mdx:7`**
  - **Introduced text:** `Memory Bank is a legacy documentation methodology for users who want to maintain structured project context across sessions in plain markdown files. It is no longer a core product direction for Cline, but the pattern can still be useful if you explicitly want to manage persistent context by hand.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` branding from the Memory Bank page title and copy, while keeping any truthful explanation that this is a manual pattern rather than a primary product direction.
  - **Assessment:** This page is user-facing documentation, not an internal migration shim. The implementation should rewrite the title and descriptive text so they describe Memory Bank as a manual documentation approach, optionally noting that it is no longer the preferred path, without leading with `legacy`. That is appropriate because the current wording reads like product-surface demotion rather than clear guidance. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/home.mdx`

- [ ] **Occurrence 090 — `docs/home.mdx:35`**
  - **Introduced text:** `    Tailor Cline to your workflow with rules, skills, legacy workflows, hooks, and .clineignore.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `migration.md`

- [ ] **Occurrence 091 — `migration.md:105`**
  - **Introduced text:** `| `legacy-state-reader` | 42 | Reads `~/.cline/data/` settings |`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** yes
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 092 — `migration.md:216`**
  - **Introduced text:** `| Legacy sessions not resumable | Custom SessionPersistenceAdapter preserves format |`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** yes
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

## `src/core/controller/index.ts`

- [ ] **Occurrence 093 — `src/core/controller/index.ts:1`**
  - **Introduced text:** `import { cleanupLegacyCheckpoints } from "@integrations/checkpoints/CheckpointMigration"`
  - **Surface:** internal runtime/control-flow code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the cleanup/migration behavior if it still serves old checkpoint data, but rename the symbol and prose toward a concrete “old checkpoint” or “pre-migration checkpoint” description.
  - **Assessment:** This occurrence refers to a real migration helper, not a marketing surface. The implementation should preserve the helper if it is still needed, while renaming the symbol and related wording so it explains exactly what is being cleaned up. That is appropriate because the compatibility boundary is real, but `legacy` is still a vague substitute for the actual file/state transition. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/core/controller/state/updateSettings.ts`

- [ ] **Occurrence 094 — `src/core/controller/state/updateSettings.ts:198`**
  - **Introduced text:** `			// Legacy compatibility only: preserve the stored shape without allowing new writes`
  - **Surface:** internal runtime/control-flow code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the compatibility-only behavior for the hidden Focus Chain state if it is still required, but rewrite the comment to say `compatibility-only` or `preserve stored shape` instead of `legacy`.
  - **Assessment:** This occurrence is an internal comment on an active compatibility path. The implementation should leave the guarded behavior alone until the broader runtime cutover is ready, but it should replace the wording with a more precise description of what is being preserved and what is intentionally no longer active. That is appropriate because the behavior may still be needed, while the current label is broader and less informative than necessary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/core/controller/state/updateSettingsCli.ts`

- [ ] **Occurrence 095 — `src/core/controller/state/updateSettingsCli.ts:181`**
  - **Introduced text:** `				// Legacy compatibility only: keep the stored value shape intact without letting`
  - **Surface:** internal runtime/control-flow code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the compatibility-only behavior for the hidden Focus Chain state if it is still required, but rewrite the comment to say `compatibility-only` or `preserve stored shape` instead of `legacy`.
  - **Assessment:** This occurrence is an internal comment on an active compatibility path. The implementation should leave the guarded behavior alone until the broader runtime cutover is ready, but it should replace the wording with a more precise description of what is being preserved and what is intentionally no longer active. That is appropriate because the behavior may still be needed, while the current label is broader and less informative than necessary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/hosts/vscode/VscodeWebviewProvider.ts`

- [ ] **Occurrence 096 — `src/hosts/vscode/VscodeWebviewProvider.ts:7`**
  - **Introduced text:** `import { LegacyStateReader } from "@/sdk/legacy-state-reader"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 097 — `src/hosts/vscode/VscodeWebviewProvider.ts:154`**
  - **Introduced text:** `	 * This creates an SdkController backed by legacy state and wires it`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 098 — `src/hosts/vscode/VscodeWebviewProvider.ts:159`**
  - **Introduced text:** `			const legacyState = new LegacyStateReader()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 099 — `src/hosts/vscode/VscodeWebviewProvider.ts:160`**
  - **Introduced text:** `			const taskHistory = legacyState.readTaskHistory()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 100 — `src/hosts/vscode/VscodeWebviewProvider.ts:168`**
  - **Introduced text:** `			const apiConfiguration = legacyState.buildApiConfiguration()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 101 — `src/hosts/vscode/VscodeWebviewProvider.ts:176`**
  - **Introduced text:** `				mode: legacyState.getMode(),`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 102 — `src/hosts/vscode/VscodeWebviewProvider.ts:179`**
  - **Introduced text:** `				legacyState,`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

## `src/integrations/checkpoints/CheckpointMigration.ts`

- [ ] **Occurrence 103 — `src/integrations/checkpoints/CheckpointMigration.ts:4`**
  - **Introduced text:** `export async function cleanupLegacyCheckpoints(): Promise<void> {}`
  - **Surface:** internal runtime/control-flow code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the cleanup/migration behavior if it still serves old checkpoint data, but rename the symbol and prose toward a concrete “old checkpoint” or “pre-migration checkpoint” description.
  - **Assessment:** This occurrence refers to a real migration helper, not a marketing surface. The implementation should preserve the helper if it is still needed, while renaming the symbol and related wording so it explains exactly what is being cleaned up. That is appropriate because the compatibility boundary is real, but `legacy` is still a vague substitute for the actual file/state transition. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/SdkController.ts`

- [ ] **Occurrence 104 — `src/sdk/SdkController.ts:25`**
  - **Introduced text:** `import type { ClineAuthCredentials, LegacyStateReader } from "./legacy-state-reader"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 105 — `src/sdk/SdkController.ts:76`**
  - **Introduced text:** `	/** Legacy state reader (for settings not yet migrated) */`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 106 — `src/sdk/SdkController.ts:77`**
  - **Introduced text:** `	legacyState?: LegacyStateReader`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 107 — `src/sdk/SdkController.ts:93`**
  - **Introduced text:** `	private legacyState?: LegacyStateReader`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 108 — `src/sdk/SdkController.ts:106`**
  - **Introduced text:** `		this.legacyState = options.legacyState`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 109 — `src/sdk/SdkController.ts:139`**
  - **Introduced text:** `		if (this.legacyState && typeof this.legacyState.readClineAuthInfo === "function") {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 110 — `src/sdk/SdkController.ts:140`**
  - **Introduced text:** `			const authInfo = this.legacyState.readClineAuthInfo()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 111 — `src/sdk/SdkController.ts:150`**
  - **Introduced text:** `			legacyState: this.legacyState,`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 112 — `src/sdk/SdkController.ts:164`**
  - **Introduced text:** `		if (this.legacyState && typeof this.legacyState.readClineAuthInfo === "function") {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 113 — `src/sdk/SdkController.ts:165`**
  - **Introduced text:** `			return this.legacyState.readClineAuthInfo()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 114 — `src/sdk/SdkController.ts:289`**
  - **Introduced text:** `		if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 115 — `src/sdk/SdkController.ts:291`**
  - **Introduced text:** `				const raw = this.legacyState.readUiMessages(id)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 116 — `src/sdk/SdkController.ts:317`**
  - **Introduced text:** `			if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 117 — `src/sdk/SdkController.ts:320`**
  - **Introduced text:** `						this.legacyState.deleteTaskDirectory(item.id)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 118 — `src/sdk/SdkController.ts:329`**
  - **Introduced text:** `			if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 119 — `src/sdk/SdkController.ts:332`**
  - **Introduced text:** `						this.legacyState.deleteTaskDirectory(id)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 120 — `src/sdk/SdkController.ts:349`**
  - **Introduced text:** `		if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 121 — `src/sdk/SdkController.ts:351`**
  - **Introduced text:** `				this.legacyState.saveApiConfiguration(config)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 122 — `src/sdk/SdkController.ts:362`**
  - **Introduced text:** `		if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 123 — `src/sdk/SdkController.ts:364`**
  - **Introduced text:** `				this.legacyState.saveMode(mode)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 124 — `src/sdk/SdkController.ts:377`**
  - **Introduced text:** `		if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 125 — `src/sdk/SdkController.ts:395`**
  - **Introduced text:** `					this.legacyState.saveApiConfiguration(apiConfigUpdates)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 126 — `src/sdk/SdkController.ts:508`**
  - **Introduced text:** `		if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 127 — `src/sdk/SdkController.ts:516`**
  - **Introduced text:** `					this.legacyState.saveUiMessages(taskId, messages)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 128 — `src/sdk/SdkController.ts:526`**
  - **Introduced text:** `		if (!this.legacyState) return`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 129 — `src/sdk/SdkController.ts:529`**
  - **Introduced text:** `			this.legacyState.saveTaskHistory(this.taskHistory)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 130 — `src/sdk/SdkController.ts:617`**
  - **Introduced text:** `		if (!this.legacyState) return undefined`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 131 — `src/sdk/SdkController.ts:618`**
  - **Introduced text:** `		const gs = this.legacyState.readGlobalState()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 132 — `src/sdk/SdkController.ts:627`**
  - **Introduced text:** `		if (!this.legacyState) return`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 133 — `src/sdk/SdkController.ts:629`**
  - **Introduced text:** `		const gsPath = path.join(this.legacyState.dataDir, "globalState.json")`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 134 — `src/sdk/SdkController.ts:683`**
  - **Introduced text:** `		if (!this.legacyState) return 0`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 135 — `src/sdk/SdkController.ts:684`**
  - **Introduced text:** `		const tasksDir = path.join(this.legacyState.dataDir, "tasks")`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 136 — `src/sdk/SdkController.ts:699`**
  - **Introduced text:** `			if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 137 — `src/sdk/SdkController.ts:701`**
  - **Introduced text:** `					messages = this.legacyState.readUiMessages(taskId)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 138 — `src/sdk/SdkController.ts:866`**
  - **Introduced text:** `		if (!this.legacyState) return []`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 139 — `src/sdk/SdkController.ts:869`**
  - **Introduced text:** `			const settings = this.legacyState.readMcpSettings()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

## `src/sdk/__tests__/extension-sdk-smoke.test.ts`

- [ ] **Occurrence 140 — `src/sdk/__tests__/extension-sdk-smoke.test.ts:77`**
  - **Introduced text:** `	it("activates successfully with legacy data", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 141 — `src/sdk/__tests__/extension-sdk-smoke.test.ts:85`**
  - **Introduced text:** `		expect(ctx.legacyState).toBeDefined()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 142 — `src/sdk/__tests__/extension-sdk-smoke.test.ts:103`**
  - **Introduced text:** `	it("loads task history from legacy state", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 143 — `src/sdk/__tests__/extension-sdk-smoke.test.ts:253`**
  - **Introduced text:** `	it("activates without legacy data (fresh install)", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/__tests__/legacy-state-reader.test.ts`

- [ ] **Occurrence 144 — `src/sdk/__tests__/legacy-state-reader.test.ts:5`**
  - **Introduced text:** `import { LegacyStateReader } from "../legacy-state-reader"`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 145 — `src/sdk/__tests__/legacy-state-reader.test.ts:35`**
  - **Introduced text:** `describe("LegacyStateReader", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 146 — `src/sdk/__tests__/legacy-state-reader.test.ts:37`**
  - **Introduced text:** `	let reader: LegacyStateReader`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 147 — `src/sdk/__tests__/legacy-state-reader.test.ts:41`**
  - **Introduced text:** `		reader = new LegacyStateReader({ dataDir })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 148 — `src/sdk/__tests__/legacy-state-reader.test.ts:344`**
  - **Introduced text:** `		it("merges legacy boolean flags with structured settings", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 149 — `src/sdk/__tests__/legacy-state-reader.test.ts:367`**
  - **Introduced text:** `			// Legacy booleans should override structured settings`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 150 — `src/sdk/__tests__/legacy-state-reader.test.ts:481`**
  - **Introduced text:** `			const customReader = new LegacyStateReader({ dataDir })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 151 — `src/sdk/__tests__/legacy-state-reader.test.ts:492`**
  - **Introduced text:** `			const customReader = new LegacyStateReader({ clineDir })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/__tests__/provider-migration.test.ts`

- [ ] **Occurrence 152 — `src/sdk/__tests__/provider-migration.test.ts:44`**
  - **Introduced text:** `		it("migrates Anthropic key from legacy state to providers.json", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 153 — `src/sdk/__tests__/provider-migration.test.ts:140`**
  - **Introduced text:** `			// Legacy data for anthropic`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 154 — `src/sdk/__tests__/provider-migration.test.ts:161`**
  - **Introduced text:** `		it("returns no-legacy-data when no state files exist", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 155 — `src/sdk/__tests__/provider-migration.test.ts:165`**
  - **Introduced text:** `			expect(result.skipReason).toBe("no-legacy-data")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/__tests__/sdk-controller.test.ts`

- [ ] **Occurrence 156 — `src/sdk/__tests__/sdk-controller.test.ts:36`**
  - **Introduced text:** `function createMockLegacyState() {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 157 — `src/sdk/__tests__/sdk-controller.test.ts:253`**
  - **Introduced text:** `		it("persists task to disk via legacyState", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 158 — `src/sdk/__tests__/sdk-controller.test.ts:254`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 159 — `src/sdk/__tests__/sdk-controller.test.ts:260`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 160 — `src/sdk/__tests__/sdk-controller.test.ts:265`**
  - **Introduced text:** `			expect(mockLegacyState.saveTaskHistory).toHaveBeenCalled()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 161 — `src/sdk/__tests__/sdk-controller.test.ts:266`**
  - **Introduced text:** `			expect(mockLegacyState.saveUiMessages).toHaveBeenCalled()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 162 — `src/sdk/__tests__/sdk-controller.test.ts:267`**
  - **Introduced text:** `			const savedHistory = mockLegacyState.saveTaskHistory.mock.calls[0][0]`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 163 — `src/sdk/__tests__/sdk-controller.test.ts:553`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 164 — `src/sdk/__tests__/sdk-controller.test.ts:559`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 165 — `src/sdk/__tests__/sdk-controller.test.ts:590`**
  - **Introduced text:** `			expect(mockLegacyState.saveTaskHistory).toHaveBeenCalled()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 166 — `src/sdk/__tests__/sdk-controller.test.ts:591`**
  - **Introduced text:** `			expect(mockLegacyState.saveUiMessages).toHaveBeenCalled()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 167 — `src/sdk/__tests__/sdk-controller.test.ts:646`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 168 — `src/sdk/__tests__/sdk-controller.test.ts:652`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 169 — `src/sdk/__tests__/sdk-controller.test.ts:659`**
  - **Introduced text:** `			expect(mockLegacyState.saveTaskHistory).toHaveBeenCalled()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 170 — `src/sdk/__tests__/sdk-controller.test.ts:670`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 171 — `src/sdk/__tests__/sdk-controller.test.ts:671`**
  - **Introduced text:** `			mockLegacyState.readUiMessages.mockReturnValue(savedMessages)`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 172 — `src/sdk/__tests__/sdk-controller.test.ts:677`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 173 — `src/sdk/__tests__/sdk-controller.test.ts:704`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 174 — `src/sdk/__tests__/sdk-controller.test.ts:705`**
  - **Introduced text:** `			mockLegacyState.readUiMessages.mockReturnValue([])`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 175 — `src/sdk/__tests__/sdk-controller.test.ts:711`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 176 — `src/sdk/__tests__/sdk-controller.test.ts:725`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 177 — `src/sdk/__tests__/sdk-controller.test.ts:730`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 178 — `src/sdk/__tests__/sdk-controller.test.ts:735`**
  - **Introduced text:** `			expect(mockLegacyState.deleteTaskDirectory).toHaveBeenCalledWith("del_a")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 179 — `src/sdk/__tests__/sdk-controller.test.ts:736`**
  - **Introduced text:** `			expect(mockLegacyState.deleteTaskDirectory).toHaveBeenCalledWith("del_c")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 180 — `src/sdk/__tests__/sdk-controller.test.ts:737`**
  - **Introduced text:** `			expect(mockLegacyState.deleteTaskDirectory).not.toHaveBeenCalledWith("del_b")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 181 — `src/sdk/__tests__/sdk-controller.test.ts:738`**
  - **Introduced text:** `			expect(mockLegacyState.saveTaskHistory).toHaveBeenCalled()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 182 — `src/sdk/__tests__/sdk-controller.test.ts:742`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 183 — `src/sdk/__tests__/sdk-controller.test.ts:747`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 184 — `src/sdk/__tests__/sdk-controller.test.ts:752`**
  - **Introduced text:** `			expect(mockLegacyState.deleteTaskDirectory).toHaveBeenCalledWith("all_a")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 185 — `src/sdk/__tests__/sdk-controller.test.ts:753`**
  - **Introduced text:** `			expect(mockLegacyState.deleteTaskDirectory).toHaveBeenCalledWith("all_b")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 186 — `src/sdk/__tests__/sdk-controller.test.ts:759`**
  - **Introduced text:** `		it("updateApiConfiguration calls legacyState.saveApiConfiguration", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 187 — `src/sdk/__tests__/sdk-controller.test.ts:760`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 188 — `src/sdk/__tests__/sdk-controller.test.ts:761`**
  - **Introduced text:** `			const ctrl = new SdkController({ legacyState: mockLegacyState as any })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 189 — `src/sdk/__tests__/sdk-controller.test.ts:764`**
  - **Introduced text:** `			expect(mockLegacyState.saveApiConfiguration).toHaveBeenCalledWith({ actModeApiProvider: "ollama" })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 190 — `src/sdk/__tests__/sdk-controller.test.ts:767`**
  - **Introduced text:** `		it("togglePlanActMode calls legacyState.saveMode", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 191 — `src/sdk/__tests__/sdk-controller.test.ts:768`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 192 — `src/sdk/__tests__/sdk-controller.test.ts:769`**
  - **Introduced text:** `			const ctrl = new SdkController({ legacyState: mockLegacyState as any })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 193 — `src/sdk/__tests__/sdk-controller.test.ts:772`**
  - **Introduced text:** `			expect(mockLegacyState.saveMode).toHaveBeenCalledWith("plan")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 194 — `src/sdk/__tests__/sdk-controller.test.ts:775`**
  - **Introduced text:** `		it("does not throw when legacyState is not provided", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 195 — `src/sdk/__tests__/sdk-controller.test.ts:781`**
  - **Introduced text:** `		it("updateSettings persists to disk via legacyState", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 196 — `src/sdk/__tests__/sdk-controller.test.ts:782`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 197 — `src/sdk/__tests__/sdk-controller.test.ts:783`**
  - **Introduced text:** `			const ctrl = new SdkController({ legacyState: mockLegacyState as any })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 198 — `src/sdk/__tests__/sdk-controller.test.ts:787`**
  - **Introduced text:** `			expect(mockLegacyState.saveApiConfiguration).toHaveBeenCalledWith(`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 199 — `src/sdk/__tests__/sdk-controller.test.ts:792`**
  - **Introduced text:** `		it("updateSettings does not throw without legacyState", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/__tests__/state-builder.test.ts`

- [ ] **Occurrence 200 — `src/sdk/__tests__/state-builder.test.ts:5`**
  - **Introduced text:** `import type { LegacyStateReader } from "../legacy-state-reader"`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 201 — `src/sdk/__tests__/state-builder.test.ts:12`**
  - **Introduced text:** `/** Create a minimal mock LegacyStateReader */`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 202 — `src/sdk/__tests__/state-builder.test.ts:13`**
  - **Introduced text:** `function mockLegacyState(globalState: Record<string, unknown> = {}): LegacyStateReader {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 203 — `src/sdk/__tests__/state-builder.test.ts:19`**
  - **Introduced text:** `	} as unknown as LegacyStateReader`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 204 — `src/sdk/__tests__/state-builder.test.ts:113`**
  - **Introduced text:** `	describe("with legacy state reader", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 205 — `src/sdk/__tests__/state-builder.test.ts:114`**
  - **Introduced text:** `		it("reads mode from legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 206 — `src/sdk/__tests__/state-builder.test.ts:116`**
  - **Introduced text:** `				legacyState: mockLegacyState({ mode: "plan" }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 207 — `src/sdk/__tests__/state-builder.test.ts:122`**
  - **Introduced text:** `		it("reads auto-approval settings from legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 208 — `src/sdk/__tests__/state-builder.test.ts:124`**
  - **Introduced text:** `				legacyState: mockLegacyState({`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 209 — `src/sdk/__tests__/state-builder.test.ts:148`**
  - **Introduced text:** `		it("reads task history from legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 210 — `src/sdk/__tests__/state-builder.test.ts:152`**
  - **Introduced text:** `				legacyState: mockLegacyState({ taskHistory: items }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 211 — `src/sdk/__tests__/state-builder.test.ts:161`**
  - **Introduced text:** `		it("reads telemetry setting from legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 212 — `src/sdk/__tests__/state-builder.test.ts:163`**
  - **Introduced text:** `				legacyState: mockLegacyState({ telemetrySetting: "enabled" }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 213 — `src/sdk/__tests__/state-builder.test.ts:169`**
  - **Introduced text:** `		it("reads isNewUser from legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 214 — `src/sdk/__tests__/state-builder.test.ts:171`**
  - **Introduced text:** `				legacyState: mockLegacyState({ isNewUser: false }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 215 — `src/sdk/__tests__/state-builder.test.ts:177`**
  - **Introduced text:** `		it("reads welcomeViewCompleted from legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 216 — `src/sdk/__tests__/state-builder.test.ts:179`**
  - **Introduced text:** `				legacyState: mockLegacyState({ welcomeViewCompleted: true }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 217 — `src/sdk/__tests__/state-builder.test.ts:247`**
  - **Introduced text:** `		it("prefers explicit taskHistory over legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 218 — `src/sdk/__tests__/state-builder.test.ts:249`**
  - **Introduced text:** `			const legacy = [makeHistoryItem({ ts: 2000, task: "Legacy" })]`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 219 — `src/sdk/__tests__/state-builder.test.ts:253`**
  - **Introduced text:** `				legacyState: mockLegacyState({ taskHistory: legacy }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 220 — `src/sdk/__tests__/state-builder.test.ts:275`**
  - **Introduced text:** `		it("falls back to legacy state apiConfiguration", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 221 — `src/sdk/__tests__/state-builder.test.ts:277`**
  - **Introduced text:** `				legacyState: mockLegacyState({`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 222 — `src/sdk/__tests__/state-builder.test.ts:332`**
  - **Introduced text:** `				legacyState: mockLegacyState({ mode: "plan" }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 223 — `src/sdk/__tests__/state-builder.test.ts:420`**
  - **Introduced text:** `	it("settings round-trip: legacy state → ExtensionState preserves values", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 224 — `src/sdk/__tests__/state-builder.test.ts:421`**
  - **Introduced text:** `		const legacy = mockLegacyState({`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 225 — `src/sdk/__tests__/state-builder.test.ts:443`**
  - **Introduced text:** `		const state = buildExtensionState({ legacyState: legacy })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/extension-sdk.ts`

- [ ] **Occurrence 226 — `src/sdk/extension-sdk.ts:12`**
  - **Introduced text:** ` * 1. Reads legacy state from ~/.cline/data/`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 227 — `src/sdk/extension-sdk.ts:23`**
  - **Introduced text:** `import { LegacyStateReader } from "./legacy-state-reader"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 228 — `src/sdk/extension-sdk.ts:35`**
  - **Introduced text:** `	/** The legacy state reader */`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 229 — `src/sdk/extension-sdk.ts:36`**
  - **Introduced text:** `	legacyState: LegacyStateReader`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 230 — `src/sdk/extension-sdk.ts:77`**
  - **Introduced text:** `	// 1. Read legacy state`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 231 — `src/sdk/extension-sdk.ts:78`**
  - **Introduced text:** `	const legacyState = new LegacyStateReader({`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 232 — `src/sdk/extension-sdk.ts:87`**
  - **Introduced text:** `				dataDir: legacyState.dataDir,`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 233 — `src/sdk/extension-sdk.ts:98`**
  - **Introduced text:** `	// 3. Read task history from legacy state`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 234 — `src/sdk/extension-sdk.ts:99`**
  - **Introduced text:** `	const taskHistory = legacyState.readTaskHistory()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 235 — `src/sdk/extension-sdk.ts:106`**
  - **Introduced text:** `	const apiConfiguration = legacyState.buildApiConfiguration()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 236 — `src/sdk/extension-sdk.ts:107`**
  - **Introduced text:** `	const globalState = legacyState.readGlobalState()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 237 — `src/sdk/extension-sdk.ts:116`**
  - **Introduced text:** `		legacyState,`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 238 — `src/sdk/extension-sdk.ts:122`**
  - **Introduced text:** `		legacyState,`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/index.ts`

- [ ] **Occurrence 239 — `src/sdk/index.ts:9`**
  - **Introduced text:** ` * - legacy-state-reader: Reads existing ~/.cline/data/ files`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 240 — `src/sdk/index.ts:19`**
  - **Introduced text:** `export { LegacyStateReader } from "./legacy-state-reader"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 241 — `src/sdk/index.ts:20`**
  - **Introduced text:** `export type { LegacyGlobalState, LegacySecrets, LegacyStateReaderOptions } from "./legacy-state-reader"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/legacy-state-reader.ts`

- [ ] **Occurrence 242 — `src/sdk/legacy-state-reader.ts:2`**
  - **Introduced text:** ` * Legacy State Reader`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 243 — `src/sdk/legacy-state-reader.ts:36`**
  - **Introduced text:** `export interface LegacyGlobalState {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 244 — `src/sdk/legacy-state-reader.ts:54`**
  - **Introduced text:** `	// Auto-approval (legacy top-level booleans)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Keep the compatibility behavior if it is still needed, but replace `legacy` with a precise description of the old storage shape, location, or migration condition that is actually being handled.
  - **Assessment:** This occurrence is describing a real compatibility detail inside the SDK adapter layer. The implementation should not delete the behavior blindly; instead, it should rename the comment, enum value, or message so it refers to the exact old format or pre-SDK state condition in play. That is appropriate because the compatibility boundary may still be real, but the blanket `legacy` wording is more dramatic and less precise than necessary. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 245 — `src/sdk/legacy-state-reader.ts:69`**
  - **Introduced text:** `	// Task history (legacy location — may still be in globalState for old installs)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Keep the compatibility behavior if it is still needed, but replace `legacy` with a precise description of the old storage shape, location, or migration condition that is actually being handled.
  - **Assessment:** This occurrence is describing a real compatibility detail inside the SDK adapter layer. The implementation should not delete the behavior blindly; instead, it should rename the comment, enum value, or message so it refers to the exact old format or pre-SDK state condition in play. That is appropriate because the compatibility boundary may still be real, but the blanket `legacy` wording is more dramatic and less precise than necessary. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 246 — `src/sdk/legacy-state-reader.ts:83`**
  - **Introduced text:** `export type LegacySecrets = Partial<Record<SecretKey, string>>`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 247 — `src/sdk/legacy-state-reader.ts:110`**
  - **Introduced text:** `/** Options for constructing a LegacyStateReader. */`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 248 — `src/sdk/legacy-state-reader.ts:111`**
  - **Introduced text:** `export interface LegacyStateReaderOptions {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 249 — `src/sdk/legacy-state-reader.ts:122`**
  - **Introduced text:** `export class LegacyStateReader {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 250 — `src/sdk/legacy-state-reader.ts:125`**
  - **Introduced text:** `	constructor(opts: LegacyStateReaderOptions = {}) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 251 — `src/sdk/legacy-state-reader.ts:139`**
  - **Introduced text:** `	readGlobalState(): LegacyGlobalState {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 252 — `src/sdk/legacy-state-reader.ts:140`**
  - **Introduced text:** `		return this.readJsonFile<LegacyGlobalState>(path.join(this.dataDir, "globalState.json")) ?? {}`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 253 — `src/sdk/legacy-state-reader.ts:148`**
  - **Introduced text:** `	readSecrets(): LegacySecrets {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 254 — `src/sdk/legacy-state-reader.ts:149`**
  - **Introduced text:** `		return this.readJsonFile<LegacySecrets>(path.join(this.dataDir, "secrets.json")) ?? {}`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 255 — `src/sdk/legacy-state-reader.ts:159`**
  - **Introduced text:** `	 * legacy location inside globalState.json.`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Keep the compatibility behavior if it is still needed, but replace `legacy` with a precise description of the old storage shape, location, or migration condition that is actually being handled.
  - **Assessment:** This occurrence is describing a real compatibility detail inside the SDK adapter layer. The implementation should not delete the behavior blindly; instead, it should rename the comment, enum value, or message so it refers to the exact old format or pre-SDK state condition in play. That is appropriate because the compatibility boundary may still be real, but the blanket `legacy` wording is more dramatic and less precise than necessary. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 256 — `src/sdk/legacy-state-reader.ts:169`**
  - **Introduced text:** `		// Fallback: legacy location in globalState.json`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Keep the compatibility behavior if it is still needed, but replace `legacy` with a precise description of the old storage shape, location, or migration condition that is actually being handled.
  - **Assessment:** This occurrence is describing a real compatibility detail inside the SDK adapter layer. The implementation should not delete the behavior blindly; instead, it should rename the comment, enum value, or message so it refers to the exact old format or pre-SDK state condition in play. That is appropriate because the compatibility boundary may still be real, but the blanket `legacy` wording is more dramatic and less precise than necessary. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 257 — `src/sdk/legacy-state-reader.ts:239`**
  - **Introduced text:** `	 * legacy top-level boolean flags for backward compatibility.`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Keep the compatibility behavior if it is still needed, but replace `legacy` with a precise description of the old storage shape, location, or migration condition that is actually being handled.
  - **Assessment:** This occurrence is describing a real compatibility detail inside the SDK adapter layer. The implementation should not delete the behavior blindly; instead, it should rename the comment, enum value, or message so it refers to the exact old format or pre-SDK state condition in play. That is appropriate because the compatibility boundary may still be real, but the blanket `legacy` wording is more dramatic and less precise than necessary. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 258 — `src/sdk/legacy-state-reader.ts:260`**
  - **Introduced text:** `		// Legacy top-level booleans override structured settings`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Keep the compatibility behavior if it is still needed, but replace `legacy` with a precise description of the old storage shape, location, or migration condition that is actually being handled.
  - **Assessment:** This occurrence is describing a real compatibility detail inside the SDK adapter layer. The implementation should not delete the behavior blindly; instead, it should rename the comment, enum value, or message so it refers to the exact old format or pre-SDK state condition in play. That is appropriate because the compatibility boundary may still be real, but the blanket `legacy` wording is more dramatic and less precise than necessary. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 259 — `src/sdk/legacy-state-reader.ts:455`**
  - **Introduced text:** `			Logger.error(`[LegacyStateReader] Failed to delete task directory ${taskDir}:`, err)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 260 — `src/sdk/legacy-state-reader.ts:528`**
  - **Introduced text:** `			Logger.error(`[LegacyStateReader] Failed to write ${filePath}:`, err)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

## `src/sdk/provider-migration.ts`

- [ ] **Occurrence 261 — `src/sdk/provider-migration.ts:5`**
  - **Introduced text:** ` * `migrateLegacyProviderSettings()`) with:`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 262 — `src/sdk/provider-migration.ts:39`**
  - **Introduced text:** `	skipReason?: "sentinel" | "no-legacy-data" | "error"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 263 — `src/sdk/provider-migration.ts:73`**
  - **Introduced text:** ` * migrateLegacyProviderSettings() when it receives a dataDir.`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 264 — `src/sdk/provider-migration.ts:90`**
  - **Introduced text:** `		// Check if there's any legacy data to migrate`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 265 — `src/sdk/provider-migration.ts:96`**
  - **Introduced text:** `			return { ran: false, manager, skipReason: "no-legacy-data" }`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 266 — `src/sdk/provider-migration.ts:103`**
  - **Introduced text:** `		// The constructor auto-calls migrateLegacyProviderSettings() which`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/state-builder.ts`

- [ ] **Occurrence 267 — `src/sdk/state-builder.ts:5`**
  - **Introduced text:** ` * legacy settings, SDK session state, and current messages. This is`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 268 — `src/sdk/state-builder.ts:24`**
  - **Introduced text:** `import type { LegacyStateReader } from "./legacy-state-reader"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 269 — `src/sdk/state-builder.ts:39`**
  - **Introduced text:** `	/** Legacy state reader for reading persisted settings */`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 270 — `src/sdk/state-builder.ts:40`**
  - **Introduced text:** `	legacyState?: LegacyStateReader`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 271 — `src/sdk/state-builder.ts:88`**
  - **Introduced text:** `	const legacyState = input.legacyState`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 272 — `src/sdk/state-builder.ts:89`**
  - **Introduced text:** `	const globalState = legacyState?.readGlobalState()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 273 — `src/sdk/state-builder.ts:91`**
  - **Introduced text:** `	const autoApprovalSettings: AutoApprovalSettings = legacyState?.readAutoApprovalSettings`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [ ] **Occurrence 274 — `src/sdk/state-builder.ts:92`**
  - **Introduced text:** `		? legacyState.readAutoApprovalSettings()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

## `webview-ui/src/components/settings/UseCustomPromptCheckbox.tsx`

- [ ] **Occurrence 275 — `webview-ui/src/components/settings/UseCustomPromptCheckbox.tsx:31`**
  - **Introduced text:** `					Does not support Mcp and Legacy Focus Chain`
  - **Surface:** user-facing UI surface
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `webview-ui/src/components/settings/sections/FeatureSettingsSection.spec.tsx`

- [ ] **Occurrence 276 — `webview-ui/src/components/settings/sections/FeatureSettingsSection.spec.tsx:79`**
  - **Introduced text:** `	it("does not render the legacy Focus Chain setting", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [ ] **Occurrence 277 — `webview-ui/src/components/settings/sections/FeatureSettingsSection.spec.tsx:82`**
  - **Introduced text:** `		expect(screen.queryByText("Legacy Focus Chain")).toBeNull()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

