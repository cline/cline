You are in the `cline/` repo. Your goal is to generate and **apply** high-quality changelog updates for both the VSCode extension and the CLI in one run, leaving file changes uncommitted for human review.

This is a **Cline workflow**. Execute required steps yourself using tools; do not ask the release commander to manually run shell commands.

You have access to `git`, `gh`, and `jq`. Assume `gh` is already authenticated.

You may also use:

- `node scripts/release/changelog-inventory.mjs` (preferred inventory pipeline)

<detailed_sequence_of_steps>

# Release Changelog Generation Workflow (LLM-Prose Apply)

## Inputs you must ask the user for
Default to **single-action mode** and only ask for missing release version details when needed.

Preferred defaults:

- `from=latest` (latest `vX.Y.Z` tag)
- `to=now` (maps to `main`)
- apply both scopes in one run

Collect as little as possible:

1. Release version to write in changelog headers:
   - normally ask for one `version` used for both files, or
   - optional split versions: `vscode-version` and `cli-version`
2. Optional range overrides only if user requests them:
   - `from=<tag|ref>`
   - `to=<tag|ref>`

If user does not provide range, do **not** ask follow-ups; use defaults (`latest..main`).

Do not ask the user to provide execution details (batch size, output dir, etc.) unless explicitly requested.

## Output Target Selection

In default one-action mode, update both files in one invocation:

- `CHANGELOG.md` (VSCode extension)
- `cli/CHANGELOG.md` (CLI)

Leave both updates uncommitted for human review.

## 0) Preflight

1. Ensure tags exist (handle shallow clones):
   ```bash
   git tag --list 'v[0-9]*' --sort=-version:refname | head -5
   ```
   If that prints nothing (or looks incomplete), run:
   ```bash
   git fetch --tags
   ```

2. Resolve refs:
   ```bash
   git rev-parse --verify --quiet <from>^{} && git rev-parse --verify --quiet <to>^{}
   ```

3. Resolve effective bounds:

- `from=latest` => latest `vX.Y.Z` tag
- `to=now` => `main`

4. Resolve release version for output header:

- If the user gives an explicit target version, use it.
- Otherwise infer from `to` (if tag-like), else ask user.

Required final header for both outputs:

`## [<version>]`

## 1) Collect PR number candidates from git history

Use a union of:

1. first-parent merge commit subjects
2. commit-to-PR association lookups for commits in the same range (`/commits/<sha>/pulls`)

First-parent subject extraction:

```bash
git log --first-parent --pretty=%s <from>..<to> |
  grep -Eo '#[0-9]+' |
  tr -d '#' |
  sort -un
```

Save the union (newline-separated) as `ALL_PR_NUMBERS`.

## 1.5) Preferred execution path (internal)

Use the inventory pipeline internally in one action to prepare artifacts for both scopes:

```bash
node scripts/release/changelog-inventory.mjs \
  --both \
  --from latest \
  --to now \
  --output-dir /Users/evekillaby/dev/tmp/.cline-artifacts/release-generate-changelog
```

Notes:

- `--from latest` and `--to now` are defaults; they may be omitted.
- This script is inventory/classification only; release version is resolved in the LLM synthesis/apply step.

If you need best-effort behavior when some PR file lists cannot be fully loaded, add:

```bash
--allow-incomplete-classification
```

This generates:

- `pr-inventory.json`
- `scope-classification.json`
- `candidate-bullets.md`
- `merged-pr-lines.md`

Important: this script does **not** update changelog files. It only produces artifacts.

In this workflow, you should run this internally; do not instruct the release commander to execute it manually.

If this script is unavailable, continue with manual commands below.

## 2) Fetch PR metadata from GitHub (robust to partial errors)

Key rule: **Never mix stderr into stdout JSON.** GitHub/gh may emit error messages to stderr while still returning valid JSON on stdout.

1. Query PRs in batches (e.g. 100 per chunk).
2. Use `gh api graphql ... 2>/dev/null || true`.
3. Treat the response as valid if `jq -e '.data.repository'` succeeds.
4. Drop null PRs with `select(.value != null)`.

Output format for merged PR list (one per line, inventory only):

`- #<number> <title> (<url>)`

## 2.5) Deterministic scope classification + coverage accounting (required)

For each PR in range, classify as one of:

- `vscode`
- `cli`
- `both`
- `exclude`
- `unknown` (only when file coverage is incomplete)

Deterministic rules:

1. Classify by changed files first:
   - only `cli/**` => `cli`
   - mix of `cli/**` and non-`cli/**` => `both`
   - no `cli/**` => `vscode`
2. Exclusion override:
   - if all changed files are internal-only paths (e.g. `.github/**`, `scripts/**`, `docs/**`, `evals/**`, tests-only, release-eng-only) classify as `exclude` with explicit reason
3. If PR file list is incomplete (e.g., pagination fetch failure), classify as `unknown`.
4. If uncertain and file list is complete, default to include and explain rationale.

Coverage table is mandatory before synthesis:

- every merged PR in range must appear exactly once
- status = `included`, `excluded`, or `unclassified`
- if excluded, include reason

Hard failure rule: do not generate final changelog until all PRs are classified (`unknown`/`unclassified` must be empty), unless explicit best-effort override is used.

Scope inclusion filter:

- `scope=vscode` includes `vscode` + `both`
- `scope=cli` includes `cli` + `both`

In one-action mode, run both filters and generate/apply one release block per target file.

In one-action mode, run both filters to generate artifacts for each scope, then use those artifacts to synthesize and apply one release block per target file.

## 3) First-time contributors (optional, best-effort)

If you can, produce a list of first-time contributor PRs. If this fails, continue without it.

Preferred output format:

`- #<number> <title> (@<author>) (<url>)`

## 3.5) External contributor attribution (required)

For included PRs authored by non-`cline` org members, append inline attribution in changelog bullets:

`(Thanks @<username>!)`

Use tri-state attribution confidence:

- `internal`
- `external`
- `unknown`

If membership lookup fails, do not emit false-positive thanks; continue and note attribution confidence in artifacts (`scope-classification.json`).

## 4) Generate changelog text

Create a prompt that contains:

- the merged PR list
- first-time contributor list (or “(none)”)
- coverage table with inclusion/exclusion reasons
- scope-specific instructions

Scope-specific guidance:

### vscode
- focus on changes that affect the VS Code extension experience (webview UI, providers/models, MCP, Plan/Act, checkpoints, tool use, commands/settings)
- exclude CLI-only changes and purely internal work

### cli
- focus on CLI commands/options, Ink UI, auth flows, ACP integration, provider configuration
- exclude extension-only changes and purely internal work

Required output format:

- First line must be: `## [<version>]`
- Sections in order: `Added`, `Fixed`, `Changed`, `New Contributors` using the target file’s existing heading depth (`##` or `###`)
- Omit any empty sections
- No preamble, no code fences, no analysis, no trailing notes
- This section schema is the same for both targets (`CHANGELOG.md` and `cli/CHANGELOG.md`)
- Final user-facing bullets must be human-readable only: no PR numbers and no PR links

Authoring source of truth:

- Use `pr-inventory.json`, `scope-classification.json`, `candidate-bullets.md`, and `merged-pr-lines.md` as structured inputs.
- Treat `candidate-bullets.md` as reference material only (deterministic title transforms), not final prose.
- Final changelog prose must be authored by the LLM in this workflow, then applied to the changelog files.

Final chat envelope:

1. concise summary (2–5 bullets)
2. exclusions summary
3. confirmation of updated file path(s)
4. short `git diff -- <target>` instruction for human review

## 5) Verification

After generating output and applying to file:

1. Ensure output begins with `## [<version>]`.
2. Ensure sections (if present) are in exact order: `Added`, `Fixed`, `Changed`, `New Contributors`, with target-consistent heading level.
3. Ensure there are no code fences.
4. Ensure no empty sections are present.
5. Ensure New Contributors bullets follow:
   `- @<login> made their first contribution.`
6. Ensure every included PR is represented in at least one bullet or explicitly acknowledged in exclusions.
7. Ensure targets are correct:
   - VSCode content is applied to `CHANGELOG.md`
   - CLI content is applied to `cli/CHANGELOG.md`
8. Ensure existing changelog history is preserved and only the new release block is inserted at the top release position.
9. If there are zero included PRs for a scope, do not modify that scope's changelog file; report a scope-specific no-op.

</detailed_sequence_of_steps>

<common_gh_commands>
# Common GitHub CLI Commands for PR Review

## Basic PR Commands
```bash
# Get current PR number
gh pr view --json number -q .number

# List open PRs
gh pr list

# View a specific PR
gh pr view <PR-number>

# View PR with specific fields
gh pr view <PR-number> --json title,body,comments,files,commits

# Check PR status
gh pr status

# View PR checks status
gh pr checks <PR-number>

# View PR commits
gh pr view <PR-number> --json commits
```

## Changelog / Release helper commands (git + gh + jq)

These are common building blocks used in our changelog-generation scripts/workflows.

```bash
# List latest semver-style release tags
git tag --list 'v[0-9]*' --sort=-version:refname | head -5

# If tags are missing (shallow clone), fetch them
git fetch --tags

# Validate refs exist before using them
git rev-parse --verify --quiet <from>^{} && git rev-parse --verify --quiet <to>^{}

# Extract candidate "#123" references from first-parent merge commit subjects
git log --first-parent --pretty=%s <from>..<to> |
  grep -Eo '#[0-9]+' |
  tr -d '#' |
  sort -un

# IMPORTANT: ensure changelog includes PRs only (not referenced issues)
# Any candidate that is actually an issue will resolve to null via pullRequest(number: N)
# and will be dropped by the `select(.value != null)` filter below.

# Determine repo owner/name (useful for GraphQL queries)
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=${REPO%/*}
NAME=${REPO#*/}

# GraphQL PR lookup pattern (IMPORTANT: keep stderr separate from JSON)
# - Use aliases like pr123: pullRequest(number: 123) { number title url }
# - Use "2>/dev/null || true" because gh may exit 1 on partial errors even if .data exists
gh api graphql -f query="query { repository(owner: \"${OWNER}\", name: \"${NAME}\") { pr123: pullRequest(number: 123) { number title url } } }" 2>/dev/null || true

# Convert GraphQL repository object to stable, filtered list of PR bullets (drops nulls)
jq -r '.data.repository
  | to_entries
  | sort_by(.value.number // 999999)
  | .[]
  | select(.value != null)
  | "- #\(.value.number) \(.value.title | gsub(\"[\\r\\n]+\"; \" \") | gsub(\"\\\\s+\"; \" \") | ltrimstr(\" \") | rtrimstr(\" \")) (\(.value.url))"'

# --- First-time contributors (best-effort) ---
# Definition: author whose earliest merged PR in the repo is the PR they have in the current window.
# Approach (from eve_release-eng-changelog scripts):
#  1) Fetch PR metadata for the window (including author.login)
#  2) Collect unique author logins (skip null authors)
#  3) For each author, query merged PRs via GraphQL Search and compute earliest by `mergedAt`
#  4) Keep PRs where PR.number == earliest_by_author[author]

# 1) Given a JSON array of PRs for the window (each has number,title,url,author.login), collect authors
jq -r '[.[].author | select(. != null) | .login] | unique | .[]'

# 2) Build GraphQL query pages per author (aliases must be GraphQL-safe) and choose the PR with the minimum `mergedAt`
#    NOTE: This uses GraphQL Search (type: ISSUE) but narrows to PR nodes; do not rely on created-date sorting.
AUTHORS=$(cat authors.txt)  # one login per line
AUTHOR_QUERY_BODY=$(printf "%s\n" "$AUTHORS" |
  awk -v owner="${OWNER}" -v name="${NAME}" '{
    alias=$0
    gsub(/[^A-Za-z0-9_]/, "_", alias)  # GraphQL aliases cannot contain hyphens
    printf "a%s: search(query: \"repo:%s/%s is:pr is:merged author:%s\", type: ISSUE, first: 100) { nodes { ... on PullRequest { number url title mergedAt author { login } } } pageInfo { hasNextPage endCursor } } ", alias, owner, name, $0
  }')

AUTHOR_JSON=$(gh api graphql -f query="query { ${AUTHOR_QUERY_BODY} }" 2>/dev/null || true)

# 3) Convert paged search results into a lookup map: author_login -> earliest_merged_pr_number (min mergedAt)
EARLIEST_BY_AUTHOR=$(echo "$AUTHOR_JSON" | jq -c '
  (.data // {})
  | to_entries
  | map({ node: (.value.nodes[0] // null) })
  | map(select(.node != null))
  | map({key: .node.author.login, value: .node.number})
  | from_entries
')

# 4) Filter the window PR list down to first-time contributor PRs and format bullets
#    (Assumes WINDOW_PRS_JSON is a JSON array of PR objects with .author.login)
echo "$WINDOW_PRS_JSON" | jq -r --argjson earliest "$EARLIEST_BY_AUTHOR" '
  map(select(.author.login as $a | ($earliest[$a] // -1) == .number))
  | sort_by(.number)
  | .[]
  | "- #\(.number) \(.title | gsub(\"[\\r\\n]+\"; \" \") | gsub(\"\\\\s+\"; \" \") | ltrimstr(\" \") | rtrimstr(\" \")) (@\(.author.login)) (\(.url))"
'
```
</common_gh_commands>