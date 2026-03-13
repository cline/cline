#!/bin/bash
# BCline Modern Build Script
# Version: 2.0
# Date: January 26, 2026
#
# Builds BCline with original branding (claude-dev/Cline) while including
# all BCline enhancements (messaging, Windows voice fix, etc.)
# Follows strategy in BCLINE_BUILD_STRATEGY.md

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_step() {
    echo -e "${BLUE}===================================================${NC}"
    echo -e "${BLUE}Step $1: $2${NC}"
    echo -e "${BLUE}===================================================${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

check_prerequisites() {
    print_step 0 "Checking Prerequisites"

    # Check Node version
    NODE_VERSION=$(node --version)
    echo "Node.js version: $NODE_VERSION"

    # Extract major version number
    NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
    
    if [ "$NODE_MAJOR" -lt 20 ]; then
        print_error "Node.js v20 or higher required, found $NODE_VERSION"
        exit 1
    fi

    # Check npm
    NPM_VERSION=$(npm --version)
    echo "npm version: $NPM_VERSION"

    # Check if in correct directory
    if [ ! -f "package.json" ]; then
        print_error "Not in BCline root directory (package.json not found)"
        exit 1
    fi

    # Check package.json branding
    PACKAGE_NAME=$(grep '"name"' package.json | head -1 | sed 's/.*: "\(.*\)".*/\1/')
    if [ "$PACKAGE_NAME" != "claude-dev" ]; then
        print_warning "Package name is '$PACKAGE_NAME', should be 'claude-dev' for correct bot loading"
    fi

    print_success "Prerequisites check passed"
    echo ""
}

verify_bcline_features() {
    print_step 0.5 "Verifying BCline Features in Source"

    # Check Windows voice fix
    if grep -q 'featureEnabled: true' src/core/controller/index.ts && \
       grep -q 'dictationEnabled: true' src/core/controller/index.ts; then
        print_success "Windows voice fix present in source"
    else
        print_error "Windows voice fix NOT FOUND in src/core/controller/index.ts"
        print_error "Voice dictation will not work on Windows!"
    fi

    # Check MessageQueueService
    if [ -f "src/services/MessageQueueService.ts" ]; then
        print_success "MessageQueueService.ts exists"
    else
        print_error "MessageQueueService.ts not found - messaging system missing!"
    fi

    # Check PowerShell scripts
    PS_SCRIPTS=("Send-ClineMessage.ps1" "Test-ClineMessaging.ps1" "Test-MessagingIntegration.ps1")
    for script in "${PS_SCRIPTS[@]}"; do
        if [ -f "$script" ]; then
            print_success "$script exists"
        else
            print_warning "$script not found (optional)"
        fi
    done

    echo ""
}

clean_build() {
    print_step 1 "Cleaning Build Artifacts"

    # Remove build outputs (keep node_modules for faster rebuilds)
    echo "Removing build outputs..."
    rm -rf dist
    rm -rf webview-ui/dist
    rm -rf webview-ui/build
    rm -rf out
    rm -rf src/generated

    # Remove old VSIX files
    echo "Removing old VSIX files..."
    rm -f claude-dev-*.vsix
    rm -f bcline-*.vsix

    print_success "Clean complete"
    echo ""
}

generate_protos() {
    print_step 2 "Generating Protocol Buffer Files"

    npm run protos

    # Verify generation
    if [ ! -f "src/generated/hosts/vscode/hostbridge-grpc-service-config.ts" ]; then
        print_error "Proto generation failed - hostbridge config not found"
        exit 1
    fi

    print_success "Proto files generated"
    echo ""
}

type_check() {
    print_step 3 "Type Checking All Code"

    npm run check-types

    print_success "All type checks passed"
    echo ""
}

lint_code() {
    print_step 4 "Linting Code"

    npm run lint

    print_success "Linting passed"
    echo ""
}

build_webview() {
    print_step 5 "Building Webview UI"

    npm run build:webview

    # Verify build output
    if [ ! -f "webview-ui/build/index.html" ]; then
        print_error "Webview build failed - index.html not found"
        exit 1
    fi

    print_success "Webview built"
    echo ""
}

build_extension() {
    print_step 6 "Building Extension"

    npm run package

    # Verify build output
    if [ ! -f "dist/extension.js" ]; then
        print_error "Extension build failed - extension.js not found"
        exit 1
    fi

    EXT_SIZE=$(ls -lh dist/extension.js | awk '{print $5}')
    echo "Extension bundle size: $EXT_SIZE"

    print_success "Extension built"
    echo ""
}

verify_vsix() {
    print_step 7 "Verifying VSIX"

    # Find the created VSIX
    VSIX_FILE=$(ls -t claude-dev-*.vsix 2>/dev/null | head -1)

    if [ -z "$VSIX_FILE" ]; then
        print_error "VSIX packaging failed - no claude-dev-*.vsix file created"
        exit 1
    fi

    VSIX_SIZE=$(ls -lh "$VSIX_FILE" | awk '{print $5}')
    echo "VSIX file: $VSIX_FILE"
    echo "VSIX size: $VSIX_SIZE"

    # Check branding
    echo "Verifying branding..."
    if unzip -p "$VSIX_FILE" "extension/package.json" | grep -q '"name": "claude-dev"'; then
        print_success "VSIX has correct name: claude-dev"
    else
        print_error "VSIX has wrong name - should be 'claude-dev'"
    fi

    # Check for BCline features in VSIX
    echo "Checking for BCline features in VSIX..."
    if unzip -p "$VSIX_FILE" "extension/dist/extension.js" | grep -q "MessageQueueService"; then
        print_success "Messaging system included in VSIX"
    else
        print_warning "Messaging system may not be in VSIX"
    fi

    print_success "VSIX verification complete"
    echo ""
}

print_summary() {
    VSIX_FILE=$(ls -t claude-dev-*.vsix 2>/dev/null | head -1)

    echo ""
    echo -e "${GREEN}===================================================${NC}"
    echo -e "${GREEN}       BCline BUILD COMPLETED SUCCESSFULLY!${NC}"
    echo -e "${GREEN}===================================================${NC}"
    echo ""
    echo "VSIX File: $VSIX_FILE"
    ls -lh "$VSIX_FILE"
    echo ""
    echo -e "${YELLOW}IMPORTANT BUILD STRATEGY:${NC}"
    echo "• VSIX keeps original branding: claude-dev/Cline/saoudrizwan"
    echo "• Includes all BCline enhancements (messaging, Windows voice fix)"
    echo "• Replaces/upgrades original Cline extension (same ID)"
    echo "• Bot loads correctly (expects saoudrizwan.claude-dev)"
    echo ""
    echo "To install:"
    echo "  code --install-extension $VSIX_FILE"
    echo ""
    echo "To test BCline features:"
    echo "  1. Windows voice dictation: Check settings"
    echo "  2. Messaging system: powershell.exe -File .\\Test-ClineMessaging.ps1"
    echo ""
    echo "See BCLINE_BUILD_STRATEGY.md for full strategy details."
    echo ""
}

# Main execution
main() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║     BCline Modern Build Script v2.0             ║${NC}"
    echo -e "${BLUE}║     Strategy: Original branding + BCline features║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════╝${NC}"
    echo ""

    # Run all steps
    check_prerequisites
    verify_bcline_features

    # Ask for confirmation
    read -p "Continue with build? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Build cancelled"
        exit 0
    fi

    clean_build
    generate_protos
    type_check
    lint_code
    build_webview
    build_extension
    verify_vsix
    print_summary
}

# Run main
main "$@"