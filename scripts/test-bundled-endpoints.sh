#!/bin/bash
set -euo pipefail

# Test script to build VSIX and CLI packages with bundled staging endpoints
# This demonstrates the complete workflow for enterprise distribution

echo "🔨 Cline Bundled Endpoints Build & Test Script"
echo "==============================================="
echo ""

# Configuration
STAGING_CONFIG=$(cat <<'EOF'
{
  "appBaseUrl": "https://staging-app.cline.bot",
  "apiBaseUrl": "https://core-api.staging.int.cline.bot",
  "mcpBaseUrl": "https://core-api.staging.int.cline.bot/v1/mcp"
}
EOF
)

# Output directory for built packages
OUTPUT_DIR="./dist-bundled"
mkdir -p "$OUTPUT_DIR"

echo "📁 Output directory: $OUTPUT_DIR"
echo ""

# Create temp directory for intermediate artifacts
TEST_DIR=$(mktemp -d)
trap "rm -rf $TEST_DIR" EXIT

echo "📁 Temp directory: $TEST_DIR"
echo ""

# Step 1: Clean up existing binaries
echo "1️⃣  Cleaning up existing binaries..."
rm -f ./*.vsix
rm -f ./cli/*.tgz
echo "✓ Removed old VSIX and TGZ files"
echo ""

# Step 2: Create staging endpoints.json
echo "2️⃣  Creating staging endpoints.json..."
echo "$STAGING_CONFIG" > "$TEST_DIR/endpoints-staging.json"
echo "✓ Created $TEST_DIR/endpoints-staging.json"
cat "$TEST_DIR/endpoints-staging.json"
echo ""

# Step 3: Build VSIX package
echo "3️⃣  Building VSCode extension (VSIX)..."
echo ""
npx @vscode/vsce package --no-dependencies
echo ""

# Find the newly built VSIX
VSIX_FILE=$(find . -maxdepth 1 -name "*.vsix" -type f | head -n 1)
if [ -z "$VSIX_FILE" ]; then
    echo "❌ Error: VSIX build failed or file not found"
    exit 1
fi

echo "✓ Built VSIX: $VSIX_FILE"
VSIX_BASENAME=$(basename "$VSIX_FILE")
VSIX_NAME="${VSIX_BASENAME%.vsix}"

# Copy original VSIX to output directory
cp "$VSIX_FILE" "$OUTPUT_DIR/"
echo "✓ Copied original to: $OUTPUT_DIR/$VSIX_BASENAME"
echo ""

# Step 4: Build CLI package
echo "4️⃣  Building CLI package (TGZ)..."
echo ""
cd cli
echo "Building CLI code..."
npm run typecheck && yes y | npx tsx esbuild.mts || npx tsx esbuild.mts
echo ""
echo "Packaging CLI..."
npm pack
cd ..
echo ""

# Find the newly built TGZ
TGZ_FILE=$(find ./cli -maxdepth 1 -name "*.tgz" -type f | head -n 1)
if [ -z "$TGZ_FILE" ]; then
    echo "❌ Error: CLI package build failed or file not found"
    exit 1
fi

echo "✓ Built TGZ: $TGZ_FILE"
TGZ_BASENAME=$(basename "$TGZ_FILE")
TGZ_NAME="${TGZ_BASENAME%.tgz}"

# Copy original TGZ to output directory
cp "$TGZ_FILE" "$OUTPUT_DIR/"
echo "✓ Copied original to: $OUTPUT_DIR/$TGZ_BASENAME"
echo ""

# Step 5: Create VSIX with bundled endpoints
echo "5️⃣  Creating VSIX with bundled endpoints..."
OUTPUT_VSIX="$OUTPUT_DIR/${VSIX_NAME}-with-endpoints.vsix"

./scripts/add-endpoints-to-vsix.sh \
    "$VSIX_FILE" \
    "$OUTPUT_VSIX" \
    "$TEST_DIR/endpoints-staging.json"

echo "✓ Created: $OUTPUT_VSIX"
echo ""

# Step 6: Create TGZ with bundled endpoints
echo "6️⃣  Creating TGZ with bundled endpoints..."
OUTPUT_TGZ="$OUTPUT_DIR/${TGZ_NAME}-with-endpoints.tgz"

./scripts/add-endpoints-to-npm.sh \
    "$TGZ_FILE" \
    "$OUTPUT_TGZ" \
    "$TEST_DIR/endpoints-staging.json"

echo "✓ Created: $OUTPUT_TGZ"
echo ""

# Step 7: Verify VSIX bundled file
echo "7️⃣  Verifying bundled endpoints in VSIX..."
TEMP_EXTRACT_VSIX="$TEST_DIR/extracted-vsix"
mkdir -p "$TEMP_EXTRACT_VSIX"
unzip -q "$OUTPUT_VSIX" -d "$TEMP_EXTRACT_VSIX"

if [ -f "$TEMP_EXTRACT_VSIX/extension/endpoints.json" ]; then
    echo "✓ Found extension/endpoints.json in VSIX"
else
    echo "❌ Error: endpoints.json not found in VSIX"
    exit 1
fi
echo ""

# Step 8: Verify TGZ bundled file
echo "8️⃣  Verifying bundled endpoints in TGZ..."
TEMP_EXTRACT_TGZ="$TEST_DIR/extracted-tgz"
mkdir -p "$TEMP_EXTRACT_TGZ"
tar -xzf "$OUTPUT_TGZ" -C "$TEMP_EXTRACT_TGZ"

if [ -f "$TEMP_EXTRACT_TGZ/package/endpoints.json" ]; then
    echo "✓ Found package/endpoints.json in TGZ"
    echo ""
    echo "📄 TGZ Contents:"
    cat "$TEMP_EXTRACT_TGZ/package/endpoints.json" | jq .
    echo ""
else
    echo "❌ Error: endpoints.json not found in TGZ"
    exit 1
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Build complete!"
echo ""
ls -lh "$OUTPUT_DIR" | grep -E '\.(vsix|tgz)$' || true
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Installation Commands:"
echo ""
echo "# VSCode Extension (original)"
echo "code --uninstall-extension saoudrizwan.claude-dev"
echo "code --install-extension $OUTPUT_DIR/$VSIX_BASENAME"
echo ""
echo "# VSCode Extension (with bundled endpoints)"
echo "code --uninstall-extension saoudrizwan.claude-dev"
echo "code --install-extension $OUTPUT_DIR/${VSIX_NAME}-with-endpoints.vsix"
echo ""
echo "# CLI (original)"
echo "npm uninstall -g cline"
echo "npm install -g $OUTPUT_DIR/$TGZ_BASENAME"
echo ""
echo "# CLI (with bundled endpoints)"
echo "npm uninstall -g cline"
echo "npm install -g $OUTPUT_DIR/${TGZ_NAME}-with-endpoints.tgz"
echo ""
