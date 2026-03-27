#!/usr/bin/env bash
# sync.sh - Deploy shannon skill to all host locations
# Usage: bash scripts/sync.sh  (run from repo root)
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
echo "Source: $SRC"

TARGETS=(
  "$HOME/.claude/skills/shannon"
  "$HOME/.agents/skills/shannon"
  "$HOME/.codex/skills/shannon"
)

for t in "${TARGETS[@]}"; do
  echo ""
  echo "--- Syncing to $t ---"
  mkdir -p "$t/scripts"

  cp "$SRC/SKILL.md" "$t/"

  # Helper scripts
  if ls "$SRC/scripts/"*.sh &>/dev/null; then
    rsync -a "$SRC/scripts/"*.sh "$t/scripts/"
  fi

  echo "  Deployed to $t"
done

echo ""
echo "Sync complete."
