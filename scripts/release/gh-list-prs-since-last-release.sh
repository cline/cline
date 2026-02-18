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
Usage: scripts/gh-list-prs-since-last-release.sh [--from-tag <tag>] [--base <ref>]

Options:
  --from-tag <tag>  Override the autodetected latest vX.Y.Z tag.
  --base <ref>      Base branch to compare against (default: main).

Requires: git, gh (authenticated), jq
USAGE
}

BASE_REF="main"
FROM_TAG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --from-tag)
      FROM_TAG="${2-}"
      shift 2
      ;;
    --base)
      BASE_REF="${2-}"
      shift 2
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
  awk '{printf "pr%s: pullRequest(number: %s) { number title url } ", $1, $1}')

# gh exits 1 when GitHub returns partial results alongside an errors array
# (e.g. a merge commit subject references an issue number, not a PR).
# The data is still valid — jq's select(.value != null) already drops the nulls.
gh api graphql \
  -f query="query { repository(owner: \"${OWNER}\", name: \"${NAME}\") { ${QUERY_BODY} }}" 2>/dev/null |
  jq -r '.data.repository | to_entries | sort_by(.value.number // 999999) | .[] | select(.value != null) | "- #\(.value.number) \(.value.title | gsub("[\\r\\n]+"; " ") | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ")) (\(.value.url))"' |
  grep -v '^$' || true
