#!/usr/bin/env bash

# Lists PRs merged into main since the latest release tag.
# Auto-detects the latest vX.Y.Z tag, or accepts an explicit --from-tag override.
#
# Requires:
#   - git (with full tag history — run `git fetch --tags` first if in a shallow clone)
#   - gh (authenticated)
#   - jq

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/gh-list-prs-since-last-release.sh [--from-tag <tag>] [--to-tag <tag>] [--base <ref>] [--debug]

Options:
  --from-tag <tag>  Override the autodetected latest vX.Y.Z tag.
  --to-tag <tag>    Upper bound of the range (overrides --base when specified).
  --base <ref>      Base branch to compare against (default: main). Ignored when --to-tag is set.
  --debug           Print debug stats to stderr.

Note: This script uses `git tag --list` to autodetect the latest release tag. In shallow
clones (e.g., GitHub Actions with fetch-depth: 1), tags may be missing. Run
`git fetch --tags` before invoking this script in CI environments.

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

# Validate required dependencies
for cmd in git gh jq; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Error: ${cmd} is required." >&2
    exit 1
  fi
done

# Auto-detect tag if not specified
if [ -z "${FROM_TAG}" ]; then
  FROM_TAG=$(git tag --list 'v[0-9]*' --sort=-version:refname | head -1)
fi

if [ -z "${FROM_TAG}" ]; then
  echo "Error: No version tags found matching v* pattern." >&2
  echo "Hint: If running in a shallow clone, run 'git fetch --tags' first." >&2
  exit 1
fi

# Validate the tag/ref exists before using it
if ! git rev-parse --verify --quiet "${FROM_TAG}^{}" >/dev/null 2>&1 && \
   ! git rev-parse --verify --quiet "${FROM_TAG}" >/dev/null 2>&1; then
  echo "Error: '${FROM_TAG}' is not a valid tag or revision in this repository." >&2
  exit 1
fi

# If --to-tag was given, validate it and use it as the upper bound; otherwise use BASE_REF.
UPPER_BOUND="${BASE_REF}"
if [ -n "${TO_TAG}" ]; then
  if ! git rev-parse --verify --quiet "${TO_TAG}^{}" >/dev/null 2>&1 && \
     ! git rev-parse --verify --quiet "${TO_TAG}" >/dev/null 2>&1; then
    echo "Error: '${TO_TAG}' is not a valid tag or revision in this repository." >&2
    exit 1
  fi
  UPPER_BOUND="${TO_TAG}"
fi

echo "Generating changelog from ${FROM_TAG} to ${UPPER_BOUND}..." >&2

# Get repo owner and name from remote
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=${REPO%/*}
NAME=${REPO#*/}

# Collect PR numbers from merge commit subjects on the first-parent path.
# NOTE: --first-parent is correct for a merge-based main branch workflow. If the repo
# ever switches to squash-merge or rebase, PR numbers will stop appearing in commit
# subjects and this script will silently produce empty output.
ALL_PR_NUMBERS=$(git log --first-parent --pretty=%s "${FROM_TAG}..${UPPER_BOUND}" |
  grep -Eo '#[0-9]+' |
  tr -d '#' |
  sort -un || true)

if [ -z "${ALL_PR_NUMBERS}" ]; then
  echo "No PR references found in merge commits since ${FROM_TAG}." >&2
  exit 0
fi

TOTAL_PRS=$(printf "%s\n" "${ALL_PR_NUMBERS}" | wc -l | tr -d ' ')
if [ "${DEBUG}" -eq 1 ]; then
  echo "[debug] Total PR refs from git log: ${TOTAL_PRS}" >&2
fi

# ---------------------------------------------------------------------------
# split_into_chunks <newline_separated_items> <chunk_size>
#   Prints each chunk as a single space-separated line, one chunk per output line.
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
# Batch GraphQL requests in chunks of 100 to stay well under GitHub's query
# size limit (~40 KB). For large releases with hundreds of PRs, a single
# monolithic query would exceed the limit and fail silently.
#
# split_into_chunks outputs one space-separated line per chunk so that
# `while IFS= read -r chunk` iterates once per batch, not once per PR.
# ---------------------------------------------------------------------------
CHUNK_SIZE=100
COMBINED_OUTPUT=""
NULL_COUNT=0

while IFS= read -r chunk; do
  [ -z "${chunk}" ] && continue

  # Capture stdout+stderr together so we can distinguish a total failure (no .data)
  # from the expected partial-error case where GitHub returns exit code 1 alongside
  # a valid .data payload because some merge-commit subjects reference issue numbers
  # rather than PRs. The jq select(.value != null) below drops those null entries.
  QUERY_BODY=$(printf "%s\n" ${chunk} |
    awk '{printf "pr%s: pullRequest(number: %s) { number title url } ", $1, $1}')

  GH_OUTPUT=$(gh api graphql \
    -f query="query { repository(owner: \"${OWNER}\", name: \"${NAME}\") { ${QUERY_BODY} }}" 2>&1 || true)

  if ! printf '%s' "${GH_OUTPUT}" | jq -e '.data.repository' >/dev/null 2>&1; then
    echo "Error: GitHub GraphQL request failed:" >&2
    printf '%s\n' "${GH_OUTPUT}" | head -10 >&2
    exit 1
  fi

  if [ "${DEBUG}" -eq 1 ]; then
    CHUNK_NULL_COUNT=$(printf '%s' "${GH_OUTPUT}" | jq '[.data.repository | to_entries[] | select(.value == null)] | length')
    NULL_COUNT=$((NULL_COUNT + CHUNK_NULL_COUNT))
  fi

  # Accumulate results across chunks as newline-separated PR lines
  CHUNK_LINES=$(printf '%s' "${GH_OUTPUT}" |
    jq -r '.data.repository | to_entries | sort_by(.value.number // 999999) | .[] | select(.value != null) | "- #\(.value.number) \(.value.title | gsub("[\\r\\n]+"; " ") | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ")) (\(.value.url))"' |
    grep -v '^$' || true)

  if [ -n "${CHUNK_LINES}" ]; then
    if [ -n "${COMBINED_OUTPUT}" ]; then
      COMBINED_OUTPUT="${COMBINED_OUTPUT}"$'\n'"${CHUNK_LINES}"
    else
      COMBINED_OUTPUT="${CHUNK_LINES}"
    fi
  fi
done < <(split_into_chunks "${ALL_PR_NUMBERS}" "${CHUNK_SIZE}")

if [ "${DEBUG}" -eq 1 ] && [ "${NULL_COUNT}" -gt 0 ]; then
  echo "[debug] Dropped ${NULL_COUNT} non-PR ref(s) (issues or deleted PRs) across all chunks" >&2
fi

printf '%s\n' "${COMBINED_OUTPUT}" | grep -v '^$' || true
