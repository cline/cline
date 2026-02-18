#!/usr/bin/env bash

# Generates a formatted changelog for the next release by:
#   1. Gathering merged PRs since the last release via gh-list-prs-since-last-release.sh
#   2. Identifying first-time contributor PRs via gh-first-time-contributors.sh
#   3. Passing both datasets to cline for synthesis into a consistently formatted changelog
#
# Use --scope to target either the VSCode extension (CHANGELOG.md) or the CLI (cli/CHANGELOG.md).
#
# Model: defaults to claude-sonnet-4-6; override with --model.
# Provider: whichever provider is currently selected in your cline configuration will be used.
#   To change provider, run `cline auth` first.
#
# Output sections (any empty section is omitted):
#   Added / Fixed / Changed / New Contributors
#
# Note: This script uses `git tag --list` to autodetect the latest release tag. In shallow
# clones (e.g., GitHub Actions with fetch-depth: 1), tags may be missing. Run
# `git fetch --tags` before invoking this script in CI environments.
#
# Requires:
#   - git (with full tag history — run `git fetch --tags` first if in a shallow clone)
#   - gh (authenticated)
#   - jq
#   - cline (authenticated)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'USAGE'
Usage: scripts/release/cline-generate-changelog.sh --scope <vscode|cli> [--model <model>] [--from-tag <tag>] [--to-tag <tag>] [--timeout <seconds>] [--debug]

Options:
  --scope <vscode|cli>  Required. Target product surface:
                          vscode  Generate entries for CHANGELOG.md (VS Code extension)
                          cli     Generate entries for cli/CHANGELOG.md (Cline CLI)
  --model <model>       Model to pass to cline (default: claude-sonnet-4-6).
  --from-tag <tag>      Start of the range (default: latest vX.Y.Z tag).
  --to-tag <tag>        End of the range (default: HEAD of main). Use this to
                          generate a changelog for a past release window.
  --timeout <seconds>   Timeout in seconds for the cline task (default: 120).
                          Must be a positive integer.
  --debug               Print debug stats to stderr.

Requires: git, gh (authenticated), jq, cline (authenticated)
USAGE
}

SCOPE=""
MODEL="claude-sonnet-4-6"
FROM_TAG_ARG=""
TO_TAG_ARG=""
TIMEOUT=120
DEBUG=0

while [ $# -gt 0 ]; do
  case "$1" in
    --scope)
      [ -z "${2-}" ] && { echo "Error: --scope requires a value." >&2; usage >&2; exit 2; }
      SCOPE="$2"
      shift 2
      ;;
    --model)
      [ -z "${2-}" ] && { echo "Error: --model requires a value." >&2; usage >&2; exit 2; }
      MODEL="$2"
      shift 2
      ;;
    --from-tag)
      [ -z "${2-}" ] && { echo "Error: --from-tag requires a value." >&2; usage >&2; exit 2; }
      FROM_TAG_ARG="$2"
      shift 2
      ;;
    --to-tag)
      [ -z "${2-}" ] && { echo "Error: --to-tag requires a value." >&2; usage >&2; exit 2; }
      TO_TAG_ARG="$2"
      shift 2
      ;;
    --timeout)
      [ -z "${2-}" ] && { echo "Error: --timeout requires a value." >&2; usage >&2; exit 2; }
      TIMEOUT="$2"
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

# Validate --scope
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

# Validate --timeout is a positive integer
if ! printf '%s' "${TIMEOUT}" | grep -Eq '^[1-9][0-9]*$'; then
  echo "Error: --timeout must be a positive integer (got '${TIMEOUT}')." >&2
  usage >&2
  exit 2
fi

for cmd in git gh jq cline; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Error: ${cmd} is required." >&2
    exit 1
  fi
done

# Build argument arrays for sub-scripts to avoid word-splitting on values
tag_args=()
[ -n "${FROM_TAG_ARG}" ] && tag_args+=("--from-tag" "${FROM_TAG_ARG}")

# --to-tag is passed as --to-tag to the PR lister (upper bound on the git range)
# and as --base to the first-time contributors script (which uses --base as its
# single-window upper bound; --to-tag there triggers multi-window iteration instead).
to_tag_args_pr=()
to_tag_args_ftc=()
if [ -n "${TO_TAG_ARG}" ]; then
  to_tag_args_pr+=("--to-tag" "${TO_TAG_ARG}")
  to_tag_args_ftc+=("--base" "${TO_TAG_ARG}")
fi

debug_args=()
[ "${DEBUG}" -eq 1 ] && debug_args+=("--debug")

echo "Gathering PR list..." >&2
if ! PR_LIST=$("${SCRIPT_DIR}/gh-list-prs-since-last-release.sh" \
    ${tag_args[@]+"${tag_args[@]}"} \
    ${to_tag_args_pr[@]+"${to_tag_args_pr[@]}"} \
    ${debug_args[@]+"${debug_args[@]}"}); then
  echo "Error: Failed to gather PR list (see above for details)." >&2
  exit 1
fi

echo "Gathering first-time contributor PRs..." >&2
if ! FIRST_TIME_PRS=$("${SCRIPT_DIR}/gh-first-time-contributors.sh" \
    ${tag_args[@]+"${tag_args[@]}"} \
    ${to_tag_args_ftc[@]+"${to_tag_args_ftc[@]}"} \
    ${debug_args[@]+"${debug_args[@]}"}); then
  echo "Warning: Could not gather first-time contributor data; continuing without it." >&2
  FIRST_TIME_PRS=""
fi

if [ -z "${PR_LIST}" ]; then
  echo "(No PR references found since last release — nothing to generate.)" >&2
  exit 0
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
- Each section header must be exactly: ## Added, ## Fixed, ## Changed, ## New Contributors (two hash characters, a space, then the section name — no other formatting).
- Each of Added, Fixed, and Changed contains plain-language bullet points. Write from the perspective of a user of the product surface described above — what did they gain, what got fixed, what changed for them.
- If two or more entries naturally combine into a single more general statement, merge them into one bullet point.
- The New Contributors section lists each first-time contributor as: - @<login> made their first contribution in #<number> (<url>)
- Omit any section that has no entries.
- Output only the changelog — no preamble, no explanation, no markdown code fences."

# ---------------------------------------------------------------------------
# Invoke cline
#
# We use `-- "${PROMPT}"` to prevent the prompt being interpreted as a flag
# in the unlikely event it begins with a hyphen.
#
# stderr is captured to a temp file so we can surface it on failure with
# a clear error message, rather than letting it disappear or conflate with
# the structured changelog output.
# ---------------------------------------------------------------------------

CLINE_STDERR_FILE=$(mktemp)
trap 'rm -f "${CLINE_STDERR_FILE}"' EXIT

echo "Generating ${SCOPE} changelog with cline (model: ${MODEL}, timeout: ${TIMEOUT}s)..." >&2
echo "" >&2

CLINE_EXIT=0
RAW_OUTPUT=$(cline -a -y --timeout "${TIMEOUT}" -m "${MODEL}" -- "${PROMPT}" \
  2>"${CLINE_STDERR_FILE}") || CLINE_EXIT=$?

if [ "${CLINE_EXIT}" -ne 0 ]; then
  echo "Error: cline exited with code ${CLINE_EXIT}." >&2
  if [ -s "${CLINE_STDERR_FILE}" ]; then
    echo "--- cline stderr ---" >&2
    cat "${CLINE_STDERR_FILE}" >&2
    echo "--------------------" >&2
  fi
  echo "Possible causes: task timeout, auth expiry, or model unavailable." >&2
  echo "Run 'cline auth' to verify authentication and try again." >&2
  exit 1
fi

# Strip any markdown code fences a model may have wrapped the output in,
# then extract from the first *known* changelog section header to end.
#
# We anchor on the explicit section names (Added / Fixed / Changed / New Contributors)
# rather than any "## " line to avoid incorrectly anchoring on preamble headings
# the model may emit before the actual changelog content.
CHANGELOG=$(printf '%s\n' "${RAW_OUTPUT}" \
  | sed '/^```/d' \
  | sed -n '/^## \(Added\|Fixed\|Changed\|New Contributors\)/,$p')

if [ -z "${CHANGELOG}" ]; then
  if [ -z "${RAW_OUTPUT}" ]; then
    echo "(No output from cline — the task may have timed out or the model may be unavailable.)" >&2
  else
    echo "(No ${SCOPE}-relevant changes found in this release.)" >&2
    if [ "${DEBUG}" -eq 1 ]; then
      echo "" >&2
      echo "[debug] Raw cline output (no known section headers found):" >&2
      printf '%s\n' "${RAW_OUTPUT}" >&2
    else
      echo "[hint] Run with --debug to see the raw cline output." >&2
    fi
  fi
else
  printf '%s\n' "${CHANGELOG}"
fi
