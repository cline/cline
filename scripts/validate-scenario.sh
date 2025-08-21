#!/usr/bin/env bash
set -euo pipefail

# Validate a PR-specific scenario exists in src/test/scenarios
# Rules:
#  - example.ts is exempt
#  - Exactly one scenario must match the current PR number
#  - All non-exempt scenario files must include a valid "GitHub PR" metadata line
#
# Usage: ./scripts/validate-scenario.sh &lt;PR_NUMBER&gt;

PR_NUMBER="${1:-}"

SCENARIOS_DIR="src/test/scenarios"
EXEMPT_BASENAMES=("example.ts")

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
yellow(){ printf "\033[33m%s\033[0m\n" "$*"; }

is_exempt() {
  local base="$1"
  for ex in "${EXEMPT_BASENAMES[@]}"; do
    if [[ "$base" == "$ex" ]]; then
      return 0
    fi
  done
  return 1
}

usage() {
  echo "Usage: $0 &lt;PR_NUMBER&gt;" >&2
  exit 2
}

if [[ -z "$PR_NUMBER" ]]; then
  red "Error: PR number is required."
  usage
fi

if ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
  red "Error: PR number must be numeric. Got: '$PR_NUMBER'"
  exit 2
fi

if [[ ! -d "$SCENARIOS_DIR" ]]; then
  red "Error: Scenarios directory not found: $SCENARIOS_DIR"
  exit 1
fi

declare -a ALL_FILES=()
declare -a MISSING_METADATA=()
declare -a MALFORMED_METADATA=()
declare -a FOUND_FILES=()
declare -a FOUND_PRS=()

# Find top-level .ts files in scenarios dir
while IFS= read -r -d '' file; do
  ALL_FILES+=("$file")
done < <(find "$SCENARIOS_DIR" -maxdepth 1 -type f -name "*.ts" -print0 | sort -z)

if [[ ${#ALL_FILES[@]} -eq 0 ]]; then
  red "Error: No scenario files found in $SCENARIOS_DIR"
  exit 1
fi

for file in "${ALL_FILES[@]}"; do
  base="$(basename "$file")"
  if is_exempt "$base"; then
    continue
  fi

  # Extract metadata line, pattern: // GitHub PR - 123
  meta_line="$(grep -E -m1 '^[[:space:]]*//[[:space:]]*GitHub[[:space:]]+PR[[:space:]]*-[[:space:]]*[0-9]+[[:space:]]*$' "$file" || true)"

  if [[ -z "$meta_line" ]]; then
    MISSING_METADATA+=("$file")
    continue
  fi

  pr_in_file="$(sed -E 's@.*GitHub[[:space:]]+PR[[:space:]]*-[[:space:]]*([0-9]+).*@\1@' <<< "$meta_line" | tr -d '[:space:]')"

  if ! [[ "$pr_in_file" =~ ^[0-9]+$ ]]; then
    MALFORMED_METADATA+=("$file")
    continue
  fi

  FOUND_FILES+=("$file")
  FOUND_PRS+=("$pr_in_file")
done

# Fail if any non-exempt file is missing metadata
if [[ ${#MISSING_METADATA[@]} -gt 0 ]]; then
  red "Error: The following scenario files are missing the required metadata line '// GitHub PR - &lt;number&gt;':"
  for f in "${MISSING_METADATA[@]}"; do
    echo " - $f"
  done
  echo
  echo "Please add a metadata line like:"
  echo "  // GitHub PR - $PR_NUMBER"
  exit 1
fi

# Fail if any metadata is malformed
if [[ ${#MALFORMED_METADATA[@]} -gt 0 ]]; then
  red "Error: The following scenario files have a malformed 'GitHub PR' metadata line:"
  for f in "${MALFORMED_METADATA[@]}"; do
    echo " - $f"
  done
  echo
  echo "Expected format:"
  echo "  // GitHub PR - $PR_NUMBER"
  exit 1
fi

# Count matches for this PR
matches=0
declare -a MATCHED_FILES=()
for i in "${!FOUND_FILES[@]}"; do
  if [[ "${FOUND_PRS[$i]}" == "$PR_NUMBER" ]]; then
    matches=$((matches + 1))
    MATCHED_FILES+=("${FOUND_FILES[$i]}")
  fi
done

if [[ $matches -eq 0 ]]; then
  red "Error: No scenario file found for PR #$PR_NUMBER."
  echo "Scenarios with declared PRs:"
  if [[ ${#FOUND_FILES[@]} -eq 0 ]]; then
    echo "  (none)"
  else
    for i in "${!FOUND_FILES[@]}"; do
      echo " - ${FOUND_FILES[$i]}   (PR: ${FOUND_PRS[$i]})"
    done
  fi
  echo
  echo "Please add a scenario in $SCENARIOS_DIR with a metadata line:"
  echo "  // GitHub PR - $PR_NUMBER"
  exit 1
fi

if [[ $matches -gt 1 ]]; then
  red "Error: Multiple scenario files found for PR #$PR_NUMBER (exactly one required):"
  for f in "${MATCHED_FILES[@]}"; do
    echo " - $f"
  done
  exit 1
fi

green "Success: Exactly one scenario found for PR #$PR_NUMBER:"
echo " - ${MATCHED_FILES[0]}"
