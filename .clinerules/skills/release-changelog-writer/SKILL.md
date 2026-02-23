---
name: release-changelog-writer
description: Generate style-consistent release entries and apply them to extension + CLI changelog files
---

# release-changelog-writer

Use this skill to convert a classified PR inventory into finalized changelog updates for both targets:

- `CHANGELOG.md`
- `cli/CHANGELOG.md`

## Input Contract

Required:

- `version` (header label without assumptions, e.g. `3.24.0`)
- `inventory` (output from `release-pr-inventory`)

Optional:

- `targets` (default both changelog files)

## Responsibilities

1. Read and anchor each target file’s existing style and section conventions.
2. Build scoped entry sets from inventory (`vscode+both` for extension, `cli+both` for CLI).
3. Synthesize user-facing prose from semantic PR understanding (description + code-change evidence), not raw title dumping.
4. Apply updates safely at top release position, preserving existing history.
5. Verify structure, coverage mapping, confidence signals, and no-op behavior.

## Style Anchoring Requirements

For each target:

1. Read the current top release blocks to infer:
   - heading style
   - section heading depth
   - bullet tone and punctuation
2. Match repository conventions while keeping output concise and human-focused.
3. Prefer meaningful product language over implementation/internal details.

## Required Output Structure (Per Target)

Inserted release block must satisfy:

1. First line:
   - `## [<version>]`
2. Section order (if present):
   - `Added`
   - `Fixed`
   - `Changed`
   - `New Contributors`
3. Omit empty sections.
4. No code fences and no analysis commentary inside changelog text.

## Scope Filtering Rules

Using inventory classifications:

- Extension target includes PRs classified `vscode` and `both`
- CLI target includes PRs classified `cli` and `both`
- Excluded PRs never become changelog bullets
- Unclassified PRs never become auto-generated changelog bullets

If a target has zero includable PRs, do not modify that file and report explicit no-op.

## Bullet Authoring Rules

1. Bullets must be end-user facing and clear.
2. Remove internal-only noise, refactor jargon, and implementation trivia.
3. Group concepts logically under section semantics:
   - `Added` for new capabilities
   - `Fixed` for bug fixes
   - `Changed` for behavior/UX updates
4. Do not include PR numbers or links in final bullets.

## Semantic Synthesis Rules (required)

Use inventory semantic fields (`intent`, `userImpact`, `changeIntentSummary`, `evidence`, `semanticConfidence`) as primary input.

1. Cluster included PRs by user-facing theme (for example: model/provider support, auth, tool reliability, UX/settings, platform compatibility).
2. Build bullets from cluster intent + evidence, not from mechanical title concatenation.
3. Prefer specificity over vague umbrella summaries when metadata confidence is sufficient.
4. For low-confidence PRs, avoid over-claiming; keep wording conservative and surface confidence note in summary output.

### Detail-density guardrail

Avoid over-compression. Minimum bullet guidance by included PR count per target:

- 1-10 PRs: typically 3-8 bullets
- 11-40 PRs: typically 6-14 bullets
- 41-100 PRs: typically 10-20 bullets
- >100 PRs: typically 14-28 bullets

These are guardrails, not rigid limits. If writing fewer bullets, explain why in verification summary.

## External Contributor Attribution

When included PR author status is `external`, append:

- `(Thanks @<username>!)`

When status is `unknown`, do not guess and do not add thanks automatically.

## New Contributors Section

When available from inventory, use format:

- `- @<login> made their first contribution.`

Only include `New Contributors` if at least one entry exists.

## Apply Semantics

1. Insert new block at top release position in each target.
2. Preserve all existing history below the inserted block.
3. Avoid malformed duplicates when rerunning on same version.
4. Keep edits limited to intended changelog files.

## Verification Requirements

Before returning success, verify:

1. Header exists and matches `## [<version>]`.
2. Section order is valid.
3. No empty sections were inserted.
4. Every included PR is represented in generated bullets or explicitly called out in summary accounting.
   - maintain an internal mapping: `pr_number -> bullet_cluster_id | excluded_reason`
5. Files report as:
   - `updated` when content inserted
   - `no-op` when no includable PRs
6. Unclassified PR visibility:
   - explicitly list unclassified PRs excluded from auto-generated bullets
   - include reason per unclassified PR (for example `incomplete-file-list`, `missing-pr`, `no-files`)
   - add guidance that user can choose manual inclusion in a follow-up edit
7. Confidence visibility:
   - report low-confidence cluster count
   - report metadata completeness uncertainty carried from inventory

## Output Contract

Return concise machine- and human-readable summary:

1. `version`
2. per-target status (`updated|no-op`)
3. included/excluded counts per target
4. unresolved attribution or coverage uncertainties
5. unclassified PR list with reasons, and explicit note they were intentionally excluded pending user decision
6. quick review commands:
   - `git --no-pager diff -- CHANGELOG.md`
   - `git --no-pager diff -- cli/CHANGELOG.md`
7. synthesis quality notes:
   - bullet density vs included PR volume (per target)
   - low-confidence clusters requiring optional human review
