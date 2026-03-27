#!/usr/bin/env bash
# setup-shannon.sh - Install or update Shannon pentester
# Usage: bash scripts/setup-shannon.sh [SHANNON_HOME]
set -euo pipefail

SHANNON_HOME="${1:-${SHANNON_HOME:-$HOME/shannon}}"

echo "🔐 Shannon Setup"
echo "━━━━━━━━━━━━━━━━"

# Check Docker
if ! command -v docker &>/dev/null; then
  echo "❌ Docker is required but not installed."
  echo "   Install: https://docker.com/products/docker-desktop"
  exit 1
fi
echo "✅ Docker: $(docker --version 2>/dev/null | head -1)"

# Check git
if ! command -v git &>/dev/null; then
  echo "❌ Git is required but not installed."
  exit 1
fi
echo "✅ Git: $(git --version)"

# Clone or update Shannon
if [ -d "$SHANNON_HOME" ] && [ -f "$SHANNON_HOME/shannon" ]; then
  echo "✅ Shannon found at $SHANNON_HOME"
  echo "   Updating..."
  cd "$SHANNON_HOME" && git pull --ff-only 2>/dev/null || echo "   (already up to date or can't fast-forward)"
else
  echo "📥 Cloning Shannon to $SHANNON_HOME..."
  git clone https://github.com/KeygraphHQ/shannon.git "$SHANNON_HOME"
  echo "✅ Shannon cloned successfully"
fi

# Check API credentials
echo ""
echo "API Credentials:"
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "✅ ANTHROPIC_API_KEY is set"
elif [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  echo "✅ CLAUDE_CODE_OAUTH_TOKEN is set"
elif [ "${CLAUDE_CODE_USE_BEDROCK:-}" = "1" ]; then
  echo "✅ AWS Bedrock mode enabled"
elif [ "${CLAUDE_CODE_USE_VERTEX:-}" = "1" ]; then
  echo "✅ Google Vertex AI mode enabled"
else
  echo "⚠️  No AI credentials detected. Set one of:"
  echo "   export ANTHROPIC_API_KEY=sk-ant-..."
  echo "   export CLAUDE_CODE_OAUTH_TOKEN=..."
  echo "   export CLAUDE_CODE_USE_BEDROCK=1"
  echo "   export CLAUDE_CODE_USE_VERTEX=1"
fi

echo ""
echo "Recommended: export CLAUDE_CODE_MAX_OUTPUT_TOKENS=64000"
echo ""
echo "Shannon is ready at: $SHANNON_HOME"
echo "Run a pentest:  cd $SHANNON_HOME && ./shannon start URL=http://localhost:3000 REPO=myapp"
