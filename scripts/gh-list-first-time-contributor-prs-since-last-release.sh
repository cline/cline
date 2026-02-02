#!/usr/bin/env bash

# Lists PRs merged into main since the latest release tag, filtering to PRs opened by
# first-time contributors (i.e., the PR is the earliest merged PR by that author in this repo).
#
# Requires:
#   - git
#   - gh (authenticated)
#   - jq
#
# Output format:
#   - - #<number> <title> (@<author>) (<url>)

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/gh-list-first-time-contributor-prs-since-last-release.sh [--tag <tag>] [--base <ref>] [--debug]

Options:
  --tag <tag>   Override the autodetected latest vX.Y.Z tag.
  --base <ref>  Override the base branch/ref to compare against the tag (default: main).
  --debug       Print debug stats to stderr.

Requires: git, gh (authenticated), jq
USAGE
}

BASE_REF="main"
OVERRIDE_TAG=""
DEBUG=0

while [ $# -gt 0 ]; do
  case "$1" in
    --tag)
      OVERRIDE_TAG="${2-}"
      shift 2
      ;;
    --base)
      BASE_REF="${2-}"
      shift 2
      ;;
    --debug)
      DEBUG=1
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -n "${OVERRIDE_TAG}" ]; then
  TAG="${OVERRIDE_TAG}"
else
  # Get the most recent version tag (sorted by semantic version)
  TAG=$(git tag --list 'v[0-9]*' --sort=-version:refname | head -1)
fi

if [ -z "${TAG}" ]; then
  echo "Error: No version tags found matching v* pattern" >&2
  exit 1
fi

echo "Finding first-time contributor PRs since ${TAG} (base: ${BASE_REF})..." >&2

# Get repo owner and name from remote
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=${REPO%/*}
NAME=${REPO#*/}

# Collect PR numbers from merge commit subjects on the first-parent path.
# This mirrors scripts/gh-list-prs-since-last-release.sh's approach.
PRS=$(git log --first-parent --pretty=%s "${TAG}..${BASE_REF}" |
  grep -Eo '#[0-9]+' |
  tr -d '#' |
  sort -un || true)

if [ -z "${PRS}" ]; then
  echo "No PR references found in merge commits since ${TAG}." >&2
  exit 0
fi

if [ "${DEBUG}" -eq 1 ]; then
  echo "[debug] PR count (from merge commit subjects): $(printf "%s\n" "${PRS}" | wc -l | tr -d ' ')" >&2
fi

# Build a GraphQL query containing one alias per PR.
# For each PR, we fetch:
#   - number, title, url
#   - author login
#   - mergedAt (for tie-breaking)
#   - author's first merged PR (search via defaultBranchRef with commit history is expensive;
#     instead we use the PR's authorAssociation + a repo-scoped search for earlier merged PRs).
#
# Heuristic / definition used here:
#   A PR is from a first-time contributor if there is no *earlier merged PR* in this repo
#   with the same author login.
#
# Notes:
#   - This intentionally ignores issues and comments; it’s specifically “first PR merged”.
#   - If an author has multiple merged PRs, only the earliest merged one will be flagged.

QUERY_BODY=$(printf "%s\n" "${PRS}" |
  awk '{printf "pr%s: pullRequest(number: %s) { number title url mergedAt author { login } } ", $1, $1}')

# Fetch PR details in one request
# Note: GraphQL may return partial data + an `errors` array when some PR numbers can’t be resolved.
# This can happen when merge commit subjects include a different issue/PR number than the actual PR.
# We treat those as “unknown” and continue.
PR_JSON=$(gh api graphql -f query="query { repository(owner: \"${OWNER}\", name: \"${NAME}\") { ${QUERY_BODY} } }" 2>/dev/null || true)

if [ -z "${PR_JSON}" ]; then
  echo "Error: Failed to fetch PR metadata from GitHub." >&2
  exit 1
fi

# Convert to a stable list of PR objects and drop nulls
PR_LIST=$(echo "${PR_JSON}" | jq -c '[.data.repository | to_entries | map(.value) | map(select(. != null))[]]')

if [ "${DEBUG}" -eq 1 ]; then
  echo "[debug] Unresolved PR refs (from git log subjects):" >&2
  echo "${PR_JSON}" | jq -r '.errors[]?.message' 2>/dev/null | sed 's/^/[debug]   - /' >&2 || true
fi

if [ "${DEBUG}" -eq 1 ]; then
  echo "[debug] PR objects fetched: $(echo "${PR_LIST}" | jq 'length')" >&2
fi

# For each unique author among these PRs, ask GitHub for their earliest merged PR in this repo.
# We do this with the Search API (GraphQL), using:
#   repo:OWNER/NAME is:pr is:merged author:<login>
#
# Then compare that earliest PR number to our candidate PR numbers.
AUTHORS=$(echo "${PR_LIST}" | jq -r '.[].author.login' | sort -u)

if [ -z "${AUTHORS}" ]; then
  echo "No PR authors found." >&2
  exit 0
fi

if [ "${DEBUG}" -eq 1 ]; then
  echo "[debug] Unique authors: $(printf "%s\n" "${AUTHORS}" | wc -l | tr -d ' ')" >&2
fi

# Build a GraphQL query with one alias per author to fetch earliest merged PR.
# We sort by created_at ascending; then pick the first result.
# (We also request mergedAt for robustness, but search ordering is created_at.)
AUTHOR_QUERY_BODY=$(printf "%s\n" "${AUTHORS}" |
  awk -v owner="${OWNER}" -v name="${NAME}" '{
    alias=$0
    gsub(/[^A-Za-z0-9_\-]/, "_", alias)  # alias-safe
    printf "a%s: search(query: \"repo:%s/%s is:pr is:merged author:%s sort:created-asc\", type: ISSUE, first: 1) { nodes { ... on PullRequest { number url title mergedAt author { login } } } } ", alias, owner, name, $0
  }')

AUTHOR_JSON=$(gh api graphql -f query="query { ${AUTHOR_QUERY_BODY} }" 2>/dev/null)

# Create a lookup map: author_login -> earliest_merged_pr_number
EARLIEST_BY_AUTHOR=$(echo "${AUTHOR_JSON}" | jq -c '
  .data
  | to_entries
  | map({
      # alias keys are sanitized; pull login back from the returned node
      node: (.value.nodes[0] // null)
    })
  | map(select(.node != null))
  | map({key: .node.author.login, value: .node.number})
  | from_entries
')

if [ "${DEBUG}" -eq 1 ]; then
  echo "[debug] Earliest-by-author keys: $(echo "${EARLIEST_BY_AUTHOR}" | jq 'keys | length')" >&2
fi

# Filter the PR list to those that equal the earliest merged PR per author.
FILTERED=$(echo "${PR_LIST}" | jq -c --argjson earliest "${EARLIEST_BY_AUTHOR}" '
  .
  | map(select(.author.login as $a | ($earliest[$a] // -1) == .number))
  | sort_by(.number)
')

COUNT=$(echo "${FILTERED}" | jq 'length')

if [ "${COUNT}" -eq 0 ]; then
  echo "No first-time contributor PRs found since ${TAG}." >&2
  exit 0
fi

echo "${FILTERED}" | jq -r '
  .[]
  | "- #\(.number) \(.title | gsub("[\\r\\n]+"; " ") | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ")) (@\(.author.login)) (\(.url))"
'
