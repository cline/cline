#!/bin/bash
# Build CLI release for a specific ref/commit using GitHub Actions
# 
# Usage:
#   ./scripts/build-cli-artifact.sh [ref] [pr_number]
#
# Examples:
#   ./scripts/build-cli-artifact.sh                    # Build from current branch
#   ./scripts/build-cli-artifact.sh main               # Build from main branch
#   ./scripts/build-cli-artifact.sh abc123             # Build from commit abc123
#   ./scripts/build-cli-artifact.sh feature/new 1234   # Build from branch and comment on PR #1234

set -e

REF="${1:-$(git rev-parse --abbrev-ref HEAD)}"
PR_NUMBER="${2:-}"

echo "🚀 Triggering CLI build workflow..."
echo "   Branch/commit: $REF"

# Build args array
ARGS=(-f "ref=$REF")

if [ -n "$PR_NUMBER" ]; then
  ARGS+=(-f "pr_number=$PR_NUMBER")
  echo "   Will comment on PR #$PR_NUMBER"
fi

# Trigger the workflow
gh workflow run pack-cli.yml "${ARGS[@]}"

echo ""
echo "✅ Workflow triggered!"
echo ""
echo "The workflow will create a GitHub Release with a public download URL."
echo ""
echo "To monitor the workflow:"
echo "  gh run list --workflow=pack-cli.yml --limit 5"
echo ""
echo "Once complete, find the release:"
echo "  gh release list --limit 10"
echo ""
echo "Install from the release URL (no authentication required):"
echo "  npm install -g https://github.com/cline/cline/releases/download/cli-build-<commit>/cline-<version>.tgz"
