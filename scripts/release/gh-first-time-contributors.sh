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
# Note: This script uses `git tag --list` to autodetect the latest release tag. In shallow
# clones (e.g., GitHub Actions with fetch-depth: 1), tags may be missing. Run
# `git fetch --tags` before invoking this script in CI environments.
#
# Requires:
#   - git (with full tag history — run `git fetch --tags` first if in a shallow clone)
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

# Maximum number of PRs per GraphQL batch request. GitHub's GraphQL endpoint
# has an undocumented ~40 KB body limit; 100 PR aliases comfortably fits.
PR_CHUNK_SIZE=100

# Maximum number of authors per GraphQL batch request. Author search queries
# are larger per item (~200 chars each), so a smaller chunk is appropriate.
AUTHOR_CHUNK_SIZE=50

while [ $# -gt 0 ]; do
  case "$1" in
    --from-tag)
      [ -z "${2-}" ] && { echo "Error: --from-tag requires a value." >&2; usage >&2; exit 2; }
      FROM_TAG="$2"
      shift 2
      ;;
    --to-tag)
      [ -z "${2-}" ] && { echo "Error: --to-tag requires a value." >&2; usage >&2; exit 2; }
      TO_TAG="$2"
      shift 2
      ;;
    --base)
      [ -z "${2-}" ] && { echo "Error: --base requires a value." >&2; usage >&2; exit 2; }
      BASE_REF="$2"
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

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is required." >&2
  exit 1
fi
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
  echo "Error: No version tags found matching v* pattern." >&2
  echo "Hint: If running in a shallow clone, run 'git fetch --tags' first." >&2
  exit 1
fi

# Validate FROM_TAG
if ! git rev-parse --verify --quiet "${FROM_TAG}^{}" >/dev/null 2>&1 && \
   ! git rev-parse --verify --quiet "${FROM_TAG}" >/dev/null 2>&1; then
  echo "Error: '${FROM_TAG}' is not a valid tag or revision in this repository." >&2
  exit 1
fi

# Validate TO_TAG if specified
if [ -n "${TO_TAG}" ]; then
  if ! git rev-parse --verify --quiet "${TO_TAG}^{}" >/dev/null 2>&1 && \
     ! git rev-parse --verify --quiet "${TO_TAG}" >/dev/null 2>&1; then
    echo "Error: '${TO_TAG}' is not a valid tag or revision in this repository." >&2
    exit 1
  fi
fi

# Get repo owner and name from remote
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=${REPO%/*}
NAME=${REPO#*/}

if [ "${DEBUG}" -eq 1 ]; then
  echo "[debug] Using repo ${OWNER}/${NAME}" >&2
fi

# ---------------------------------------------------------------------------
# split_into_chunks <newline_separated_items> <chunk_size>
#   Prints each chunk as a single space-separated line.
# ---------------------------------------------------------------------------
split_into_chunks() {
  local items="$1"
  local chunk_size="$2"
  printf "%s\n" "${items}" | awk -v n="${chunk_size}" '
    NF == 0 { next }
    {
      buf = (buf == "") ? $0 : buf " " $0
      count++
      if (count == n) { print buf; buf = ""; count = 0 }
    }
    END { if (buf != "") print buf }
  '
}

# ---------------------------------------------------------------------------
# graphql_pr_batch <space_separated_pr_numbers>
#   Fetches PR metadata (number, title, url, mergedAt, author.login) for a
#   batch of PR numbers. Prints the raw JSON response. Returns 1 on total failure.
# ---------------------------------------------------------------------------
graphql_pr_batch() {
  local pr_numbers="$1"
  local query_body
  query_body=$(printf "%s\n" ${pr_numbers} |
    awk '{printf "pr%s: pullRequest(number: %s) { number title url mergedAt author { login } } ", $1, $1}')

  # Capture stdout+stderr together to distinguish total failure (no .data) from the
  # expected partial-error case where GitHub returns exit code 1 alongside a valid
  # .data payload (some commit subjects reference issue numbers, not PRs).
  local response
  response=$(gh api graphql \
    -f query="query { repository(owner: \"${OWNER}\", name: \"${NAME}\") { ${query_body} } }" 2>&1 || true)

  if ! printf '%s' "${response}" | jq -e '.data.repository' >/dev/null 2>&1; then
    printf '%s' "${response}" >&2
    return 1
  fi
  printf '%s' "${response}"
}

# ---------------------------------------------------------------------------
# graphql_author_batch <newline_separated_logins>
#   Fetches the earliest merged PR for each author login. Prints raw JSON.
#   Returns 1 on total failure.
#
#   Note on alias sanitization: GraphQL field names cannot contain hyphens or
#   other special characters, so logins are sanitized (non-alnum chars → "_")
#   and prefixed with "a" plus a unique sequence number. The alias is used only
#   to satisfy GraphQL syntax — author logins are extracted directly from each
#   node's .author.login field, so alias collisions (e.g. "foo-bar" and "foo_bar"
#   both mapping to "afoo_bar") cannot corrupt results.
# ---------------------------------------------------------------------------
graphql_author_batch() {
  local logins="$1"
  local query_body
  # ${logins} is intentionally unquoted here so that word-splitting expands the
  # space-separated chunk into individual arguments, causing printf to print each
  # login on its own line for awk to process one-per-line.
  # shellcheck disable=SC2086
  query_body=$(printf "%s\n" ${logins} |
    awk -v owner="${OWNER}" -v name="${NAME}" '{
      alias=$0
      gsub(/[^A-Za-z0-9_]/, "_", alias)
      printf "a%s_%d: search(query: \"repo:%s/%s is:pr is:merged author:%s sort:created-asc\", type: ISSUE, first: 1) { nodes { ... on PullRequest { number url title mergedAt author { login } } } } ", alias, NR, owner, name, $0
    }')

  local response
  response=$(gh api graphql -f query="query { ${query_body} }" 2>/dev/null || true)

  if [ -z "${response}" ]; then
    return 1
  fi
  printf '%s' "${response}"
}

# ---------------------------------------------------------------------------
# process_window <older_ref> <newer_ref>
#   Prints first-time contributor PRs for the window (older..newer].
# ---------------------------------------------------------------------------
process_window() {
  local older="$1"
  local newer="$2"

  # Collect PR numbers from merge commit subjects on the first-parent path.
  # NOTE: --first-parent is correct for a merge-based main branch workflow. If the repo
  # ever switches to squash-merge or rebase, PR numbers will stop appearing in commit
  # subjects and this function will silently produce empty output.
  local prs
  prs=$(git log --first-parent --pretty=%s "${older}..${newer}" |
    grep -Eo '#[0-9]+' |
    tr -d '#' |
    sort -un || true)

  if [ -z "${prs}" ]; then
    echo "- (no PR references found in merge commits)"
    return 0
  fi

  local pr_count
  pr_count=$(printf "%s\n" "${prs}" | wc -l | tr -d ' ')
  if [ "${DEBUG}" -eq 1 ]; then
    echo "[debug] ${newer}: PR refs from git: ${pr_count}" >&2
  fi

  # ---------------------------------------------------------------------------
  # Fetch PR metadata in batches of PR_CHUNK_SIZE to stay well under GitHub's
  # GraphQL query size limit (~40 KB per request).
  # ---------------------------------------------------------------------------
  local all_pr_objects="[]"
  local chunk
  while IFS= read -r chunk; do
    [ -z "${chunk}" ] && continue
    local batch_response
    if ! batch_response=$(graphql_pr_batch "${chunk}"); then
      echo "- (error fetching PR metadata from GitHub)" >&2
      echo "- (error fetching PR metadata from GitHub)"
      return 0
    fi

    local batch_objects
    batch_objects=$(printf '%s' "${batch_response}" | jq -c \
      '[.data.repository | to_entries | map(.value) | map(select(. != null))[]]')

    all_pr_objects=$(jq -cn --argjson a "${all_pr_objects}" --argjson b "${batch_objects}" '$a + $b')
  done < <(split_into_chunks "${prs}" "${PR_CHUNK_SIZE}")

  if [ "${DEBUG}" -eq 1 ]; then
    echo "[debug] ${newer}: PR objects fetched: $(printf '%s' "${all_pr_objects}" | jq 'length')" >&2
  fi

  # Filter out PRs with null authors (deleted GitHub accounts) before extracting logins
  local authors
  authors=$(printf '%s' "${all_pr_objects}" | jq -r \
    '[.[].author | select(. != null) | .login] | unique | .[]')

  if [ -z "${authors}" ]; then
    echo "- (no PR authors found)"
    return 0
  fi

  if [ "${DEBUG}" -eq 1 ]; then
    echo "[debug] ${newer}: Unique authors: $(printf "%s\n" "${authors}" | wc -l | tr -d ' ')" >&2
  fi

  # ---------------------------------------------------------------------------
  # For each author, fetch their earliest merged PR in this repo via the Search API.
  # Batch in groups of AUTHOR_CHUNK_SIZE to stay within GraphQL size limits.
  # ---------------------------------------------------------------------------
  local earliest_by_author="{}"
  local author_chunk
  while IFS= read -r author_chunk; do
    [ -z "${author_chunk}" ] && continue
    local author_response
    if ! author_response=$(graphql_author_batch "${author_chunk}"); then
      echo "- (error fetching author history from GitHub)" >&2
      echo "- (error fetching author history from GitHub)"
      return 0
    fi

    # Merge batch results into the cumulative earliest_by_author map.
    # Extract login directly from each node — no alias-to-login mapping needed.
    local batch_earliest
    batch_earliest=$(printf '%s' "${author_response}" | jq -c '
      (.data // {})
      | to_entries
      | map(select(.value != null))
      | map(.value.nodes[0] // null)
      | map(select(. != null and .author != null))
      | map({key: .author.login, value: .number})
      | from_entries
    ')

    earliest_by_author=$(jq -cn \
      --argjson base "${earliest_by_author}" \
      --argjson patch "${batch_earliest}" \
      '$base + $patch')
  done < <(split_into_chunks "${authors}" "${AUTHOR_CHUNK_SIZE}")

  if [ "${DEBUG}" -eq 1 ]; then
    echo "[debug] ${newer}: Earliest-by-author keys: $(printf '%s' "${earliest_by_author}" | jq 'keys | length')" >&2
  fi

  # Filter PRs to those that equal the earliest merged PR per author
  local filtered
  filtered=$(printf '%s' "${all_pr_objects}" | jq -c \
    --argjson earliest "${earliest_by_author}" '
    .
    | map(select(.author != null and .author.login as $a | ($earliest[$a] // -1) == .number))
    | sort_by(.number)
  ')

  local count
  count=$(printf '%s' "${filtered}" | jq 'length')

  if [ "${count}" -eq 0 ]; then
    echo "- (no first-time contributor PRs found)"
    return 0
  fi

  printf '%s' "${filtered}" | jq -r '
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
