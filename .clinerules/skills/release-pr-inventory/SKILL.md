---
name: release-pr-inventory
description: Collect and classify merged PRs for release-window changelog generation
---

# release-pr-inventory

Use this skill to build a deterministic PR inventory for a release window.

## Input Contract

Required:

- `fromTag` (for example `v3.20.1`)

Optional:

- `toRef` (default `main`)
- `mode` (`current` or `test`)

## Responsibilities

1. Resolve and validate the range (`fromTag..toRef`).
2. Discover merged PR candidates in that range.
3. Fetch robust PR metadata and changed-file coverage.
4. Classify each PR as `vscode`, `cli`, `both`, or `exclude`.
5. Produce a complete coverage report with explicit rationale.

## Required Deterministic Behavior

### A) Range resolution

1. Resolve `toRef=main` when omitted.
2. Validate both refs:
   - `git rev-parse --verify --quiet <fromTag>^{}`
   - `git rev-parse --verify --quiet <toRef>^{}`
3. Use range: `<fromTag>..<toRef>`.

### B) PR candidate discovery

Build union set of PR numbers from both sources:

1. First-parent subjects:
   - `git log --first-parent --pretty=%s <fromTag>..<toRef>`
   - extract `#<number>` patterns
2. Commit-to-PR association lookups for commits in same range:
   - `GET /repos/<owner>/<name>/commits/<sha>/pulls`

Deduplicate and sort numerically.

### C) Metadata retrieval and robustness

Fetch PR metadata via `gh api graphql` in batches.

Required fields per PR:

- number
- title
- url
- mergedAt
- author.login
- labels
- files (full list, paginated when necessary)

Rules:

- Never treat stderr noise as fatal when stdout has valid JSON data.
- If a paginated file list cannot be fully loaded, mark PR file coverage as incomplete.
- Keep processing other PRs on partial failures and surface errors in output.

### D) Scope classification

Classify each PR with one scope and one reason:

- `cli`: only `cli/**`
- `both`: mix of `cli/**` and non-`cli/**`
- `vscode`: non-`cli/**` only
- `exclude`: all changed files are internal-only

Internal-only paths include at minimum:

- `.github/**`
- `docs/**`
- `evals/**`
- `scripts/**`
- `tests/**`, `test/**`
- `.changeset/**`
- `.clinerules/workflows/**`

If file coverage is incomplete, classify as `unclassified` with reason `incomplete-file-list`.

### E) Inclusion mapping

Derive inclusion by target scope:

- VSCode changelog includes `vscode + both`
- CLI changelog includes `cli + both`
- `exclude` is always excluded

### F) Coverage accounting (required)

Every PR must appear exactly once in final coverage table with:

- `classification` (`vscode|cli|both|exclude|unclassified`)
- `status` (`included|excluded|unclassified`) for each target scope
- `reason` (required for excluded/unclassified)

Do not allow silent drops.

## Contributor Attribution Inputs

For each included PR, compute contributor membership hint:

- `internal`
- `external`
- `unknown`

If org membership lookup fails, keep `unknown` and do not assert external attribution.

Also compute best-effort first-time contributors list from included PRs.

## Output Contract

Return structured inventory suitable for downstream writer skill. Include:

1. `range`:
   - `fromTag`
   - `toRef`
2. `repository` (`owner/name`)
3. `prs[]` with metadata + files + classification + reason
4. `coverage` summary:
   - total
   - included_vscode
   - included_cli
   - excluded
   - unclassified
5. `byScope` lists:
   - `vscode[]`
   - `cli[]`
   - `both[]`
   - `exclude[]`
6. `firstTimeContributors[]`
7. `attributionConfidence` details

## Failure / Halt Conditions

- If refs are invalid, fail with explicit corrective message.
- If `unclassified > 0`, halt by default and ask for explicit best-effort override before proceeding.

## Communication Requirements

Before handing off to writer skill, provide:

1. Range summary (`fromTag..toRef`, mode)
2. Coverage counts (included/excluded/unclassified)
3. Explicit list of excluded and unclassified PRs with reasons
