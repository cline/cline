#!/usr/bin/env bash

# Lists PRs merged into main since the latest release tag.
# Auto-detects the latest vX.Y.Z tag, or accepts an explicit --from-tag override.
#
# Requires:
#   - git
#   - gh (authenticated)
#   - jq

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/gh-list-prs-since-last-release.sh [--from-tag <tag>] [--base <ref>] [--debug]

Options:
  --from-tag <tag>  Override the autodetected latest vX.Y.Z tag.
  --base <ref>      Base branch to compare against (default: main).
  --debug           Print debug stats to stderr.

Requires: git, gh (authenticated), jq
USAGE
}

BASE_REF="main"
FROM_TAG=""
DEBUG=0

while [ $# -gt 0 ]; do
  case "$1" in
    --from-tag)
      [ -z "${2-}" ] && { echo "Error: --from-tag requires a value." >&2; usage >&2; exit 2; }
      FROM_TAG="$2"
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

# Auto-detect tag if not specified
if [ -z "${FROM_TAG}" ]; then
  FROM_TAG=$(git tag --list 'v[0-9]*' --sort=-version:refname | head -1)
fi

if [ -z "${FROM_TAG}" ]; then
  echo "Error: No version tags found matching v* pattern" >&2
  exit 1
fi

# Validate the tag/ref exists before using it
if ! git rev-parse --verify --quiet "${FROM_TAG}^{}" >/dev/null 2>&1 && \
   ! git rev-parse --verify --quiet "${FROM_TAG}" >/dev/null 2>&1; then
  echo "Error: '${FROM_TAG}' is not a valid tag or revision in this repository." >&2
  exit 1
fi

echo "Generating changelog since ${FROM_TAG}..." >&2

# Get repo owner and name from remote
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
OWNER=${REPO%/*}
NAME=${REPO#*/}

# Build query body and execute in single request
QUERY_BODY=$(git log --first-parent --pretty=%s "${FROM_TAG}..${BASE_REF}" |
  grep -Eo '#[0-9]+' |
  tr -d '#' |
  sort -un |
  awk '{printf "pr%s: pullRequest(number: %s) { number title url } ", $1, $1}' || true)

if [ -z "${QUERY_BODY}" ]; then
  echo "No PR references found in merge commits since ${FROM_TAG}." >&2
  exit 0
fi

# Capture stdout+stderr together so we can distinguish a total failure (no .data)
# from the expected partial-error case where GitHub returns exit code 1 alongside
# a valid .data payload because some merge-commit subjects reference issue numbers
# rather than PRs. The jq select(.value != null) below drops those null entries.
GH_OUTPUT=$(gh api graphql \
  -f query="query { repository(owner: \"${OWNER}\", name: \"${NAME}\") { ${QUERY_BODY} }}" 2>&1 || true)

if ! printf '%s' "${GH_OUTPUT}" | jq -e '.data.repository' >/dev/null 2>&1; then
  echo "Error: GitHub GraphQL request failed:" >&2
  printf '%s\n' "${GH_OUTPUT}" | head -10 >&2
  exit 1
fi

if [ "${DEBUG}" -eq 1 ]; then
  NULL_COUNT=$(printf '%s' "${GH_OUTPUT}" | jq '[.data.repository | to_entries[] | select(.value == null)] | length')
  [ "${NULL_COUNT}" -gt 0 ] && echo "[debug] Dropped ${NULL_COUNT} non-PR ref(s) (issues or deleted PRs)" >&2
fi

printf '%s' "${GH_OUTPUT}" |
  jq -r '.data.repository | to_entries | sort_by(.value.number // 999999) | .[] | select(.value != null) | "- #\(.value.number) \(.value.title | gsub("[\\r\\n]+"; " ") | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ")) (\(.value.url))"' |
  grep -v '^$' || true
