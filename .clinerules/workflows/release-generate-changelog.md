You are in the `cline/` repo.  Your goal is to generate high quality release notes/changelog entries for either the VSCode extension or the CLI between two release tags in git.

You have access to `git`, `gh`, and `jq`. Assume `gh` is already authenticated.

<detailed_sequence_of_steps>

# Release Changelog Generation Workflow (Robust)

## Inputs you must ask the user for
Ask the user to choose one of these **four** options (preferred), then collect any missing values:

1. `scope=vscode, from=latest, to=now`
2. `scope=cli, from=latest, to=now`
3. `scope=vscode, from=<tag>, to=<tag/ref>`
4. `scope=cli, from=<tag>, to=<tag/ref>`

Where:

- `from=latest` means “use the latest `vX.Y.Z` tag in the repo”.
- `to=now` means “use `main`”.

If the user doesn’t pick one of the four directly, fall back to collecting these fields explicitly:

1. **Scope**: `vscode` or `cli`
2. **From tag/ref**: e.g. `v3.54.0` (exclusive lower bound). Use the latest `vX.Y.Z` tag if they say “latest”.
3. **To ref** (optional): default `main` (inclusive upper bound). Use `main` if they say “now”.

If any are missing, ask a follow-up question.

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

## 1) Collect PR number candidates from git history

Use first-parent merge commits:

```bash
git log --first-parent --pretty=%s <from>..<to> |
  grep -Eo '#[0-9]+' |
  tr -d '#' |
  sort -un
```

Save these numbers (newline-separated) as `ALL_PR_NUMBERS`.

## 2) Fetch PR metadata from GitHub (robust to partial errors)

Key rule: **Never mix stderr into stdout JSON.** GitHub/gh may emit error messages to stderr while still returning valid JSON on stdout.

1. Query PRs in batches (e.g. 100 per chunk).
2. Use `gh api graphql ... 2>/dev/null || true`.
3. Treat the response as valid if `jq -e '.data.repository'` succeeds.
4. Drop null PRs with `select(.value != null)`.

Output format for merged PR list (one per line):

`- #<number> <title> (<url>)`

## 3) First-time contributors (optional, best-effort)

If you can, produce a list of first-time contributor PRs. If this fails, continue without it.

Preferred output format:

`- #<number> <title> (@<author>) (<url>)`

## 4) Generate changelog text

Create a prompt that contains:

- the merged PR list
- first-time contributor list (or “(none)”)
- scope-specific instructions

Scope-specific guidance:

### vscode
- focus on changes that affect the VS Code extension experience (webview UI, providers/models, MCP, Plan/Act, checkpoints, tool use, commands/settings)
- exclude CLI-only changes and purely internal work

### cli
- focus on CLI commands/options, Ink UI, auth flows, ACP integration, provider configuration
- exclude extension-only changes and purely internal work

Required output format:

- Sections in order: `## Added`, `## Fixed`, `## Changed`, `## New Contributors`
- Omit any empty sections
- No preamble, no code fences; first line must be a section header

## 5) Verification

After generating output:

1. Ensure output begins with `## Added` / `## Fixed` / `## Changed` / `## New Contributors`.
2. Ensure there are no code fences.
3. Ensure New Contributors bullets follow:
   `- @<login> made their first contribution in #<number> (<url>)`

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
#  3) For each author, query their earliest merged PR via GraphQL Search (sort:created-asc, first:1)
#  4) Keep PRs where PR.number == earliest_by_author[author]

# 1) Given a JSON array of PRs for the window (each has number,title,url,author.login), collect authors
jq -r '[.[].author | select(. != null) | .login] | unique | .[]'

# 2) Build a GraphQL query that finds each author’s earliest merged PR (aliases must be GraphQL-safe)
#    NOTE: This uses GraphQL Search (type: ISSUE) but narrows to PR nodes.
AUTHORS=$(cat authors.txt)  # one login per line
AUTHOR_QUERY_BODY=$(printf "%s\n" "$AUTHORS" |
  awk -v owner="${OWNER}" -v name="${NAME}" '{
    alias=$0
    gsub(/[^A-Za-z0-9_]/, "_", alias)  # GraphQL aliases cannot contain hyphens
    printf "a%s: search(query: \"repo:%s/%s is:pr is:merged author:%s sort:created-asc\", type: ISSUE, first: 1) { nodes { ... on PullRequest { number url title mergedAt author { login } } } } ", alias, owner, name, $0
  }')

AUTHOR_JSON=$(gh api graphql -f query="query { ${AUTHOR_QUERY_BODY} }" 2>/dev/null || true)

# 3) Convert search results into a lookup map: author_login -> earliest_merged_pr_number
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