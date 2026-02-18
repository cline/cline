#!/usr/bin/env bash

# Lists first-time contributor PRs, optionally across multiple release windows.
#
# A "first-time contributor" is defined as an author whose earliest merged PR
# in this repo falls within the window being examined.
#
# Single-window mode (--to-tag omitted):
#   Lists PRs merged since --from-tag (default: latest vX.Y.Z) through --base.
#   Output: - #<number> <title> (@<author>) (<url>)
#
# Multi-window mode (--to-tag specified):
#   Iterates all release windows from --from-tag up to --to-tag, printing a
#   ## <tag> section header for each window followed by its first-time contributor PRs.
#
# Requires:
#   - git
#   - gh (authenticated)
#   - jq

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/gh-first-time-contributors.sh [--from-tag <tag>] [--to-tag <tag>] [--base <ref>] [--debug]

Options:
  --from-tag <tag>  The start tag (default: latest vX.Y.Z tag). In single-window
                    mode, PRs since this tag through --base are listed. In
                    multi-window mode, this is the oldest boundary (exclusive).
  --to-tag <tag>    The end tag (optional). When specified, all release windows
                    from --from-tag up to and including --to-tag are iterated,
                    with a ## <tag> section header per window.
  --base <ref>      Base branch/ref used when --to-tag is omitted (default: main).
  --debug           Print debug stats to stderr.

Requires: git, gh (authenticated), jq
USAGE
}

BASE_REF="main"
FROM_TAG=""
TO_TAG=""
DEBUG=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from-tag)
      FROM_TAG="${2-}"
      shift 2
      ;;
    --to-tag)
      TO_TAG="${2-}"
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

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh is required." >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required." >&2
  exit 1
fi

# Auto-detect from-tag if not specified
if [ -z "${FROM_TAG}" ]; then
  FROM_TAG=$(git tag --list 'v[0-9]*' --sort=-version:refname | head -1)
fi

if [ -z "${FROM_TAG}" ]; then
  echo "Error: No version tags found matching v* pattern" >&2
  exit 1
fi

# Get repo owner and name from remote
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=${REPO%/*}
NAME=${REPO#*/}

if [ "${DEBUG}" -eq 1 ]; then
  echo "[debug] Using repo ${OWNER}/${NAME}" >&2
fi

# ---------------------------------------------------------------------------
# process_window <older> <newer>
#   Prints first-time contributor PRs for the window (older..newer].
# ---------------------------------------------------------------------------
process_window() {
  local older="$1"
  local newer="$2"

  # Collect PR numbers from merge commit subjects on the first-parent path
  local prs
  prs=$(git log --first-parent --pretty=%s "${older}..${newer}" |
    grep -Eo '#[0-9]+' |
    tr -d '#' |
    sort -un || true)

  if [ -z "${prs}" ]; then
    echo "- (no PR references found in merge commits)"
    return 0
  fi

  if [ "${DEBUG}" -eq 1 ]; then
    echo "[debug] ${newer}: PR refs from git: $(printf "%s\n" "${prs}" | wc -l | tr -d ' ')" >&2
  fi

  # Fetch PR metadata (number, title, url, author) in one GraphQL request
  local query_body
  query_body=$(printf "%s\n" "${prs}" |
    awk '{printf "pr%s: pullRequest(number: %s) { number title url mergedAt author { login } } ", $1, $1}')

  local pr_json
  pr_json=$(gh api graphql -f query="query { repository(owner: \"${OWNER}\", name: \"${NAME}\") { ${query_body} } }" 2>/dev/null || true)

  if [ -z "${pr_json}" ]; then
    echo "- (error fetching PR metadata from GitHub)"
    return 0
  fi

  if [ "${DEBUG}" -eq 1 ]; then
    echo "[debug] ${newer}: Unresolved PR refs (from git log subjects):" >&2
    echo "${pr_json}" | jq -r '.errors[]?.message' 2>/dev/null | sed 's/^/[debug]   - /' >&2 || true
  fi

  # Convert to a stable list of PR objects, dropping nulls
  local pr_list
  pr_list=$(echo "${pr_json}" | jq -c '[.data.repository | to_entries | map(.value) | map(select(. != null))[]]')

  if [ "${DEBUG}" -eq 1 ]; then
    echo "[debug] ${newer}: PR objects fetched: $(echo "${pr_list}" | jq 'length')" >&2
  fi

  # Filter out PRs with null authors (deleted GitHub accounts) before extracting logins
  local authors
  authors=$(echo "${pr_list}" | jq -r '[.[].author | select(. != null) | .login] | unique | .[]')

  if [ -z "${authors}" ]; then
    echo "- (no PR authors found)"
    return 0
  fi

  if [ "${DEBUG}" -eq 1 ]; then
    echo "[debug] ${newer}: Unique authors: $(printf "%s\n" "${authors}" | wc -l | tr -d ' ')" >&2
  fi

  # For each author, fetch their earliest merged PR in this repo via the Search API
  local author_query_body
  author_query_body=$(printf "%s\n" "${authors}" |
    awk -v owner="${OWNER}" -v name="${NAME}" '{
      alias=$0
      gsub(/[^A-Za-z0-9_]/, "_", alias)  # make alias GraphQL-safe (hyphens → underscore; GraphQL names cannot contain hyphens)
      printf "a%s: search(query: \"repo:%s/%s is:pr is:merged author:%s sort:created-asc\", type: ISSUE, first: 1) { nodes { ... on PullRequest { number url title mergedAt author { login } } } } ", alias, owner, name, $0
    }')

  local author_json
  author_json=$(gh api graphql -f query="query { ${author_query_body} }" 2>/dev/null || true)

  # Build lookup map: author_login -> earliest_merged_pr_number
  local earliest_by_author
  earliest_by_author=$(echo "${author_json}" | jq -c '
    (.data // {})
    | to_entries
    | map({ node: (.value.nodes[0] // null) })
    | map(select(.node != null))
    | map({key: .node.author.login, value: .node.number})
    | from_entries
  ')

  if [ "${DEBUG}" -eq 1 ]; then
    echo "[debug] ${newer}: Earliest-by-author keys: $(echo "${earliest_by_author}" | jq 'keys | length')" >&2
  fi

  # Filter PRs to those that equal the earliest merged PR per author
  local filtered
  filtered=$(echo "${pr_list}" | jq -c --argjson earliest "${earliest_by_author}" '
    .
    | map(select(.author.login as $a | ($earliest[$a] // -1) == .number))
    | sort_by(.number)
  ')

  local count
  count=$(echo "${filtered}" | jq 'length')

  if [ "${count}" -eq 0 ]; then
    echo "- (no first-time contributor PRs found)"
    return 0
  fi

  echo "${filtered}" | jq -r '
    .[]
    | "- #\(.number) \(.title | gsub("[\\r\\n]+"; " ") | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ")) (@\(.author.login)) (\(.url))"
  '
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if [ -z "${TO_TAG}" ]; then
  # Single-window mode: FROM_TAG..BASE_REF
  echo "Finding first-time contributor PRs since ${FROM_TAG} (through ${BASE_REF})..." >&2
  process_window "${FROM_TAG}" "${BASE_REF}"
else
  # Multi-window mode: iterate all release windows from FROM_TAG up to TO_TAG.
  # Collect all vX.Y.Z tags strictly after FROM_TAG and up to and including TO_TAG,
  # in ascending semver order.
  WINDOW_TAGS=$(git tag --list 'v[0-9]*' --sort=version:refname |
    awk -v from="${FROM_TAG}" -v to="${TO_TAG}" '
      BEGIN { found_from = 0; done = 0 }
      {
        if (done) next
        if ($0 == from) { found_from = 1; next }
        if (found_from) { print; if ($0 == to) done = 1 }
      }
    ')

  if [ -z "${WINDOW_TAGS}" ]; then
    echo "Error: No tags found after ${FROM_TAG} up to ${TO_TAG}." >&2
    exit 1
  fi

  echo "Finding first-time contributor PRs from ${FROM_TAG} to ${TO_TAG}..." >&2

  prev="${FROM_TAG}"
  while IFS= read -r tag; do
    echo ""
    echo "## ${tag}"
    process_window "${prev}" "${tag}"
    prev="${tag}"
  done <<<"${WINDOW_TAGS}"
fi
