#!/usr/bin/env bash

# Generates a formatted changelog for the next release by:
#   1. Gathering merged PRs since the last release via gh-list-prs-since-last-release.sh
#   2. Identifying first-time contributor PRs via gh-first-time-contributors.sh
#   3. Passing both datasets to cline for synthesis into a consistently formatted changelog
#
# Output sections (any empty section is omitted):
#   Added / Fixed / Changed / New Contributors
#
# Requires:
#   - git
#   - gh (authenticated)
#   - jq
#   - cline (authenticated)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'USAGE'
Usage: scripts/gh-generate-changelog.sh [--model <model>] [--from-tag <tag>] [--debug]

Options:
  --model <model>   Model to pass to cline (e.g. claude-opus-4-5).
                    If omitted, cline uses its configured default.
  --from-tag <tag>  Override the autodetected latest vX.Y.Z tag.
  --debug           Print debug stats to stderr.

Requires: git, gh (authenticated), jq, cline (authenticated)
USAGE
}

MODEL=""
FROM_TAG_ARG=""
DEBUG=0

while [ $# -gt 0 ]; do
  case "$1" in
    --model)
      MODEL="${2-}"
      shift 2
      ;;
    --from-tag)
      FROM_TAG_ARG="${2-}"
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

for cmd in gh jq cline; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Error: ${cmd} is required." >&2
    exit 1
  fi
done

TAG_FLAG=""
if [ -n "${FROM_TAG_ARG}" ]; then
  TAG_FLAG="--from-tag ${FROM_TAG_ARG}"
fi

DEBUG_FLAG=""
if [ "${DEBUG}" -eq 1 ]; then
  DEBUG_FLAG="--debug"
fi

echo "Gathering PR list..." >&2
# shellcheck disable=SC2086
PR_LIST=$("${SCRIPT_DIR}/gh-list-prs-since-last-release.sh" ${TAG_FLAG} 2>/dev/null)

echo "Gathering first-time contributor PRs..." >&2
# shellcheck disable=SC2086
FIRST_TIME_PRS=$("${SCRIPT_DIR}/gh-first-time-contributors.sh" ${TAG_FLAG} ${DEBUG_FLAG} 2>/dev/null)

if [ -z "${PR_LIST}" ]; then
  echo "Error: No PRs found since last release." >&2
  exit 1
fi

PROMPT="You have been provided with two datasets to help generate a changelog for the next release of this repository.

## Merged PRs since last release

${PR_LIST}

## First-time contributor PRs in this release

${FIRST_TIME_PRS:-"(none)"}

## Your task

Generate a concise, human-readable changelog for this upcoming release.

Format requirements:
- Use exactly four sections in this order: Added, Fixed, Changed, New Contributors.
- Each of Added, Fixed, and Changed contains plain-language bullet points describing user-facing changes. Omit internal refactors, dependency bumps, CI/tooling changes, and test-only changes unless they have meaningful user impact.
- If two or more entries naturally combine into a single more general statement, merge them into one bullet point.
- The New Contributors section lists each first-time contributor as: - @<login> made their first contribution in #<number> (<url>)
- Omit any section that has no entries.
- Output only the changelog — no preamble, no explanation, no markdown code fences."

MODEL_FLAG=""
if [ -n "${MODEL}" ]; then
  MODEL_FLAG="-m ${MODEL}"
fi

echo "Generating changelog with cline..." >&2
echo "" >&2

# shellcheck disable=SC2086
cline -a -y --timeout 120 ${MODEL_FLAG} "${PROMPT}"
