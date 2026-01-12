#!/bin/bash
set -euo pipefail

# Only run in Claude Code remote environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

echo "=== Claude Code for Web Setup ==="
echo ""

# Install latest gh CLI tool
echo "Installing GitHub CLI..."
GH_VERSION=$(curl -s https://api.github.com/repos/cli/cli/releases/latest | grep '"tag_name"' | cut -d'"' -f4 | sed 's/^v//')
curl -sL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" -o /tmp/gh.tar.gz
tar -xzf /tmp/gh.tar.gz -C /tmp
sudo mv "/tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" /usr/local/bin/gh
rm -rf /tmp/gh.tar.gz /tmp/gh_${GH_VERSION}_linux_amd64
echo "Installed gh version: $(gh --version | head -1)"
echo ""

# Check if GITHUB_TOKEN is set and configure gh
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "GITHUB_TOKEN is configured - gh CLI is ready to use"
  echo ""
  echo "You can use gh commands directly, for example:"
  echo "  gh issue list --repo cline/cline --limit 5"
  echo "  gh pr list --repo cline/cline --state open"
  echo "  gh issue view 123 --repo cline/cline"
  echo ""
else
  echo "GITHUB_TOKEN is not set - gh CLI will have limited functionality"
  echo ""
  echo "To enable full GitHub API access:"
  echo "1. Create a Fine-grained Personal Access Token at https://github.com/settings/tokens?type=beta"
  echo "2. Add it as GITHUB_TOKEN in your Claude Code environment settings"
  echo ""
fi

# Install project dependencies
echo "Installing dependencies..."
npm run install:all

# Generate gRPC/protobuf types (required for TypeScript)
echo "Generating proto types..."
npm run protos

echo ""
echo "Session setup complete!"
