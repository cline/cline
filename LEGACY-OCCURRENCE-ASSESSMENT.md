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

- [x] **Occurrence 001 — `ARCHITECTURE.md:66`**
  - **Introduced text:** `Terminal integration: There is legacy code in the VSCode extension,`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 002 — `ARCHITECTURE.md:394`**
  - **Introduced text:** ``LegacySessionBackend` adapter wraps the existing`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 003 — `ARCHITECTURE.md:644`**
  - **Introduced text:** `  session-backend.ts    — LegacySessionBackend adapter`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 004 — `ARCHITECTURE.md:646`**
  - **Introduced text:** `  provider-migration.ts — Legacy provider settings migration`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 005 — `ARCHITECTURE.md:768`**
  - **Introduced text:** `1. **Legacy provider settings migration** —`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 006 — `ARCHITECTURE.md:769`**
  - **Introduced text:** `   `migrateLegacyProviderSettings()` reads `globalState.json` +`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 007 — `ARCHITECTURE.md:787`**
  - **Introduced text:** `   legacy format migration.`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `CAVEATS.md`

- [x] **Occurrence 008 — `CAVEATS.md:3`**
  - **Introduced text:** `Tracking issues found during the migration from the legacy inference system to the ClineCore SDK.`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** yes
  - **Rubric result:** Reword this caveat or fix note to describe the exact pre-SDK system or adapter involved, and follow any future adapter renames instead of locking the document to eve-era `legacy` terminology.
  - **Assessment:** This occurrence is explanatory documentation about migration behavior. The implementation should keep the factual caveat or fix description, but rename the underlying concepts precisely—such as `pre-SDK inference stack`, `stored disk state`, or whatever the adapter is ultimately called—rather than keeping `legacy` as the headline term. That is appropriate because the document should help future maintainers understand what was fixed without freezing in transitional naming debt. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 009 — `CAVEATS.md:26`**
  - **Introduced text:** `**Fix:** `SdkController` now persists tasks on three paths: (1) `done` event updates `currentTaskItem` with final usage and calls `persistCurrentTask()`, (2) `clearTask()` calls `persistCurrentTask()` before resetting, (3) `cancelTask()` persists the in-progress task. `LegacyStateReader` gained `saveTaskHistory()`, `saveUiMessages()`, and `deleteTaskDirectory()` methods for disk I/O.`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** yes
  - **Rubric result:** Reword this caveat or fix note to describe the exact pre-SDK system or adapter involved, and follow any future adapter renames instead of locking the document to eve-era `legacy` terminology.
  - **Assessment:** This occurrence is explanatory documentation about migration behavior. The implementation should keep the factual caveat or fix description, but rename the underlying concepts precisely—such as `pre-SDK inference stack`, `stored disk state`, or whatever the adapter is ultimately called—rather than keeping `legacy` as the headline term. That is appropriate because the document should help future maintainers understand what was fixed without freezing in transitional naming debt. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 010 — `CAVEATS.md:31`**
  - **Introduced text:** `**Fix:** `showTaskWithId()` now finds the task in history, loads saved UI messages via `legacyState.readUiMessages()`, restores them into the translator, and sets `currentTaskItem`. The task view renders with full message history.`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** yes
  - **Rubric result:** Reword this caveat or fix note to describe the exact pre-SDK system or adapter involved, and follow any future adapter renames instead of locking the document to eve-era `legacy` terminology.
  - **Assessment:** This occurrence is explanatory documentation about migration behavior. The implementation should keep the factual caveat or fix description, but rename the underlying concepts precisely—such as `pre-SDK inference stack`, `stored disk state`, or whatever the adapter is ultimately called—rather than keeping `legacy` as the headline term. That is appropriate because the document should help future maintainers understand what was fixed without freezing in transitional naming debt. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 011 — `CAVEATS.md:36`**
  - **Introduced text:** `**Fix:** `updateSettings()` now persists settings to `globalState.json` via `legacyState.saveApiConfiguration()`. `updateAutoApprovalSettings()` also persists via the same mechanism.`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** yes
  - **Rubric result:** Reword this caveat or fix note to describe the exact pre-SDK system or adapter involved, and follow any future adapter renames instead of locking the document to eve-era `legacy` terminology.
  - **Assessment:** This occurrence is explanatory documentation about migration behavior. The implementation should keep the factual caveat or fix description, but rename the underlying concepts precisely—such as `pre-SDK inference stack`, `stored disk state`, or whatever the adapter is ultimately called—rather than keeping `legacy` as the headline term. That is appropriate because the document should help future maintainers understand what was fixed without freezing in transitional naming debt. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

## `cli/src/components/ConfigView.tsx`

- [x] **Occurrence 012 — `cli/src/components/ConfigView.tsx:3`**
  - **Introduced text:** ` * Supports tabs for Settings, Rules, legacy Workflows, Hooks, and Skills`
  - **Surface:** user-facing UI surface
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 013 — `cli/src/components/ConfigView.tsx:519`**
  - **Introduced text:** `								No legacy workflows configured. Add workflow files only if you still need `/file.md``
  - **Surface:** user-facing UI surface
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 014 — `cli/src/components/ConfigView.tsx:539`**
  - **Introduced text:** `													? "Global Legacy Workflows:"`
  - **Surface:** user-facing UI surface
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 015 — `cli/src/components/ConfigView.tsx:540`**
  - **Introduced text:** `													: "Workspace Legacy Workflows:"`
  - **Surface:** user-facing UI surface
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `cli/src/components/ConfigViewComponents.tsx`

- [x] **Occurrence 016 — `cli/src/components/ConfigViewComponents.tsx:74`**
  - **Introduced text:** `	{ key: "workflows", label: "Legacy Workflows" },`
  - **Surface:** user-facing UI surface
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/cline-cli/configuration.mdx`

- [x] **Occurrence 017 — `docs/cline-cli/configuration.mdx:41`**
  - **Introduced text:** `View and manage [legacy workflows](/customization/workflows):`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/cline-cli/installation.mdx`

- [x] **Occurrence 018 — `docs/cline-cli/installation.mdx:272`**
  - **Introduced text:** `    Configure settings, rules, skills, legacy workflows, and environment variables.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/contributing/documentation-guide.mdx`

- [x] **Occurrence 019 — `docs/contributing/documentation-guide.mdx:197`**
  - **Introduced text:** `  <Card title="Legacy Workflows" icon="diagram-project" href="/customization/workflows">`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 020 — `docs/contributing/documentation-guide.mdx:198`**
  - **Introduced text:** `    Learn about Cline's legacy workflow compatibility path.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/core-workflows/using-commands.mdx`

- [x] **Occurrence 021 — `docs/core-workflows/using-commands.mdx:56`**
  - **Introduced text:** `Beyond the built-in slash commands, Cline still supports legacy workflow files that can be invoked as `/your-workflow.md`. Use this compatibility path only when you specifically need file-based slash commands; for new reusable guidance, prefer [Skills](/customization/skills).`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 022 — `docs/core-workflows/using-commands.mdx:58`**
  - **Introduced text:** `For migration guidance and the remaining compatibility behavior, see [Legacy Workflows](/customization/workflows).`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/customization/overview.mdx`

- [x] **Occurrence 023 — `docs/customization/overview.mdx:4`**
  - **Introduced text:** `description: "Understand how Rules, Skills, legacy Workflows, Hooks, and .clineignore fit together in Cline customization."`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 024 — `docs/customization/overview.mdx:9`**
  - **Introduced text:** `Cline offers four primary systems plus a legacy compatibility path: Rules, Skills, Hooks, `.clineignore`, and legacy Workflows. Each serves a different purpose and activates at different times.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 025 — `docs/customization/overview.mdx:17`**
  - **Introduced text:** `| **[Legacy Workflows](/customization/workflows)** | File-based slash-command compatibility | Invoked with `/workflow.md` | Existing `/file.md` automations you still need while migrating to skills |`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 026 — `docs/customization/overview.mdx:27`**
  - **Introduced text:** `**[Legacy Workflows](/customization/workflows)** are explicit task scripts you invoke on demand. They remain useful when you already depend on a repeatable `/file.md` flow and need backward compatibility, but they are no longer the preferred direction for new reusable behavior. For new work, reach for [Skills](/customization/skills) first.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 027 — `docs/customization/overview.mdx:39`**
  - **Introduced text:** `3. **Legacy workflows** can still provide the explicit `/release.md` sequence while you migrate that automation toward skills`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 028 — `docs/customization/overview.mdx:51`**
  - **Introduced text:** `| Legacy Workflows | `~/Documents/Cline/Workflows/` | `.clinerules/workflows/` |`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 029 — `docs/customization/overview.mdx:57`**
  - **Introduced text:** `**Start with project storage.** Most customizations belong in your project's directory because they're tied to that specific codebase. Team coding standards, deployment skills, legacy workflows, and architectural constraints all live with the code they describe. This also means your customizations travel with the repository, so collaborators get them automatically and changes can be reviewed in pull requests.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/customization/workflows.mdx`

- [x] **Occurrence 030 — `docs/customization/workflows.mdx:2`**
  - **Introduced text:** `title: "Legacy Workflows"`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 031 — `docs/customization/workflows.mdx:3`**
  - **Introduced text:** `sidebarTitle: "Legacy Workflows"`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 032 — `docs/customization/workflows.mdx:4`**
  - **Introduced text:** `description: "Use Markdown workflow files only when you need legacy slash-command compatibility while migrating to skills."`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 033 — `docs/customization/workflows.mdx:7`**
  - **Introduced text:** `Workflows are a legacy compatibility feature for file-based slash commands like `/deploy.md`. If you're starting fresh, use [Skills](/customization/skills) instead. Skills are the preferred product direction for reusable guidance because they load on demand, support bundled resources cleanly, and align with the rest of the SDK migration.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 034 — `docs/customization/workflows.mdx:57`**
  - **Introduced text:** `**Prefer skills for new reusable guidance.** After finishing something you'll need to repeat, ask Cline whether it should become a skill or a legacy workflow. Choose a workflow only if you specifically want a `/file.md` command for backward compatibility.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 035 — `docs/customization/workflows.mdx:62`**
  - **Introduced text:** `Type `/` in the chat input to see available legacy workflows. Cline shows autocomplete suggestions as you type, so `/rel` would match `release-prep.md`. Select a workflow and press Enter to start it.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 036 — `docs/customization/workflows.mdx:68`**
  - **Introduced text:** `Every workflow has a toggle to enable or disable it. This lets you control which legacy workflows appear in the `/` menu without deleting the file.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/features/auto-compact.mdx`

- [x] **Occurrence 037 — `docs/features/auto-compact.mdx:38`**
  - **Introduced text:** `Auto Compact works well with Cline's built-in task-progress tracking and, if you still use it, [Legacy Focus Chain](/features/focus-chain). When Focus Chain is enabled, todo lists persist across summarizations.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/features/focus-chain.mdx`

- [x] **Occurrence 038 — `docs/features/focus-chain.mdx:2`**
  - **Introduced text:** `title: "Legacy Focus Chain"`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 039 — `docs/features/focus-chain.mdx:3`**
  - **Introduced text:** `sidebarTitle: "Legacy Focus Chain"`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 040 — `docs/features/focus-chain.mdx:4`**
  - **Introduced text:** `description: "A legacy todo-tracking feature kept for compatibility while Cline shifts toward built-in task_progress checklists and Plan & Act workflows."`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 041 — `docs/features/focus-chain.mdx:7`**
  - **Introduced text:** `Focus Chain is a legacy todo-tracking feature that maintains a visible checklist across long-running tasks. It is still available in this branch, but it is no longer the primary product direction for task planning and progress tracking.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/features/memory-bank.mdx`

- [x] **Occurrence 042 — `docs/features/memory-bank.mdx:2`**
  - **Introduced text:** `title: "Legacy Memory Bank"`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` branding from the Memory Bank page title and copy, while keeping any truthful explanation that this is a manual pattern rather than a primary product direction.
  - **Assessment:** This page is user-facing documentation, not an internal migration shim. The implementation should rewrite the title and descriptive text so they describe Memory Bank as a manual documentation approach, optionally noting that it is no longer the preferred path, without leading with `legacy`. That is appropriate because the current wording reads like product-surface demotion rather than clear guidance. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 043 — `docs/features/memory-bank.mdx:3`**
  - **Introduced text:** `sidebarTitle: "Legacy Memory Bank"`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` branding from the Memory Bank page title and copy, while keeping any truthful explanation that this is a manual pattern rather than a primary product direction.
  - **Assessment:** This page is user-facing documentation, not an internal migration shim. The implementation should rewrite the title and descriptive text so they describe Memory Bank as a manual documentation approach, optionally noting that it is no longer the preferred path, without leading with `legacy`. That is appropriate because the current wording reads like product-surface demotion rather than clear guidance. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 044 — `docs/features/memory-bank.mdx:4`**
  - **Introduced text:** `description: "A legacy documentation methodology for users who still want to maintain manual cross-session context outside Cline's core product direction."`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` branding from the Memory Bank page title and copy, while keeping any truthful explanation that this is a manual pattern rather than a primary product direction.
  - **Assessment:** This page is user-facing documentation, not an internal migration shim. The implementation should rewrite the title and descriptive text so they describe Memory Bank as a manual documentation approach, optionally noting that it is no longer the preferred path, without leading with `legacy`. That is appropriate because the current wording reads like product-surface demotion rather than clear guidance. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 045 — `docs/features/memory-bank.mdx:7`**
  - **Introduced text:** `Memory Bank is a legacy documentation methodology for users who want to maintain structured project context across sessions in plain markdown files. It is no longer a core product direction for Cline, but the pattern can still be useful if you explicitly want to manage persistent context by hand.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` branding from the Memory Bank page title and copy, while keeping any truthful explanation that this is a manual pattern rather than a primary product direction.
  - **Assessment:** This page is user-facing documentation, not an internal migration shim. The implementation should rewrite the title and descriptive text so they describe Memory Bank as a manual documentation approach, optionally noting that it is no longer the preferred path, without leading with `legacy`. That is appropriate because the current wording reads like product-surface demotion rather than clear guidance. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `docs/home.mdx`

- [x] **Occurrence 046 — `docs/home.mdx:35`**
  - **Introduced text:** `    Tailor Cline to your workflow with rules, skills, legacy workflows, hooks, and .clineignore.`
  - **Surface:** user-facing or contributor-facing documentation
  - **dpc changed after eve:** no
  - **Rubric result:** Remove `legacy` product branding; keep the workflow feature description or UI, but describe it as `Workflows` or `file-based workflows` and reserve any migration note for a secondary explanatory sentence.
  - **Assessment:** This occurrence sits on a still-live workflow surface. The implementation path should keep the feature intact, rename tabs/titles/labels/help text away from `legacy`, and then retain at most a narrowly worded note that skills are the preferred path for new reusable guidance. That is the appropriate outcome because users are still meant to discover and use workflows here, so the current wording creates support-status confusion instead of clarifying compatibility. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `migration.md`

- [x] **Occurrence 047 — `migration.md:105`**
  - **Introduced text:** `| `legacy-state-reader` | 42 | Reads `~/.cline/data/` settings |`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** yes
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 048 — `migration.md:216`**
  - **Introduced text:** `| Legacy sessions not resumable | Custom SessionPersistenceAdapter preserves format |`
  - **Surface:** engineering documentation
  - **dpc changed after eve:** yes
  - **Rubric result:** Replace broad `legacy` wording with concrete architectural terms such as `existing VSCode implementation`, `old on-disk format`, `compatibility adapter`, or the exact symbol name being discussed.
  - **Assessment:** This occurrence is in engineering documentation. The implementation should preserve the architectural explanation but swap the blanket `legacy` label for a concrete description of the boundary being documented; if a symbol is ultimately renamed, the doc should follow that rename as part of the same cleanup stream. That is appropriate because architecture docs should maximize precision, not repeat transitional jargon. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

## `src/core/controller/index.ts`

- [x] **Occurrence 049 — `src/core/controller/index.ts:1`**
  - **Introduced text:** `import { cleanupLegacyCheckpoints } from "@integrations/checkpoints/CheckpointMigration"`
  - **Surface:** internal runtime/control-flow code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the cleanup/migration behavior if it still serves old checkpoint data, but rename the symbol and prose toward a concrete “old checkpoint” or “pre-migration checkpoint” description.
  - **Assessment:** This occurrence refers to a real migration helper, not a marketing surface. The implementation should preserve the helper if it is still needed, while renaming the symbol and related wording so it explains exactly what is being cleaned up. That is appropriate because the compatibility boundary is real, but `legacy` is still a vague substitute for the actual file/state transition. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/core/controller/state/updateSettings.ts`

- [x] **Occurrence 050 — `src/core/controller/state/updateSettings.ts:198`**
  - **Introduced text:** `			// Legacy compatibility only: preserve the stored shape without allowing new writes`
  - **Surface:** internal runtime/control-flow code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the compatibility-only behavior for the hidden Focus Chain state if it is still required, but rewrite the comment to say `compatibility-only` or `preserve stored shape` instead of `legacy`.
  - **Assessment:** This occurrence is an internal comment on an active compatibility path. The implementation should leave the guarded behavior alone until the broader runtime cutover is ready, but it should replace the wording with a more precise description of what is being preserved and what is intentionally no longer active. That is appropriate because the behavior may still be needed, while the current label is broader and less informative than necessary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/core/controller/state/updateSettingsCli.ts`

- [x] **Occurrence 051 — `src/core/controller/state/updateSettingsCli.ts:181`**
  - **Introduced text:** `				// Legacy compatibility only: keep the stored value shape intact without letting`
  - **Surface:** internal runtime/control-flow code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the compatibility-only behavior for the hidden Focus Chain state if it is still required, but rewrite the comment to say `compatibility-only` or `preserve stored shape` instead of `legacy`.
  - **Assessment:** This occurrence is an internal comment on an active compatibility path. The implementation should leave the guarded behavior alone until the broader runtime cutover is ready, but it should replace the wording with a more precise description of what is being preserved and what is intentionally no longer active. That is appropriate because the behavior may still be needed, while the current label is broader and less informative than necessary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/hosts/vscode/VscodeWebviewProvider.ts`

- [x] **Occurrence 052 — `src/hosts/vscode/VscodeWebviewProvider.ts:7`**
  - **Introduced text:** `import { LegacyStateReader } from "@/sdk/legacy-state-reader"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 053 — `src/hosts/vscode/VscodeWebviewProvider.ts:154`**
  - **Introduced text:** `	 * This creates an SdkController backed by legacy state and wires it`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 054 — `src/hosts/vscode/VscodeWebviewProvider.ts:159`**
  - **Introduced text:** `			const legacyState = new LegacyStateReader()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 055 — `src/hosts/vscode/VscodeWebviewProvider.ts:160`**
  - **Introduced text:** `			const taskHistory = legacyState.readTaskHistory()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 056 — `src/hosts/vscode/VscodeWebviewProvider.ts:168`**
  - **Introduced text:** `			const apiConfiguration = legacyState.buildApiConfiguration()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 057 — `src/hosts/vscode/VscodeWebviewProvider.ts:176`**
  - **Introduced text:** `				mode: legacyState.getMode(),`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 058 — `src/hosts/vscode/VscodeWebviewProvider.ts:179`**
  - **Introduced text:** `				legacyState,`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

## `src/integrations/checkpoints/CheckpointMigration.ts`

- [x] **Occurrence 059 — `src/integrations/checkpoints/CheckpointMigration.ts:4`**
  - **Introduced text:** `export async function cleanupLegacyCheckpoints(): Promise<void> {}`
  - **Surface:** internal runtime/control-flow code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the cleanup/migration behavior if it still serves old checkpoint data, but rename the symbol and prose toward a concrete “old checkpoint” or “pre-migration checkpoint” description.
  - **Assessment:** This occurrence refers to a real migration helper, not a marketing surface. The implementation should preserve the helper if it is still needed, while renaming the symbol and related wording so it explains exactly what is being cleaned up. That is appropriate because the compatibility boundary is real, but `legacy` is still a vague substitute for the actual file/state transition. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/SdkController.ts`

- [x] **Occurrence 060 — `src/sdk/SdkController.ts:25`**
  - **Introduced text:** `import type { ClineAuthCredentials, LegacyStateReader } from "./legacy-state-reader"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 061 — `src/sdk/SdkController.ts:76`**
  - **Introduced text:** `	/** Legacy state reader (for settings not yet migrated) */`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 062 — `src/sdk/SdkController.ts:77`**
  - **Introduced text:** `	legacyState?: LegacyStateReader`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 063 — `src/sdk/SdkController.ts:93`**
  - **Introduced text:** `	private legacyState?: LegacyStateReader`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 064 — `src/sdk/SdkController.ts:106`**
  - **Introduced text:** `		this.legacyState = options.legacyState`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 065 — `src/sdk/SdkController.ts:139`**
  - **Introduced text:** `		if (this.legacyState && typeof this.legacyState.readClineAuthInfo === "function") {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 066 — `src/sdk/SdkController.ts:140`**
  - **Introduced text:** `			const authInfo = this.legacyState.readClineAuthInfo()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 067 — `src/sdk/SdkController.ts:150`**
  - **Introduced text:** `			legacyState: this.legacyState,`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 068 — `src/sdk/SdkController.ts:164`**
  - **Introduced text:** `		if (this.legacyState && typeof this.legacyState.readClineAuthInfo === "function") {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 069 — `src/sdk/SdkController.ts:165`**
  - **Introduced text:** `			return this.legacyState.readClineAuthInfo()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 070 — `src/sdk/SdkController.ts:289`**
  - **Introduced text:** `		if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 071 — `src/sdk/SdkController.ts:291`**
  - **Introduced text:** `				const raw = this.legacyState.readUiMessages(id)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 072 — `src/sdk/SdkController.ts:317`**
  - **Introduced text:** `			if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 073 — `src/sdk/SdkController.ts:320`**
  - **Introduced text:** `						this.legacyState.deleteTaskDirectory(item.id)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 074 — `src/sdk/SdkController.ts:329`**
  - **Introduced text:** `			if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 075 — `src/sdk/SdkController.ts:332`**
  - **Introduced text:** `						this.legacyState.deleteTaskDirectory(id)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 076 — `src/sdk/SdkController.ts:349`**
  - **Introduced text:** `		if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 077 — `src/sdk/SdkController.ts:351`**
  - **Introduced text:** `				this.legacyState.saveApiConfiguration(config)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 078 — `src/sdk/SdkController.ts:362`**
  - **Introduced text:** `		if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 079 — `src/sdk/SdkController.ts:364`**
  - **Introduced text:** `				this.legacyState.saveMode(mode)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 080 — `src/sdk/SdkController.ts:377`**
  - **Introduced text:** `		if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 081 — `src/sdk/SdkController.ts:395`**
  - **Introduced text:** `					this.legacyState.saveApiConfiguration(apiConfigUpdates)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 082 — `src/sdk/SdkController.ts:508`**
  - **Introduced text:** `		if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 083 — `src/sdk/SdkController.ts:516`**
  - **Introduced text:** `					this.legacyState.saveUiMessages(taskId, messages)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 084 — `src/sdk/SdkController.ts:526`**
  - **Introduced text:** `		if (!this.legacyState) return`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 085 — `src/sdk/SdkController.ts:529`**
  - **Introduced text:** `			this.legacyState.saveTaskHistory(this.taskHistory)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 086 — `src/sdk/SdkController.ts:617`**
  - **Introduced text:** `		if (!this.legacyState) return undefined`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 087 — `src/sdk/SdkController.ts:618`**
  - **Introduced text:** `		const gs = this.legacyState.readGlobalState()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 088 — `src/sdk/SdkController.ts:627`**
  - **Introduced text:** `		if (!this.legacyState) return`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 089 — `src/sdk/SdkController.ts:629`**
  - **Introduced text:** `		const gsPath = path.join(this.legacyState.dataDir, "globalState.json")`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 090 — `src/sdk/SdkController.ts:683`**
  - **Introduced text:** `		if (!this.legacyState) return 0`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 091 — `src/sdk/SdkController.ts:684`**
  - **Introduced text:** `		const tasksDir = path.join(this.legacyState.dataDir, "tasks")`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 092 — `src/sdk/SdkController.ts:699`**
  - **Introduced text:** `			if (this.legacyState) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 093 — `src/sdk/SdkController.ts:701`**
  - **Introduced text:** `					messages = this.legacyState.readUiMessages(taskId)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 094 — `src/sdk/SdkController.ts:866`**
  - **Introduced text:** `		if (!this.legacyState) return []`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 095 — `src/sdk/SdkController.ts:869`**
  - **Introduced text:** `			const settings = this.legacyState.readMcpSettings()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

## `src/sdk/__tests__/extension-sdk-smoke.test.ts`

- [x] **Occurrence 096 — `src/sdk/__tests__/extension-sdk-smoke.test.ts:77`**
  - **Introduced text:** `	it("activates successfully with legacy data", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 097 — `src/sdk/__tests__/extension-sdk-smoke.test.ts:85`**
  - **Introduced text:** `		expect(ctx.legacyState).toBeDefined()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 098 — `src/sdk/__tests__/extension-sdk-smoke.test.ts:103`**
  - **Introduced text:** `	it("loads task history from legacy state", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 099 — `src/sdk/__tests__/extension-sdk-smoke.test.ts:253`**
  - **Introduced text:** `	it("activates without legacy data (fresh install)", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/__tests__/legacy-state-reader.test.ts`

- [x] **Occurrence 100 — `src/sdk/__tests__/legacy-state-reader.test.ts:5`**
  - **Introduced text:** `import { LegacyStateReader } from "../legacy-state-reader"`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 101 — `src/sdk/__tests__/legacy-state-reader.test.ts:35`**
  - **Introduced text:** `describe("LegacyStateReader", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 102 — `src/sdk/__tests__/legacy-state-reader.test.ts:37`**
  - **Introduced text:** `	let reader: LegacyStateReader`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 103 — `src/sdk/__tests__/legacy-state-reader.test.ts:41`**
  - **Introduced text:** `		reader = new LegacyStateReader({ dataDir })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 104 — `src/sdk/__tests__/legacy-state-reader.test.ts:344`**
  - **Introduced text:** `		it("merges legacy boolean flags with structured settings", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 105 — `src/sdk/__tests__/legacy-state-reader.test.ts:367`**
  - **Introduced text:** `			// Legacy booleans should override structured settings`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 106 — `src/sdk/__tests__/legacy-state-reader.test.ts:481`**
  - **Introduced text:** `			const customReader = new LegacyStateReader({ dataDir })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 107 — `src/sdk/__tests__/legacy-state-reader.test.ts:492`**
  - **Introduced text:** `			const customReader = new LegacyStateReader({ clineDir })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/__tests__/provider-migration.test.ts`

- [x] **Occurrence 108 — `src/sdk/__tests__/provider-migration.test.ts:44`**
  - **Introduced text:** `		it("migrates Anthropic key from legacy state to providers.json", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 109 — `src/sdk/__tests__/provider-migration.test.ts:140`**
  - **Introduced text:** `			// Legacy data for anthropic`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 110 — `src/sdk/__tests__/provider-migration.test.ts:161`**
  - **Introduced text:** `		it("returns no-legacy-data when no state files exist", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 111 — `src/sdk/__tests__/provider-migration.test.ts:165`**
  - **Introduced text:** `			expect(result.skipReason).toBe("no-legacy-data")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/__tests__/sdk-controller.test.ts`

- [x] **Occurrence 112 — `src/sdk/__tests__/sdk-controller.test.ts:36`**
  - **Introduced text:** `function createMockLegacyState() {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 113 — `src/sdk/__tests__/sdk-controller.test.ts:253`**
  - **Introduced text:** `		it("persists task to disk via legacyState", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 114 — `src/sdk/__tests__/sdk-controller.test.ts:254`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 115 — `src/sdk/__tests__/sdk-controller.test.ts:260`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 116 — `src/sdk/__tests__/sdk-controller.test.ts:265`**
  - **Introduced text:** `			expect(mockLegacyState.saveTaskHistory).toHaveBeenCalled()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 117 — `src/sdk/__tests__/sdk-controller.test.ts:266`**
  - **Introduced text:** `			expect(mockLegacyState.saveUiMessages).toHaveBeenCalled()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 118 — `src/sdk/__tests__/sdk-controller.test.ts:267`**
  - **Introduced text:** `			const savedHistory = mockLegacyState.saveTaskHistory.mock.calls[0][0]`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 119 — `src/sdk/__tests__/sdk-controller.test.ts:553`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 120 — `src/sdk/__tests__/sdk-controller.test.ts:559`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 121 — `src/sdk/__tests__/sdk-controller.test.ts:590`**
  - **Introduced text:** `			expect(mockLegacyState.saveTaskHistory).toHaveBeenCalled()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 122 — `src/sdk/__tests__/sdk-controller.test.ts:591`**
  - **Introduced text:** `			expect(mockLegacyState.saveUiMessages).toHaveBeenCalled()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 123 — `src/sdk/__tests__/sdk-controller.test.ts:646`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 124 — `src/sdk/__tests__/sdk-controller.test.ts:652`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 125 — `src/sdk/__tests__/sdk-controller.test.ts:659`**
  - **Introduced text:** `			expect(mockLegacyState.saveTaskHistory).toHaveBeenCalled()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 126 — `src/sdk/__tests__/sdk-controller.test.ts:670`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 127 — `src/sdk/__tests__/sdk-controller.test.ts:671`**
  - **Introduced text:** `			mockLegacyState.readUiMessages.mockReturnValue(savedMessages)`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 128 — `src/sdk/__tests__/sdk-controller.test.ts:677`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 129 — `src/sdk/__tests__/sdk-controller.test.ts:704`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 130 — `src/sdk/__tests__/sdk-controller.test.ts:705`**
  - **Introduced text:** `			mockLegacyState.readUiMessages.mockReturnValue([])`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 131 — `src/sdk/__tests__/sdk-controller.test.ts:711`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 132 — `src/sdk/__tests__/sdk-controller.test.ts:725`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 133 — `src/sdk/__tests__/sdk-controller.test.ts:730`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 134 — `src/sdk/__tests__/sdk-controller.test.ts:735`**
  - **Introduced text:** `			expect(mockLegacyState.deleteTaskDirectory).toHaveBeenCalledWith("del_a")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 135 — `src/sdk/__tests__/sdk-controller.test.ts:736`**
  - **Introduced text:** `			expect(mockLegacyState.deleteTaskDirectory).toHaveBeenCalledWith("del_c")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 136 — `src/sdk/__tests__/sdk-controller.test.ts:737`**
  - **Introduced text:** `			expect(mockLegacyState.deleteTaskDirectory).not.toHaveBeenCalledWith("del_b")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 137 — `src/sdk/__tests__/sdk-controller.test.ts:738`**
  - **Introduced text:** `			expect(mockLegacyState.saveTaskHistory).toHaveBeenCalled()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 138 — `src/sdk/__tests__/sdk-controller.test.ts:742`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 139 — `src/sdk/__tests__/sdk-controller.test.ts:747`**
  - **Introduced text:** `				legacyState: mockLegacyState as any,`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 140 — `src/sdk/__tests__/sdk-controller.test.ts:752`**
  - **Introduced text:** `			expect(mockLegacyState.deleteTaskDirectory).toHaveBeenCalledWith("all_a")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 141 — `src/sdk/__tests__/sdk-controller.test.ts:753`**
  - **Introduced text:** `			expect(mockLegacyState.deleteTaskDirectory).toHaveBeenCalledWith("all_b")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 142 — `src/sdk/__tests__/sdk-controller.test.ts:759`**
  - **Introduced text:** `		it("updateApiConfiguration calls legacyState.saveApiConfiguration", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 143 — `src/sdk/__tests__/sdk-controller.test.ts:760`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 144 — `src/sdk/__tests__/sdk-controller.test.ts:761`**
  - **Introduced text:** `			const ctrl = new SdkController({ legacyState: mockLegacyState as any })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 145 — `src/sdk/__tests__/sdk-controller.test.ts:764`**
  - **Introduced text:** `			expect(mockLegacyState.saveApiConfiguration).toHaveBeenCalledWith({ actModeApiProvider: "ollama" })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 146 — `src/sdk/__tests__/sdk-controller.test.ts:767`**
  - **Introduced text:** `		it("togglePlanActMode calls legacyState.saveMode", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 147 — `src/sdk/__tests__/sdk-controller.test.ts:768`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 148 — `src/sdk/__tests__/sdk-controller.test.ts:769`**
  - **Introduced text:** `			const ctrl = new SdkController({ legacyState: mockLegacyState as any })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 149 — `src/sdk/__tests__/sdk-controller.test.ts:772`**
  - **Introduced text:** `			expect(mockLegacyState.saveMode).toHaveBeenCalledWith("plan")`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 150 — `src/sdk/__tests__/sdk-controller.test.ts:775`**
  - **Introduced text:** `		it("does not throw when legacyState is not provided", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 151 — `src/sdk/__tests__/sdk-controller.test.ts:781`**
  - **Introduced text:** `		it("updateSettings persists to disk via legacyState", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 152 — `src/sdk/__tests__/sdk-controller.test.ts:782`**
  - **Introduced text:** `			const mockLegacyState = createMockLegacyState()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 153 — `src/sdk/__tests__/sdk-controller.test.ts:783`**
  - **Introduced text:** `			const ctrl = new SdkController({ legacyState: mockLegacyState as any })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 154 — `src/sdk/__tests__/sdk-controller.test.ts:787`**
  - **Introduced text:** `			expect(mockLegacyState.saveApiConfiguration).toHaveBeenCalledWith(`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 155 — `src/sdk/__tests__/sdk-controller.test.ts:792`**
  - **Introduced text:** `		it("updateSettings does not throw without legacyState", async () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/__tests__/state-builder.test.ts`

- [x] **Occurrence 156 — `src/sdk/__tests__/state-builder.test.ts:5`**
  - **Introduced text:** `import type { LegacyStateReader } from "../legacy-state-reader"`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 157 — `src/sdk/__tests__/state-builder.test.ts:12`**
  - **Introduced text:** `/** Create a minimal mock LegacyStateReader */`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 158 — `src/sdk/__tests__/state-builder.test.ts:13`**
  - **Introduced text:** `function mockLegacyState(globalState: Record<string, unknown> = {}): LegacyStateReader {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 159 — `src/sdk/__tests__/state-builder.test.ts:19`**
  - **Introduced text:** `	} as unknown as LegacyStateReader`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 160 — `src/sdk/__tests__/state-builder.test.ts:113`**
  - **Introduced text:** `	describe("with legacy state reader", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 161 — `src/sdk/__tests__/state-builder.test.ts:114`**
  - **Introduced text:** `		it("reads mode from legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 162 — `src/sdk/__tests__/state-builder.test.ts:116`**
  - **Introduced text:** `				legacyState: mockLegacyState({ mode: "plan" }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 163 — `src/sdk/__tests__/state-builder.test.ts:122`**
  - **Introduced text:** `		it("reads auto-approval settings from legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 164 — `src/sdk/__tests__/state-builder.test.ts:124`**
  - **Introduced text:** `				legacyState: mockLegacyState({`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 165 — `src/sdk/__tests__/state-builder.test.ts:148`**
  - **Introduced text:** `		it("reads task history from legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 166 — `src/sdk/__tests__/state-builder.test.ts:152`**
  - **Introduced text:** `				legacyState: mockLegacyState({ taskHistory: items }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 167 — `src/sdk/__tests__/state-builder.test.ts:161`**
  - **Introduced text:** `		it("reads telemetry setting from legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 168 — `src/sdk/__tests__/state-builder.test.ts:163`**
  - **Introduced text:** `				legacyState: mockLegacyState({ telemetrySetting: "enabled" }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 169 — `src/sdk/__tests__/state-builder.test.ts:169`**
  - **Introduced text:** `		it("reads isNewUser from legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 170 — `src/sdk/__tests__/state-builder.test.ts:171`**
  - **Introduced text:** `				legacyState: mockLegacyState({ isNewUser: false }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 171 — `src/sdk/__tests__/state-builder.test.ts:177`**
  - **Introduced text:** `		it("reads welcomeViewCompleted from legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 172 — `src/sdk/__tests__/state-builder.test.ts:179`**
  - **Introduced text:** `				legacyState: mockLegacyState({ welcomeViewCompleted: true }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 173 — `src/sdk/__tests__/state-builder.test.ts:247`**
  - **Introduced text:** `		it("prefers explicit taskHistory over legacy state", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 174 — `src/sdk/__tests__/state-builder.test.ts:249`**
  - **Introduced text:** `			const legacy = [makeHistoryItem({ ts: 2000, task: "Legacy" })]`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 175 — `src/sdk/__tests__/state-builder.test.ts:253`**
  - **Introduced text:** `				legacyState: mockLegacyState({ taskHistory: legacy }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 176 — `src/sdk/__tests__/state-builder.test.ts:275`**
  - **Introduced text:** `		it("falls back to legacy state apiConfiguration", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 177 — `src/sdk/__tests__/state-builder.test.ts:277`**
  - **Introduced text:** `				legacyState: mockLegacyState({`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 178 — `src/sdk/__tests__/state-builder.test.ts:332`**
  - **Introduced text:** `				legacyState: mockLegacyState({ mode: "plan" }),`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 179 — `src/sdk/__tests__/state-builder.test.ts:420`**
  - **Introduced text:** `	it("settings round-trip: legacy state → ExtensionState preserves values", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this test wording to match the final production terminology—usually `existing disk state`, `pre-SDK stored state`, or the eventual adapter name—while keeping explicit compatibility assertions where they are truly being tested.
  - **Assessment:** This occurrence is in test code. The implementation should update the test names, fixtures, and helper names alongside the production rename so the test suite describes the behavior precisely; where a test is specifically validating old-format migration, it should say that directly instead of relying on the blanket word `legacy`. That is appropriate because tests should document actual behavior, not preserve transitional branch vocabulary. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 180 — `src/sdk/__tests__/state-builder.test.ts:421`**
  - **Introduced text:** `		const legacy = mockLegacyState({`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 181 — `src/sdk/__tests__/state-builder.test.ts:443`**
  - **Introduced text:** `		const state = buildExtensionState({ legacyState: legacy })`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Update this test occurrence after the production naming and compatibility boundaries are cleaned up, so the test mirrors the final terminology instead of the eve-era `legacy` wording.
  - **Assessment:** This is a reflected test occurrence rather than an independent product decision. The implementation should change it in lockstep with the production symbol or wording it references, not as a standalone rename. That is appropriate because the test should follow the production design, not lead it. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/extension-sdk.ts`

- [x] **Occurrence 182 — `src/sdk/extension-sdk.ts:12`**
  - **Introduced text:** ` * 1. Reads legacy state from ~/.cline/data/`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 183 — `src/sdk/extension-sdk.ts:23`**
  - **Introduced text:** `import { LegacyStateReader } from "./legacy-state-reader"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 184 — `src/sdk/extension-sdk.ts:35`**
  - **Introduced text:** `	/** The legacy state reader */`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 185 — `src/sdk/extension-sdk.ts:36`**
  - **Introduced text:** `	legacyState: LegacyStateReader`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 186 — `src/sdk/extension-sdk.ts:77`**
  - **Introduced text:** `	// 1. Read legacy state`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 187 — `src/sdk/extension-sdk.ts:78`**
  - **Introduced text:** `	const legacyState = new LegacyStateReader({`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 188 — `src/sdk/extension-sdk.ts:87`**
  - **Introduced text:** `				dataDir: legacyState.dataDir,`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 189 — `src/sdk/extension-sdk.ts:98`**
  - **Introduced text:** `	// 3. Read task history from legacy state`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 190 — `src/sdk/extension-sdk.ts:99`**
  - **Introduced text:** `	const taskHistory = legacyState.readTaskHistory()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 191 — `src/sdk/extension-sdk.ts:106`**
  - **Introduced text:** `	const apiConfiguration = legacyState.buildApiConfiguration()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 192 — `src/sdk/extension-sdk.ts:107`**
  - **Introduced text:** `	const globalState = legacyState.readGlobalState()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 193 — `src/sdk/extension-sdk.ts:116`**
  - **Introduced text:** `		legacyState,`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 194 — `src/sdk/extension-sdk.ts:122`**
  - **Introduced text:** `		legacyState,`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/index.ts`

- [x] **Occurrence 195 — `src/sdk/index.ts:9`**
  - **Introduced text:** ` * - legacy-state-reader: Reads existing ~/.cline/data/ files`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 196 — `src/sdk/index.ts:19`**
  - **Introduced text:** `export { LegacyStateReader } from "./legacy-state-reader"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 197 — `src/sdk/index.ts:20`**
  - **Introduced text:** `export type { LegacyGlobalState, LegacySecrets, LegacyStateReaderOptions } from "./legacy-state-reader"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/legacy-state-reader.ts`

- [x] **Occurrence 198 — `src/sdk/legacy-state-reader.ts:2`**
  - **Introduced text:** ` * Legacy State Reader`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 199 — `src/sdk/legacy-state-reader.ts:36`**
  - **Introduced text:** `export interface LegacyGlobalState {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 200 — `src/sdk/legacy-state-reader.ts:54`**
  - **Introduced text:** `	// Auto-approval (legacy top-level booleans)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Keep the compatibility behavior if it is still needed, but replace `legacy` with a precise description of the old storage shape, location, or migration condition that is actually being handled.
  - **Assessment:** This occurrence is describing a real compatibility detail inside the SDK adapter layer. The implementation should not delete the behavior blindly; instead, it should rename the comment, enum value, or message so it refers to the exact old format or pre-SDK state condition in play. That is appropriate because the compatibility boundary may still be real, but the blanket `legacy` wording is more dramatic and less precise than necessary. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 201 — `src/sdk/legacy-state-reader.ts:69`**
  - **Introduced text:** `	// Task history (legacy location — may still be in globalState for old installs)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Keep the compatibility behavior if it is still needed, but replace `legacy` with a precise description of the old storage shape, location, or migration condition that is actually being handled.
  - **Assessment:** This occurrence is describing a real compatibility detail inside the SDK adapter layer. The implementation should not delete the behavior blindly; instead, it should rename the comment, enum value, or message so it refers to the exact old format or pre-SDK state condition in play. That is appropriate because the compatibility boundary may still be real, but the blanket `legacy` wording is more dramatic and less precise than necessary. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 202 — `src/sdk/legacy-state-reader.ts:83`**
  - **Introduced text:** `export type LegacySecrets = Partial<Record<SecretKey, string>>`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 203 — `src/sdk/legacy-state-reader.ts:110`**
  - **Introduced text:** `/** Options for constructing a LegacyStateReader. */`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 204 — `src/sdk/legacy-state-reader.ts:111`**
  - **Introduced text:** `export interface LegacyStateReaderOptions {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 205 — `src/sdk/legacy-state-reader.ts:122`**
  - **Introduced text:** `export class LegacyStateReader {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 206 — `src/sdk/legacy-state-reader.ts:125`**
  - **Introduced text:** `	constructor(opts: LegacyStateReaderOptions = {}) {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 207 — `src/sdk/legacy-state-reader.ts:139`**
  - **Introduced text:** `	readGlobalState(): LegacyGlobalState {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 208 — `src/sdk/legacy-state-reader.ts:140`**
  - **Introduced text:** `		return this.readJsonFile<LegacyGlobalState>(path.join(this.dataDir, "globalState.json")) ?? {}`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 209 — `src/sdk/legacy-state-reader.ts:148`**
  - **Introduced text:** `	readSecrets(): LegacySecrets {`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 210 — `src/sdk/legacy-state-reader.ts:149`**
  - **Introduced text:** `		return this.readJsonFile<LegacySecrets>(path.join(this.dataDir, "secrets.json")) ?? {}`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 211 — `src/sdk/legacy-state-reader.ts:159`**
  - **Introduced text:** `	 * legacy location inside globalState.json.`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Keep the compatibility behavior if it is still needed, but replace `legacy` with a precise description of the old storage shape, location, or migration condition that is actually being handled.
  - **Assessment:** This occurrence is describing a real compatibility detail inside the SDK adapter layer. The implementation should not delete the behavior blindly; instead, it should rename the comment, enum value, or message so it refers to the exact old format or pre-SDK state condition in play. That is appropriate because the compatibility boundary may still be real, but the blanket `legacy` wording is more dramatic and less precise than necessary. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 212 — `src/sdk/legacy-state-reader.ts:169`**
  - **Introduced text:** `		// Fallback: legacy location in globalState.json`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Keep the compatibility behavior if it is still needed, but replace `legacy` with a precise description of the old storage shape, location, or migration condition that is actually being handled.
  - **Assessment:** This occurrence is describing a real compatibility detail inside the SDK adapter layer. The implementation should not delete the behavior blindly; instead, it should rename the comment, enum value, or message so it refers to the exact old format or pre-SDK state condition in play. That is appropriate because the compatibility boundary may still be real, but the blanket `legacy` wording is more dramatic and less precise than necessary. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 213 — `src/sdk/legacy-state-reader.ts:239`**
  - **Introduced text:** `	 * legacy top-level boolean flags for backward compatibility.`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Keep the compatibility behavior if it is still needed, but replace `legacy` with a precise description of the old storage shape, location, or migration condition that is actually being handled.
  - **Assessment:** This occurrence is describing a real compatibility detail inside the SDK adapter layer. The implementation should not delete the behavior blindly; instead, it should rename the comment, enum value, or message so it refers to the exact old format or pre-SDK state condition in play. That is appropriate because the compatibility boundary may still be real, but the blanket `legacy` wording is more dramatic and less precise than necessary. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 214 — `src/sdk/legacy-state-reader.ts:260`**
  - **Introduced text:** `		// Legacy top-level booleans override structured settings`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Keep the compatibility behavior if it is still needed, but replace `legacy` with a precise description of the old storage shape, location, or migration condition that is actually being handled.
  - **Assessment:** This occurrence is describing a real compatibility detail inside the SDK adapter layer. The implementation should not delete the behavior blindly; instead, it should rename the comment, enum value, or message so it refers to the exact old format or pre-SDK state condition in play. That is appropriate because the compatibility boundary may still be real, but the blanket `legacy` wording is more dramatic and less precise than necessary. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 215 — `src/sdk/legacy-state-reader.ts:455`**
  - **Introduced text:** `			Logger.error(`[LegacyStateReader] Failed to delete task directory ${taskDir}:`, err)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 216 — `src/sdk/legacy-state-reader.ts:528`**
  - **Introduced text:** `			Logger.error(`[LegacyStateReader] Failed to write ${filePath}:`, err)`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

## `src/sdk/provider-migration.ts`

- [x] **Occurrence 217 — `src/sdk/provider-migration.ts:5`**
  - **Introduced text:** ` * `migrateLegacyProviderSettings()`) with:`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 218 — `src/sdk/provider-migration.ts:39`**
  - **Introduced text:** `	skipReason?: "sentinel" | "no-legacy-data" | "error"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 219 — `src/sdk/provider-migration.ts:73`**
  - **Introduced text:** ` * migrateLegacyProviderSettings() when it receives a dataDir.`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 220 — `src/sdk/provider-migration.ts:90`**
  - **Introduced text:** `		// Check if there's any legacy data to migrate`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 221 — `src/sdk/provider-migration.ts:96`**
  - **Introduced text:** `			return { ran: false, manager, skipReason: "no-legacy-data" }`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 222 — `src/sdk/provider-migration.ts:103`**
  - **Introduced text:** `		// The constructor auto-calls migrateLegacyProviderSettings() which`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** no
  - **Rubric result:** Keep the migration behavior, but narrow the terminology to the exact old provider-settings shape or pre-SDK state being migrated rather than using `legacy` as a blanket label.
  - **Assessment:** This occurrence is one of the few places where an actual old-to-new migration boundary exists. The implementation should preserve the migration and its tests, but rephrase names and comments toward `old provider settings`, `pre-SDK provider state`, or similar precise language. That is appropriate because the compatibility function is real, yet the broader `legacy` wording still adds unnecessary noise. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `src/sdk/state-builder.ts`

- [x] **Occurrence 223 — `src/sdk/state-builder.ts:5`**
  - **Introduced text:** ` * legacy settings, SDK session state, and current messages. This is`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 224 — `src/sdk/state-builder.ts:24`**
  - **Introduced text:** `import type { LegacyStateReader } from "./legacy-state-reader"`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 225 — `src/sdk/state-builder.ts:39`**
  - **Introduced text:** `	/** Legacy state reader for reading persisted settings */`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Tighten this SDK adapter wording so that it names the exact stored-state or migration concern rather than using a broad `legacy` label.
  - **Assessment:** This occurrence sits in active adapter code. The implementation should keep whatever compatibility behavior is still needed, but make the surrounding names and comments concrete about the storage or migration role they serve. That is appropriate because the adapter has become part of the current engine path, so vague `legacy` language now obscures design intent. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 226 — `src/sdk/state-builder.ts:40`**
  - **Introduced text:** `	legacyState?: LegacyStateReader`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 227 — `src/sdk/state-builder.ts:88`**
  - **Introduced text:** `	const legacyState = input.legacyState`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 228 — `src/sdk/state-builder.ts:89`**
  - **Introduced text:** `	const globalState = legacyState?.readGlobalState()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 229 — `src/sdk/state-builder.ts:91`**
  - **Introduced text:** `	const autoApprovalSettings: AutoApprovalSettings = legacyState?.readAutoApprovalSettings`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

- [x] **Occurrence 230 — `src/sdk/state-builder.ts:92`**
  - **Introduced text:** `		? legacyState.readAutoApprovalSettings()`
  - **Surface:** SDK adapter/runtime code
  - **dpc changed after eve:** yes
  - **Rubric result:** Rename this active SDK adapter vocabulary away from `legacy` and toward a neutral storage/compatibility adapter name, while preserving the runtime behavior that dpc has already built on top of it.
  - **Assessment:** This occurrence is part of the active SDK path, not dead code. The implementation should perform a forward rename of the class/type/property/export/variable to something like `DiskStateAdapter`, `StoredStateAdapter`, or another precise name, then keep truly old-format handling isolated to comments or helper names that specifically discuss old disk shapes. That is appropriate because the current `legacy` label understates how central this adapter has become and spreads transitional naming through the runtime. This file was changed again on `dpc/sdk-migration`, so the eventual cleanup must be applied as a forward edit on top of dpc's later work rather than by replaying the eve-era version.

## `webview-ui/src/components/settings/UseCustomPromptCheckbox.tsx`

- [x] **Occurrence 231 — `webview-ui/src/components/settings/UseCustomPromptCheckbox.tsx:31`**
  - **Introduced text:** `					Does not support Mcp and Legacy Focus Chain`
  - **Surface:** user-facing UI surface
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

## `webview-ui/src/components/settings/sections/FeatureSettingsSection.spec.tsx`

- [x] **Occurrence 232 — `webview-ui/src/components/settings/sections/FeatureSettingsSection.spec.tsx:79`**
  - **Introduced text:** `	it("does not render the legacy Focus Chain setting", () => {`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

- [x] **Occurrence 233 — `webview-ui/src/components/settings/sections/FeatureSettingsSection.spec.tsx:82`**
  - **Introduced text:** `		expect(screen.queryByText("Legacy Focus Chain")).toBeNull()`
  - **Surface:** test code
  - **dpc changed after eve:** no
  - **Rubric result:** Stop using `legacy` as the primary user-facing label for Focus Chain; either retire the stale surface or rewrite it to describe the real current status of Focus Chain without marketing it as a supported “legacy” feature.
  - **Assessment:** This occurrence is part of the Focus Chain product surface or nearby user-facing copy. The implementation should either remove the stale reference entirely or rewrite it so it names the actual state of the feature—hidden setting, compatibility-only behavior, or limited support—without the blanket `legacy` brand. That is appropriate because the current phrasing implies a user-facing product posture that no longer matches the branch's actual UI and runtime reality. This file appears unchanged since the eve branch introduced this wording, so it is a safe first-pass cleanup target once implementation begins.

