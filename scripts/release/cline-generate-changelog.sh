#!/usr/bin/env bash

# Generates a formatted changelog for the next release by:
#   1. Gathering merged PRs since the last release via gh-list-prs-since-last-release.sh
#   2. Identifying first-time contributor PRs via gh-first-time-contributors.sh
#   3. Passing both datasets to cline for synthesis into a consistently formatted changelog
#
# Use --scope to target either the VSCode extension (CHANGELOG.md) or the CLI (cli/CHANGELOG.md).
#
# Model: defaults to claude-opus-4-6; override with --model.
# Provider: whichever provider is currently selected in your cline configuration will be used.
#   To change provider, run `cline auth` first.
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
Usage: scripts/release/cline-generate-changelog.sh --scope <vscode|cli> [--model <model>] [--from-tag <tag>] [--debug]

Options:
  --scope <vscode|cli>  Required. Target product surface:
                          vscode  Generate entries for CHANGELOG.md (VS Code extension)
                          cli     Generate entries for cli/CHANGELOG.md (Cline CLI)
  --model <model>       Model to pass to cline (default: claude-opus-4-6).
  --from-tag <tag>      Override the autodetected latest vX.Y.Z tag.
  --debug               Print debug stats to stderr.

Requires: git, gh (authenticated), jq, cline (authenticated)
USAGE
}

SCOPE=""
MODEL="claude-opus-4-6"
FROM_TAG_ARG=""
DEBUG=0

while [ $# -gt 0 ]; do
  case "$1" in
    --scope)
      SCOPE="${2-}"
      shift 2
      ;;
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

if [ -z "${SCOPE}" ]; then
  echo "Error: --scope <vscode|cli> is required." >&2
  usage >&2
  exit 2
fi

if [ "${SCOPE}" != "vscode" ] && [ "${SCOPE}" != "cli" ]; then
  echo "Error: --scope must be 'vscode' or 'cli' (got '${SCOPE}')." >&2
  usage >&2
  exit 2
fi

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

# ---------------------------------------------------------------------------
# Scope-specific context inserted into the prompt
# ---------------------------------------------------------------------------

if [ "${SCOPE}" = "vscode" ]; then
  SCOPE_CONTEXT="This changelog is for the Cline VS Code extension (CHANGELOG.md), not the CLI.

Focus on changes that affect the extension experience:
- New AI provider integrations or model support
- Webview UI improvements (chat interface, settings panel, history view)
- MCP (Model Context Protocol) server integration and tooling
- Plan/Act mode, context window management, and checkpoints
- Task execution capabilities: file editing, browser automation, terminal, tool use
- Extension commands, settings, and keyboard shortcuts
- Core agent behavior and system prompt improvements

Exclude changes that only affect the CLI (cli/ directory) or are purely internal (CI, build tooling, test infrastructure, dependency bumps) with no user-visible impact."

  CHANGELOG_FILE="CHANGELOG.md"
else
  SCOPE_CONTEXT="This changelog is for the Cline CLI (cli/CHANGELOG.md), not the VS Code extension.

Focus on changes that affect the CLI experience:
- CLI commands and options (cline task, cline auth, cline config, cline history, etc.)
- Terminal UI components (model picker, settings panel, auth flows)
- ACP (Agent Client Protocol) integration
- Provider authentication and configuration within the CLI
- CLI-specific behavior, flags, and output formatting

Exclude changes that only affect the VS Code extension (webview-ui/, VS Code API integrations, extension-only settings) or are purely internal (CI, build tooling, test infrastructure, dependency bumps) with no user-visible impact. Include changes to shared core code (src/) only if they meaningfully affect CLI behavior."

  CHANGELOG_FILE="cli/CHANGELOG.md"
fi

# ---------------------------------------------------------------------------
# Build prompt
# ---------------------------------------------------------------------------

PROMPT="You are acting as a technical writer generating a changelog. All the data you need is already in this prompt — do not use any tools, do not read any files, do not fetch any URLs. Simply read the data below and write the changelog.

You have been provided with two datasets to help generate a changelog for the next release of this repository.

## Merged PRs since last release

${PR_LIST}

## First-time contributor PRs in this release

${FIRST_TIME_PRS:-"(none)"}

## Your task

${SCOPE_CONTEXT}

Generate a concise, human-readable changelog suitable for inclusion in ${CHANGELOG_FILE}.

Format requirements:
- Use exactly four sections in this order: Added, Fixed, Changed, New Contributors.
- Each of Added, Fixed, and Changed contains plain-language bullet points. Write from the perspective of a user of the product surface described above — what did they gain, what got fixed, what changed for them.
- If two or more entries naturally combine into a single more general statement, merge them into one bullet point.
- The New Contributors section lists each first-time contributor as: - @<login> made their first contribution in #<number> (<url>)
- Omit any section that has no entries.
- Output only the changelog — no preamble, no explanation, no markdown code fences."

# ---------------------------------------------------------------------------
# Invoke cline
# ---------------------------------------------------------------------------

echo "Generating ${SCOPE} changelog with cline (model: ${MODEL})..." >&2
echo "" >&2

RAW_OUTPUT=$(cline -a -y --timeout 120 -m "${MODEL}" "${PROMPT}")
CHANGELOG=$(echo "${RAW_OUTPUT}" | sed -n '/^## /,$p')

if [ -z "${CHANGELOG}" ]; then
  if [ -z "${RAW_OUTPUT}" ]; then
    echo "(No output from cline — the task may have timed out or the model may be unavailable.)" >&2
  else
    echo "(No ${SCOPE}-relevant changes found in this release.)" >&2
    if [ "${DEBUG}" -eq 1 ]; then
      echo "" >&2
      echo "[debug] Raw cline output (no '## ' section headers found):" >&2
      echo "${RAW_OUTPUT}" >&2
    else
      echo "[hint] Run with --debug to see the raw cline output." >&2
    fi
  fi
else
  echo "${CHANGELOG}"
fi
