#!/bin/bash

# Development Installation Script for Cline with Hook System
# This script builds and installs the development version in VS Code

set -e  # Exit on error

echo "🚀 Cline Development Installation Script"
echo "========================================"

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed. Aborting." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "❌ npm is required but not installed. Aborting." >&2; exit 1; }
command -v code >/dev/null 2>&1 || { echo "❌ VS Code CLI is required but not installed. Aborting." >&2; exit 1; }

echo "✅ Prerequisites checked"

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "📁 Working directory: $SCRIPT_DIR"

# Clean previous builds
echo ""
echo "🧹 Cleaning previous builds..."
rm -f *.vsix
npm run clean:build 2>/dev/null || true

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm run install:all

# Build webview
echo ""
echo "🔨 Building webview UI..."
npm run build:webview

# Package extension
echo ""
echo "📦 Packaging extension..."
npx vsce package --allow-package-secrets sendgrid

# Find the generated VSIX file
VSIX_FILE=$(ls -1 *.vsix 2>/dev/null | head -n 1)

if [ -z "$VSIX_FILE" ]; then
    echo "❌ Failed to create VSIX file"
    exit 1
fi

echo "✅ Built: $VSIX_FILE"

# Check if production Cline is installed
if code --list-extensions | grep -q "saoudrizwan.claude-dev"; then
    echo ""
    echo "⚠️  Production Cline detected. It will be disabled to avoid conflicts."
    read -p "Continue? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 0
    fi
    code --disable-extension saoudrizwan.claude-dev
fi

# Install the extension
echo ""
echo "📦 Installing extension in VS Code..."
code --install-extension "$VSIX_FILE" --force

# Set up test hooks if not already configured
if [ ! -f ".cline/settings.json" ]; then
    echo ""
    echo "⚙️  Setting up test hooks configuration..."
    mkdir -p .cline
    cat > .cline/settings.json << 'EOF'
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /Users/griever/Developer/cline/test-hooks/simple-logger.js",
        "timeout": 60
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /Users/griever/Developer/cline/test-hooks/simple-logger.js",
        "timeout": 60
      }]
    }],
    "UserPromptSubmit": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /Users/griever/Developer/cline/test-hooks/simple-logger.js",
        "timeout": 60
      }]
    }],
    "SessionStart": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "node /Users/griever/Developer/cline/test-hooks/simple-logger.js",
        "timeout": 60
      }]
    }]
  }
}
EOF
    echo "✅ Test hooks configured"
fi

# Test hooks
echo ""
echo "🧪 Testing hook system..."
if node test-hooks/test-hook-events.js > /dev/null 2>&1; then
    echo "✅ Hook tests passed"
else
    echo "⚠️  Hook tests failed (non-critical)"
fi

echo ""
echo "========================================="
echo "✅ Installation Complete!"
echo ""
echo "Next steps:"
echo "1. Reload VS Code (Cmd+R or restart)"
echo "2. Open Cline (Cmd+Shift+P → 'Cline: Open')"
echo "3. Test a simple task to verify hooks"
echo ""
echo "Monitor hooks:"
echo "  tail -f /tmp/cline-hook-test.log"
echo ""
echo "Troubleshooting:"
echo "  View → Output → Extension Host (for errors)"
echo ""
echo "To uninstall development version:"
echo "  code --uninstall-extension saoudrizwan.claude-dev"
echo "========================================="