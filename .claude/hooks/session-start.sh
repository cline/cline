#!/bin/bash
set -euo pipefail

# Only run in Claude Code remote environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

echo "Installing dependencies..."

# Install root and webview-ui dependencies
npm run install:all

# Generate gRPC/protobuf types (required for TypeScript)
echo "Generating proto types..."
npm run protos

echo "Session setup complete!"
