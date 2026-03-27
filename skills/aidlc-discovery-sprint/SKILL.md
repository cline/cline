---
name: aidlc-discovery-sprint
description: Run AIDLC-aligned DISCOVERY sprints for unfinished product UI work. Use when wireframes, prototype screens, or discovery artifacts must stay synchronized with aidlc-docs, each sprint should end with Playwright-based validation, and discovery findings may require updates to INCEPTION artifacts.
---

# AIDLC Discovery Sprint

## Overview

Use this skill to run DISCOVERY sprints that stay synchronized with AIDLC artifacts instead of drifting into ad hoc UI iteration.

This skill is for unfinished wireframes, screen-flow refinement, prototype validation, and sprint-by-sprint discovery work that must leave behind updated documentation, audit history, validation results, and clear follow-up actions.

## Start Here

Load these project artifacts first:

1. `aidlc-docs/aidlc-state.md`
2. `aidlc-docs/audit.md`
3. Relevant files under `aidlc-docs/discovery/`
4. Relevant INCEPTION artifacts under `aidlc-docs/inception/`

**⚠️ Mandatory: Screen-Interaction-Design Outputs**:
Before starting the sprint, check if these outputs exist in `aidlc-docs/discovery/screen-design/`:

- `screen-inventory.md` — Complete screen list with states
- `prototypes/*.html` — Self-contained HTML prototypes
- `interaction-flows/*.md` — Step-by-step interaction flows
- `screen-story-matrix.md` — Screen-to-story coverage mapping

**If these outputs do NOT exist**, you MUST invoke `$screen-interaction-design` skill first to generate them. The sprint cannot proceed without screen design artifacts.

**The sprint must use these outputs** to validate UI implementation and identify gaps.

**Exception**: If the project has no frontend/app screens (e.g., backend-only API, CLI tool, library), skip this requirement and proceed with standard sprint without screen design artifacts.

Then read the references in this order:

1. `references/aidlc-integration.md`
2. `references/discovery-sprint-loop.md`
3. `references/helper-skills.md`
4. `references/artifact-contracts.md`
5. `references/inception-feedback.md`

## When To Use This Skill

**Prerequisite**: Screen-Interaction-Design outputs must exist before running this sprint (unless project has no frontend screens).

Use this skill when any of the following are true:

- Wireframe work is incomplete but implementation has already started
- DISCOVERY documents and actual UI state disagree
- A sprint needs structured screen review, state review, or flow review
- The team wants a repeatable sprint loop with audit logging and review artifacts
- Discovery findings may require updates to requirements, stories, or application design

**If screen-interaction-design outputs do not exist**, invoke `$screen-interaction-design` skill FIRST to generate screen design artifacts, then run this sprint.

**Exception**: If the project has no frontend/app screens (backend-only API, CLI tool, library), skip screen-interaction-design requirement and proceed with standard sprint.

Do not use this skill as the primary workflow for full feature implementation or deployment.

## Core Workflow

1. Resume the current AIDLC and DISCOVERY state.
2. **⚠️ Check for `screen-interaction-design` outputs** in `aidlc-docs/discovery/screen-design/`:
   - If outputs exist: Load `screen-inventory.md`, `interaction-flows/*.md`, `screen-story-matrix.md`, and use prototypes as reference
   - If outputs do NOT exist:
     - **If project has frontend screens**: Invoke `$screen-interaction-design` skill FIRST, then continue
     - **If project has NO frontend screens** (backend-only, CLI, library): Skip screen design, proceed with standard sprint
3. Determine the sprint mode: `sprint-0`, `refinement`, or `validation`.
4. Define sprint scope, target screens, and target user flows.
5. Use helper skills to inspect the current UI and capture evidence.
6. Compare UI implementation against screen-interaction-design outputs to identify gaps.
7. Update DISCOVERY artifacts.
8. Run Playwright validation when the UI is runnable, or record the blocker.
9. Produce the next sprint backlog.
10. Hand reusable lessons to `$meta-knowledge` when the sprint exposes repeatable process improvements.
11. Feed requirement or design gaps back into INCEPTION artifacts when needed.

Discovery work should also make persistence assumptions explicit. For each target screen or flow, record whether it is `demo/mock`, `api-backed mock`, or `live`, what the source of truth is, and what UI contract must survive a future adapter replacement.

Follow the detailed loop in `references/discovery-sprint-loop.md`.

## Helper Skills

This skill coordinates baseline helper skills instead of replacing them.

- Use `skill-installer` if a required helper skill is missing.
- Use `playwright-interactive` for exploratory browser review.
- Use `screenshot` for baseline and review captures.
- Use `playwright` for sprint-end validation.
- Use `figma` only when Figma is the active design source of truth.
- Use `figma-implement-design` only after a discovery decision is approved for implementation follow-up.
- Use `screen-interaction-design` when the sprint needs HTML prototypes, screen specifications, or interaction flow documents. This is optional — invoke only when the sprint scope includes screen design work.

See `references/helper-skills.md` for stage-by-stage mapping.

## Scripts And Templates

Use bundled scripts when they reduce repeated editing work:

- `scripts/append_audit_entry.py`
- `scripts/summarize_playwright_results.py`
- `scripts/scaffold_discovery_sprint.py`

Use templates from `assets/templates/` when creating new sprint artifacts.

## Continuous Improvement Handoff

When a sprint produces reusable process lessons, call `$meta-knowledge` with:

- the sprint review
- the relevant audit slice
- the Playwright summary
- the next sprint backlog
- the suspected skill or rule pain points

Do this when the lesson should improve future sprints, not just close the current one.

## Completion Gates

Do not mark a DISCOVERY sprint complete until all applicable items are handled:

- Audit log updated
- **Screen-interaction-design outputs checked** (screen-inventory, interaction-flows, screen-story-matrix)
- Relevant DISCOVERY artifacts updated
- Visual or browser evidence captured
- Playwright validation run or explicitly blocked
- **Coverage metrics recorded**:
  - Implementation Coverage: X/Y states (Z%) — screen-inventory.md 대비
  - Validation Coverage: N/M GAPs verified — Playwright/코드 검증
- persistence boundary status recorded for target screens when data is adapter-swappable
- Next sprint backlog written
- INCEPTION feedback assessed

## Notes

- When the repository claims DISCOVERY is complete but placeholder screens or unresolved states remain, trust the actual evidence and update the artifacts accordingly.
- When discovery uncovers missing requirements, update or propose updates to INCEPTION artifacts before treating the issue as solved.

## Sprint Completion Proposal

**After completing a sprint**, the skill must:

1. **Summarize results**:
   - What changed
   - Implementation Coverage: X/Y states (Z%)
   - Validation Coverage: N/M GAPs verified

2. **Propose next action** (two options):

   **Option A - Continue to Next Sprint**: If uncovered gaps remain or new requirements discovered
   - List remaining backlog items
   - Propose next sprint focus
   - Ask user: "다음 sprint를 진행할까요?"

   **Option B - End Discovery Loop**: If all defined GAPs implemented and no new gaps found
   - Confirm discovery is complete for current scope
   - Summarize what was achieved
   - Ask user: "Discovery를 종료하고 CONSTRUCTION으로 진행할까요?"

3. **Wait for user confirmation** before proceeding to next sprint or closing the loop.
