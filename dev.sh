#!/bin/bash

# Cline Development Helper Script
# This script provides quick commands for common development tasks

case "$1" in
    "start")
        echo "🚀 Starting development mode with watch..."
        npm run watch
        ;;
    "build")
        echo "🔨 Building extension..."
        npm run compile
        ;;
    "package")
        echo "📦 Creating production package..."
        npm run package
        ;;
    "test")
        echo "🧪 Running tests..."
        npm run test
        ;;
    "lint")
        echo "🔍 Linting code..."
        npm run lint
        ;;
    "fix")
        echo "🔧 Fixing code formatting..."
        npm run format:fix
        ;;
    "clean")
        echo "🧹 Cleaning build artifacts..."
        rm -rf dist/ webview-ui/build/ node_modules/.cache/
        echo "Clean complete!"
        ;;
    "setup")
        echo "⚙️  Setting up development environment..."
        npm run install:all
        npm run package
        echo "Setup complete! Run './dev.sh start' to begin development."
        ;;
    "vsix")
        echo "📦 Creating VSIX package..."
        npx vsce package
        echo "VSIX package created! Install with: code --install-extension claude-dev-*.vsix"
        ;;
    *)
        echo "🛠️  Cline Development Helper"
        echo ""
        echo "Usage: ./dev.sh [command]"
        echo ""
        echo "Commands:"
        echo "  start    - Start development with watch mode"
        echo "  build    - Build the extension"
        echo "  package  - Create production package"
        echo "  test     - Run tests"
        echo "  lint     - Lint code"
        echo "  fix      - Fix code formatting"
        echo "  clean    - Clean build artifacts"
        echo "  setup    - Full setup (install deps + build)"
        echo "  vsix     - Create VSIX package for installation"
        echo ""
        echo "Example: ./dev.sh start"
        ;;
esac
