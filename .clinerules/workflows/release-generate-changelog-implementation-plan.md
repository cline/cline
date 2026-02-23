# Release Changelog Workflow (Workflow + Skills) — Implementation Plan

This document defines how to implement a **simple, release-focused changelog workflow** using only:

- a workflow (`.clinerules/workflows/release-generate-changelog.md`)
- skills (`.clinerules/skills/*/SKILL.md`)

No additional script files, and no rule changes required.

---

## 1) Project Goal

Build a human-friendly release workflow that:

1. Asks the user to pick one of two modes up front:
   - **Current release mode**: changelog content from latest release tag → `main`
   - **Recent-historic test mode**: changelog content from an automatically selected trailing tag (~10 releases behind) → `main`
2. Automatically gathers PRs in the selected release window
3. Classifies PRs into VSCode, CLI, both, or excluded
4. Generates changelog entries consistent with existing style in:
   - `CHANGELOG.md`
   - `cli/CHANGELOG.md`
5. Automatically updates both files on disk in either mode (while preserving reviewability)

---

## 2) Non-Goals / Simplifications

- Do **not** support arbitrary diff ranges beyond tag-based release windows (except optional explicit tag override for debugging/developer use).
- Do **not** add new scripts under `scripts/`.
- Do **not** add new project/global rules for this feature.
- Do **not** optimize for fully unattended publishing; this is release-assistant automation with human oversight.

---

## 3) Target Architecture

### Workflow (orchestrator)

- File: `.clinerules/workflows/release-generate-changelog.md`
- Responsibilities:
  - discover current + suggested test tag
  - present exactly two mode choices
  - delegate heavy logic to skills
  - ensure both changelog files are updated
  - show verification summary + review pointers

### Skill A (inventory + classification)

- File: `.clinerules/skills/release-pr-inventory/SKILL.md`
- Responsibilities:
  - resolve selected release window (`fromTag..main`)
  - collect merged PRs in window using `git + gh`
  - classify PR scope (`vscode|cli|both|exclude`)
  - produce a coverage table with deterministic inclusion/exclusion rationale

### Skill B (style-aware synthesis + apply)

- File: `.clinerules/skills/release-changelog-writer/SKILL.md`
- Responsibilities:
  - inspect current style in `CHANGELOG.md` and `cli/CHANGELOG.md`
  - synthesize release entries by scope in existing style/section order
  - apply both updates to disk safely
  - verify output format and coverage mapping

---

## 4) Detailed Workflow Markdown Changes

## 4.1 Replace script-oriented sections with skill-oriented orchestration

- [ ] Remove script dependency language (`node scripts/release/changelog-inventory.mjs`)
- [ ] Add explicit `use_skill` handoff points:
  - [ ] `release-pr-inventory`
  - [ ] `release-changelog-writer`
- [ ] Keep workflow concise; move implementation detail into skills

## 4.2 Add two-mode startup UX (single user click)

- [ ] Add preflight tag discovery step:
  - [ ] fetch/validate semver tags
  - [ ] determine `CURRENT_TAG` (latest)
  - [ ] determine `TEST_TAG` (approximately 10 tags behind, clamped to available history)
- [ ] Add single ask with exactly two options:
  - [ ] `Generate for current release (<CURRENT_TAG>..main)`
  - [ ] `Generate for test release (<TEST_TAG>..main)`
- [ ] Ensure no manual tag entry is required in normal flow

## 4.3 Define deterministic test-tag heuristic

- [ ] Document algorithm:
  - [ ] `tags = git tag --list 'v[0-9]*' --sort=-version:refname`
  - [ ] `CURRENT_TAG = tags[0]`
  - [ ] `TEST_TAG = tags[min(10, len(tags)-1)]`
  - [ ] fallback to nearest non-current tag if history is short
  - [ ] if no non-current tag exists, fallback to current mode only

## 4.4 Ensure both changelog targets are always processed

- [ ] Explicitly require update attempts for both:
  - [ ] `CHANGELOG.md`
  - [ ] `cli/CHANGELOG.md`
- [ ] Scope behavior:
  - [ ] if scope has no includable PRs, keep file unchanged and report no-op

## 4.5 Keep human-readable review output

- [ ] Require concise final summary:
  - [ ] chosen mode + tag range
  - [ ] included/excluded PR counts by scope
  - [ ] files updated/no-op
  - [ ] review command(s)

---

## 5) Detailed Skill Markdown Changes

## 5.1 Add Skill A: `release-pr-inventory`

- [ ] Create directory: `.clinerules/skills/release-pr-inventory/`
- [ ] Add `SKILL.md` with frontmatter:
  - [ ] `name: release-pr-inventory`
  - [ ] `description: Collect and classify merged PRs for release-window changelog generation`

### Skill A behavior requirements

- [ ] Input contract:
  - [ ] `fromTag`
  - [ ] `toRef` (default `main`)
  - [ ] optional mode label (`current|test`)
- [ ] Data collection:
  - [ ] merged PR candidate collection from release window
  - [ ] robust PR metadata retrieval via `gh`
  - [ ] tolerate partial fetch failures with explicit reporting
- [ ] Classification contract (deterministic):
  - [ ] `cli` if only `cli/**`
  - [ ] `both` if mixed `cli/**` + non-cli
  - [ ] `vscode` if non-cli only
  - [ ] `exclude` for internal-only changes
- [ ] Output contract:
  - [ ] structured inventory table
  - [ ] coverage summary (`included|excluded|unclassified`)
  - [ ] explicit list of PRs per scope

## 5.2 Add Skill B: `release-changelog-writer`

- [ ] Create directory: `.clinerules/skills/release-changelog-writer/`
- [ ] Add `SKILL.md` with frontmatter:
  - [ ] `name: release-changelog-writer`
  - [ ] `description: Generate style-consistent release entries and apply them to extension + CLI changelog files`

### Skill B behavior requirements

- [ ] Input contract:
  - [ ] release version label
  - [ ] scope-filtered PR inventory from Skill A
  - [ ] target files (`CHANGELOG.md`, `cli/CHANGELOG.md`)
- [ ] Style anchoring:
  - [ ] read top recent release sections from each changelog file
  - [ ] match heading depth and section naming conventions
  - [ ] keep prose concise and user-facing
- [ ] Required output structure per file:
  - [ ] release header `## [<version>]` (or file-consistent equivalent)
  - [ ] section order `Added`, `Fixed`, `Changed`, `New Contributors`
  - [ ] omit empty sections
  - [ ] no code fences / no analysis text
- [ ] Apply semantics:
  - [ ] insert at top release position
  - [ ] preserve existing history
  - [ ] update both files automatically when content exists
  - [ ] produce explicit no-op summary when scope has no includable PRs
- [ ] Verification semantics:
  - [ ] every included PR represented in bullets or explicitly accounted for
  - [ ] report any unresolved classification or attribution uncertainty

---

## 6) Implementation Execution Plan (Development Checklist)

## Phase A — Foundation

- [ ] Confirm final file paths:
  - [ ] workflow file (existing): `.clinerules/workflows/release-generate-changelog.md`
  - [ ] new skills directories under `.clinerules/skills/`
- [ ] Capture current workflow file as backup snapshot for easy comparison

## Phase B — Workflow rewrite

- [ ] Rewrite workflow intro around workflow+skills architecture
- [ ] Implement two-option startup question with discovered tags
- [ ] Add deterministic test-tag recommendation logic text
- [ ] Add skill invocation order and handoff data contracts
- [ ] Remove references to script-based inventory pipeline

## Phase C — Skill authoring

- [ ] Author `release-pr-inventory` skill
- [ ] Author `release-changelog-writer` skill
- [ ] Ensure both skills are narrow and composable
- [ ] Ensure the workflow remains the sole orchestrator

## Phase D — Integration pass

- [ ] Verify workflow instructions reference exact skill names
- [ ] Verify skills do not conflict in ownership/responsibilities
- [ ] Verify workflow guarantees updates for both changelog files in both modes

## Phase E — Dry-run validation in branch

- [ ] Run workflow in **current release mode** (latest tag)
- [ ] Run workflow in **recent-historic test mode** (auto-selected trailing tag)
- [ ] Confirm only one user decision click is needed up front in each run
- [ ] Confirm changelog files are updated on disk in both runs

## Phase F — QA cleanup + finalization

- [ ] Refine wording for clarity and maintainability
- [ ] Remove redundant complexity from skill instructions
- [ ] Final review for consistency with release process expectations

---

## 7) Testing & Verification Procedure

## 7.1 Functional test matrix

- [ ] **Mode selection UX**
  - [ ] workflow presents exactly two options (current vs auto-test)
  - [ ] auto-test option includes concrete proposed tag
- [ ] **Tag resolution**
  - [ ] latest tag resolution works with healthy tag history
  - [ ] trailing test tag heuristic picks ~10 behind when available
  - [ ] short tag history fallback works without failure
- [ ] **Inventory/classification**
  - [ ] merged PRs gathered for selected range
  - [ ] each PR gets exactly one classification
  - [ ] excluded/internal PRs have explicit reasons
- [ ] **Synthesis/application**
  - [ ] both changelog files updated automatically (or explicit no-op)
  - [ ] inserted release sections match existing style and ordering
  - [ ] no malformed section headers / no code fences

## 7.2 Content quality checks

- [ ] Bullets are user-facing and concise
- [ ] No obvious internal-only noise leaks into user changelog
- [ ] VSCode and CLI entries are properly scoped
- [ ] New Contributors section format is consistent with file conventions

## 7.3 Safety and regression checks

- [ ] Existing changelog history is preserved
- [ ] Re-running workflow on same range does not corrupt file structure
- [ ] Failures in PR metadata retrieval are surfaced clearly (not silently ignored)
- [ ] Final summary clearly states what changed and where

---

## 8) Suggested Acceptance Criteria (Definition of Done)

- [ ] Workflow uses only workflow + skills (no script dependency, no new rules)
- [ ] Single up-front choice between current and auto-selected test mode
- [ ] Auto-selected test mode uses a valid trailing release tag (~10 behind)
- [ ] Both `CHANGELOG.md` and `cli/CHANGELOG.md` are automatically updated on disk in both modes (or explicit no-op if no includable PRs)
- [ ] Generated sections are style-consistent with existing changelog content
- [ ] Manual validation checklist passes for at least one current-mode and one test-mode run

---

## 9) Notes for Incremental Delivery

- [ ] Land workflow rewrite + empty skill scaffolds first
- [ ] Land Skill A next and validate inventory/classification independently
- [ ] Land Skill B next and validate synthesis/apply independently
- [ ] Run full end-to-end tests only after both skills are stable
