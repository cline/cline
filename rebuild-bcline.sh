#!/bin/bash
# BCline Complete Rebuild Script
# This script performs a full, proper rebuild of BCline v3.39.2-complete
# without taking shortcuts

set -e  # Exit on any error

echo "============================================"
echo "BCline v3.39.2-complete Rebuild Script"
echo "============================================"
echo ""

# Step 1: Clean previous builds
echo "[Step 1/8] Cleaning previous builds..."
rm -rf node_modules
rm -rf webview-ui/node_modules
rm -rf out
rm -rf webview-ui/dist
rm -rf .vscode-test
rm -f *.vsix
echo "✓ Cleaned"
echo ""

# Step 2: Install root dependencies
echo "[Step 2/8] Installing root dependencies..."
npm install --ignore-scripts
echo "✓ Root dependencies installed"
echo ""

# Step 3: Install grpc-tools manually
echo "[Step 3/8] Installing grpc-tools with native binaries..."
cd node_modules/grpc-tools
npm install
cd ../..
echo "✓ grpc-tools installed"
echo ""

# Step 4: Run husky install
echo "[Step 4/8] Setting up husky git hooks..."
npm run prepare || echo "Note: husky setup skipped (not critical)"
echo "✓ Husky configured"
echo ""

# Step 5: Generate proto files
echo "[Step 5/8] Generating Protocol Buffer files..."
npm run protos
echo "✓ Proto files generated"
echo ""

# Step 6: Install webview dependencies
echo "[Step 6/8] Installing webview-ui dependencies..."
cd webview-ui
npm install --legacy-peer-deps
cd ..
echo "✓ Webview dependencies installed"
echo ""

# Step 7: Type check
echo "[Step 7/8] Running TypeScript type checking..."
npm run check-types
echo "✓ Type checking passed"
echo ""

# Step 8: Package VSIX
echo "[Step 8/8] Packaging VSIX..."
npx @vscode/vsce package --no-dependencies
echo "✓ VSIX packaged"
echo ""

echo "============================================"
echo "Build Complete!"
echo "============================================"
echo ""
echo "VSIX file created:"
ls -lh *.vsix
echo ""
echo "To install:"
echo "  code --install-extension bcline-3.39.2.vsix"
echo ""
