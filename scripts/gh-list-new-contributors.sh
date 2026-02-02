#!/usr/bin/env bash

# For each of the last N release tags (default 20), identifies the PR authors whose
# FIRST merged PR in the repo falls within that release window.
#
# Release window definition:
#   For tags ordered newest -> oldest:
#     release window for <newerTag> is (olderTag..newerTag]
#   i.e., commits reachable from newerTag but not from olderTag, along the first-parent path.
#
# Requires:
#   - git
#   - gh (authenticated)
#   - jq
#
# Output (markdown):
#   ## vX.Y.Z
#   - @login

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/gh-list-new-contributors-for-last-20-releases.sh [--count <n>] [--base <ref>] [--debug]

Options:
  --count <n>  Number of newest release tags to consider (default: 20)
  --base <ref> Branch/ref that tags are expected to be on (default: main)
  --debug      Print debug stats to stderr

Requires: git, gh (authenticated), jq
USAGE
}

COUNT=20
BASE_REF="main"
DEBUG=0

while [ $# -gt 0 ]; do
  case "$1" in
    --count)
      COUNT="${2-}"
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

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=${REPO%/*}
NAME=${REPO#*/}

# Get last COUNT+1 tags so we have windows (older->newer) for COUNT releases.
TAGS=$(git tag --list 'v[0-9]*' --sort=-version:refname | head -n "$((COUNT + 1))")

TAG_COUNT=$(printf "%s\n" "${TAGS}" | grep -c '^[^[:space:]]' || true)
if [ "${TAG_COUNT}" -lt 2 ]; then
  echo "Error: Need at least 2 release tags to compute windows." >&2
  exit 1
fi

if [ "${DEBUG}" -eq 1 ]; then
  echo "[debug] Using repo ${OWNER}/${NAME}" >&2
  echo "[debug] Tags considered (newest->oldest):" >&2
  printf "%s\n" "${TAGS}" | sed 's/^/[debug]   - /' >&2
fi

# Helper: list PR numbers referenced by merge commit subjects on first-parent between two refs.
get_pr_numbers_between() {
  local older="$1"
  local newer="$2"

  git log --first-parent --pretty=%s "${older}..${newer}" |
    grep -Eo '#[0-9]+' |
    tr -d '#' |
    sort -un || true
}

print_release_section() {
  local older="$1"
  local newer="$2"
  local pr_numbers

  pr_numbers=$(get_pr_numbers_between "${older}" "${newer}")
  if [ -z "${pr_numbers}" ]; then
    echo "## ${newer}"
    echo "- (no PR references found in merge commits)"
    echo
    return 0
  fi

  if [ "${DEBUG}" -eq 1 ]; then
    echo "[debug] ${newer}: PR refs from git subjects: $(printf "%s\n" "${pr_numbers}" | wc -l | tr -d ' ')" >&2
  fi

  # Fetch PR metadata for this window.
  query_body=$(printf "%s\n" "${pr_numbers}" |
    awk '{printf "pr%s: pullRequest(number: %s) { number url author { login } } ", $1, $1}')

  pr_json=$(gh api graphql -f query="query { repository(owner: \"${OWNER}\", name: \"${NAME}\") { ${query_body} } }" 2>/dev/null || true)
  if [ -z "${pr_json}" ]; then
    echo "## ${newer}"
    echo "- (error fetching PRs from GitHub)"
    echo
    return 0
  fi

  pr_list=$(echo "${pr_json}" | jq -c '[.data.repository | to_entries | map(.value) | map(select(. != null))[]]')
  authors=$(echo "${pr_list}" | jq -r '.[].author.login' | sort -u)

  if [ "${DEBUG}" -eq 1 ]; then
    echo "[debug] ${newer}: Unresolved PR refs (from git subjects):" >&2
    echo "${pr_json}" | jq -r '.errors[]?.message' 2>/dev/null | sed 's/^/[debug]   - /' >&2 || true
  fi

  if [ -z "${authors}" ]; then
    echo "## ${newer}"
    echo "- (no PR authors found)"
    echo
    return 0
  fi

  # Ask GitHub for each author's earliest merged PR in this repo.
  author_query_body=$(printf "%s\n" "${authors}" |
    awk -v owner="${OWNER}" -v name="${NAME}" '{
      alias=$0
      gsub(/[^A-Za-z0-9_\-]/, "_", alias)
      printf "a%s: search(query: \"repo:%s/%s is:pr is:merged author:%s sort:created-asc\", type: ISSUE, first: 1) { nodes { ... on PullRequest { number url mergedAt author { login } } } } ", alias, owner, name, $0
    }')

  author_json=$(gh api graphql -f query="query { ${author_query_body} }" 2>/dev/null || true)
  if [ -z "${author_json}" ]; then
    echo "## ${newer}"
    echo "- (error fetching earliest PRs by author)"
    echo
    return 0
  fi

  earliest_by_author=$(echo "${author_json}" | jq -c '
    (.data // {})
    | to_entries
    | map({ node: (.value.nodes[0] // null) })
    | map(select(.node != null))
    | map({key: .node.author.login, value: { number: .node.number, url: .node.url }})
    | from_entries
  ')

  # New contributor for this release window = earliest PR number is in this window's PR numbers.
  # Output unique @logins.
  new_contributors=$(echo "${pr_list}" | jq -r --argjson earliest "${earliest_by_author}" '
    [.[].number] | unique as $windowPrs
    | ($earliest | to_entries)
    | map(select(.value.number as $n | ($windowPrs | index($n)) != null))
    | map(.key)
    | sort
    | .[]
  ')

  echo "## ${newer}"
  if [ -z "${new_contributors}" ]; then
    echo "- (no new contributors)"
    echo
    return 0
  fi

  printf "%s\n" "${new_contributors}" | sed 's/^/- @/'
  echo
}

echo "# New contributors by release (last ${COUNT})"
echo "" 

# Iterate newest->oldest tags list into windows: (older, newer)
prev=""
idx=0
while IFS= read -r tag; do
  if [ -z "${prev}" ]; then
    prev="${tag}"
    continue
  fi
  newer="${prev}"
  older="${tag}"
  idx=$((idx + 1))

  # Stop after COUNT windows
  if [ "${idx}" -gt "${COUNT}" ]; then
    break
  fi

  print_release_section "${older}" "${newer}"
  prev="${tag}"
done <<<"${TAGS}"
