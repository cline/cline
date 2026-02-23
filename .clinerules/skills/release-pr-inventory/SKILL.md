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
3. Fetch robust PR metadata, semantic context, and changed-file coverage.
4. Derive deterministic per-PR semantic understanding from description + code changes.
5. Classify each PR as `vscode`, `cli`, `both`, or `exclude`.
6. Produce a complete coverage report with explicit rationale and confidence signals.

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
- body
- url
- mergedAt
- author.login
- authorAssociation
- labels
- additions
- deletions
- changedFiles
- commits (messages/headline)
- files (full list, paginated when necessary)

Preferred retrieval order:

1. GraphQL batch query for primary fields
2. If any primary field is missing (`title`, `body`, `files`, author metadata), retry per-PR via REST:
   - `GET /repos/<owner>/<name>/pulls/<number>`
   - `GET /repos/<owner>/<name>/pulls/<number>/files`

Metadata completeness gate:

- Compute missing-metadata rate for `title` and `body` across candidate PRs.
- If missing rate exceeds 10%, run fallback REST fetch for all affected PRs before finalizing output.
- If still above threshold, continue but set inventory-level uncertainty flags and explicitly report the gap.

Rules:

- Never treat stderr noise as fatal when stdout has valid JSON data.
- If a paginated file list cannot be fully loaded, mark PR file coverage as incomplete.
- Keep processing other PRs on partial failures and surface errors in output.

### C.1) Semantic extraction (required)

For each PR, derive deterministic semantic fields using title + body + key changed files (+ optional diff cues):

- `intent`: `added|fixed|changed|internal|unclear`
- `userImpact`: `high|medium|low`
- `changeIntentSummary`: concise 1-2 sentence user-facing summary
- `evidence`:
  - `keyFiles` (bounded list of representative files)
  - `signals` (short bullet clues from labels/body/commit messages)

Rules:

- Prefer user-facing interpretation over implementation detail.
- If semantic confidence is low due to sparse metadata, set `intent=unclear`, keep conservative summary text, and mark confidence accordingly.

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

Additionally, include per-PR:

- `semanticConfidence` (`high|medium|low`)
- `metadataCompleteness` (`complete|partial|minimal`)

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
   - include semantic fields: `intent`, `userImpact`, `changeIntentSummary`, `evidence`, `semanticConfidence`, `metadataCompleteness`
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
8. `quality` summary:
   - title/body completeness rate
   - count of PRs using fallback REST enrichment
   - low-confidence semantic PR count
   - whether metadata completeness gate passed

## Failure / Halt Conditions

- If refs are invalid, fail with explicit corrective message.
- Do not halt solely because `unclassified > 0`; continue and pass forward explicit unclassified accounting.
- Treat unclassified PRs as excluded from automatic changelog synthesis until the user decides on manual inclusion.

## Communication Requirements

Before handing off to writer skill, provide:

1. Range summary (`fromTag..toRef`, mode)
2. Coverage counts (included/excluded/unclassified)
3. Explicit list of excluded and unclassified PRs with reasons
4. Explicit note that unclassified PRs were intentionally not auto-included and may be manually added by user decision
5. Metadata/semantic quality summary (completeness %, low-confidence count, any fallback usage)
