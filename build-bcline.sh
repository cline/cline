#!/bin/bash
# BCline Automated Build Script
# Version: 1.0
# Date: December 3, 2025
#
# This script automates the complete build process for BCline
# following the correct procedure documented in CORRECT_BUILD_PROCEDURE.md

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

    # Check branch
    CURRENT_BRANCH=$(git branch --show-current)
    echo "Current branch: $CURRENT_BRANCH"

    print_success "Prerequisites check passed"
    echo ""
}

verify_versions() {
    print_step 0.5 "Verifying Package Versions"

    echo "Root TypeScript version:"
    grep '"typescript":' package.json | head -1

    echo "Webview TypeScript version:"
    grep '"typescript":' webview-ui/package.json | head -1

    echo "Webview Vite version:"
    grep '"vite":' webview-ui/package.json | head -1

    # Check if TypeScript versions match
    ROOT_TS=$(grep '"typescript":' package.json | head -1)
    WEBVIEW_TS=$(grep '"typescript":' webview-ui/package.json | head -1)

    if [ "$ROOT_TS" != "$WEBVIEW_TS" ]; then
        print_warning "TypeScript versions don't match between root and webview"
        print_warning "This may cause issues!"
    fi

    print_success "Version check complete"
    echo ""
}

clean_build() {
    print_step 1 "Cleaning Build Artifacts"

    # Remove node_modules
    echo "Removing node_modules..."
    rm -rf node_modules
    rm -rf webview-ui/node_modules

    # Remove build outputs
    echo "Removing build outputs..."
    rm -rf dist
    rm -rf webview-ui/dist
    rm -rf webview-ui/build
    rm -rf out

    # Remove lock files
    echo "Removing lock files..."
    rm -f package-lock.json
    rm -f webview-ui/package-lock.json

    # Remove generated files
    echo "Removing generated files..."
    rm -rf src/generated
    rm -f webview-ui/src/services/grpc-client.ts

    # Remove old VSIX (but not backups)
    rm -f claude-dev-*.vsix

    print_success "Clean complete"
    echo ""
}

install_root_deps() {
    print_step 2 "Installing Root Dependencies"

    npm install --ignore-scripts

    # Verify installation
    PACKAGE_COUNT=$(ls node_modules/ | wc -l)
    echo "Installed $PACKAGE_COUNT packages"

    if [ "$PACKAGE_COUNT" -lt 300 ]; then
        print_error "Too few packages installed ($PACKAGE_COUNT), expected 400+"
        exit 1
    fi

    print_success "Root dependencies installed"
    echo ""
}

setup_grpc_tools() {
    print_step 3 "Setting up grpc-tools Native Binaries"

    cd node_modules/grpc-tools
    npm install

    # Verify binaries
    if [ ! -f "bin/grpc_tools_node_protoc_plugin.exe" ] && [ ! -f "bin/grpc_tools_node_protoc_plugin" ]; then
        print_error "grpc-tools binaries not found after build"
        cd ../..
        exit 1
    fi

    cd ../..

    print_success "grpc-tools ready"
    echo ""
}

setup_husky() {
    print_step 4 "Setting up Git Hooks (optional)"

    npm run prepare || print_warning "Husky setup skipped (optional)"

    print_success "Git hooks configured"
    echo ""
}

install_webview_deps() {
    print_step 5 "Installing Webview Dependencies"

    cd webview-ui
    npm install --legacy-peer-deps

    # Verify vite installation
    if [ ! -f "node_modules/vite/bin/vite.js" ]; then
        print_error "Vite not installed properly"
        cd ..
        exit 1
    fi

    PACKAGE_COUNT=$(ls node_modules/ | wc -l)
    echo "Installed $PACKAGE_COUNT packages"

    cd ..

    print_success "Webview dependencies installed"
    echo ""
}

generate_protos() {
    print_step 6 "Generating Protocol Buffer Files"

    npm run protos

    # Verify generation
    if [ ! -f "src/generated/hosts/vscode/hostbridge-grpc-service-config.ts" ]; then
        print_error "Proto generation failed - hostbridge config not found"
        exit 1
    fi

    if [ ! -f "webview-ui/src/services/grpc-client.ts" ]; then
        print_error "Proto generation failed - grpc client not found"
        exit 1
    fi

    print_success "Proto files generated"
    echo ""
}

type_check() {
    print_step 7 "Type Checking All Code"

    echo "Checking root types..."
    npx tsc --noEmit

    echo "Checking webview types..."
    cd webview-ui
    npx tsc --noEmit
    cd ..

    print_success "All type checks passed"
    echo ""
}

lint_code() {
    print_step 8 "Linting Code"

    npm run lint

    print_success "Linting passed"
    echo ""
}

build_webview() {
    print_step 9 "Building Webview UI"

    cd webview-ui
    npm run build

    # Verify build output
    if [ ! -f "dist/index.html" ]; then
        print_error "Webview build failed - index.html not found"
        cd ..
        exit 1
    fi

    DIST_SIZE=$(du -sh dist/ | cut -f1)
    echo "Webview bundle size: $DIST_SIZE"

    cd ..

    print_success "Webview built"
    echo ""
}

build_extension() {
    print_step 10 "Building Extension"

    node esbuild.mjs --production

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

package_vsix() {
    print_step 11 "Packaging VSIX"

    npx @vscode/vsce package --no-dependencies

    # Find the created VSIX
    VSIX_FILE=$(ls -t claude-dev-*.vsix 2>/dev/null | head -1)

    if [ -z "$VSIX_FILE" ]; then
        print_error "VSIX packaging failed - no VSIX file created"
        exit 1
    fi

    # Rename to bcline
    NEW_NAME="bcline-3.39.2-complete.vsix"
    mv "$VSIX_FILE" "$NEW_NAME"

    VSIX_SIZE=$(ls -lh "$NEW_NAME" | awk '{print $5}')
    echo "VSIX file: $NEW_NAME"
    echo "VSIX size: $VSIX_SIZE"

    print_success "VSIX packaged successfully"
    echo ""
}

verify_build() {
    print_step 12 "Verifying Build"

    VSIX_FILE="bcline-3.39.2-complete.vsix"

    # Check VSIX exists
    if [ ! -f "$VSIX_FILE" ]; then
        print_error "VSIX file not found"
        exit 1
    fi

    # Check file count
    FILE_COUNT=$(unzip -l "$VSIX_FILE" | wc -l)
    echo "Total files in VSIX: $FILE_COUNT"

    if [ "$FILE_COUNT" -lt 3000 ]; then
        print_warning "File count seems low ($FILE_COUNT), expected 3000+"
    fi

    # Check key files
    echo "Verifying key files..."
    unzip -t "$VSIX_FILE" extension/dist/extension.js > /dev/null 2>&1 || {
        print_error "extension.js not found in VSIX"
        exit 1
    }

    unzip -t "$VSIX_FILE" extension/webview-ui/build/index.html > /dev/null 2>&1 || {
        print_error "webview index.html not found in VSIX"
        exit 1
    }

    print_success "Build verification complete"
    echo ""
}

print_summary() {
    echo ""
    echo -e "${GREEN}===================================================${NC}"
    echo -e "${GREEN}       BUILD COMPLETED SUCCESSFULLY!${NC}"
    echo -e "${GREEN}===================================================${NC}"
    echo ""
    echo "VSIX File: bcline-3.39.2-complete.vsix"
    ls -lh bcline-3.39.2-complete.vsix
    echo ""
    echo "To install:"
    echo "  1. Open VSCode"
    echo "  2. Go to Extensions (Ctrl+Shift+X)"
    echo "  3. Click '...' menu"
    echo "  4. Select 'Install from VSIX...'"
    echo "  5. Choose bcline-3.39.2-complete.vsix"
    echo ""
    echo "To test messaging system:"
    echo "  powershell.exe -ExecutionPolicy Bypass -File .\\Test-ClineMessaging.ps1"
    echo ""
}

# Main execution
main() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║     BCline Automated Build Script v1.0          ║${NC}"
    echo -e "${BLUE}║     Building: BCline v3.39.2-complete            ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════╝${NC}"
    echo ""

    # Run all steps
    check_prerequisites
    verify_versions

    # Ask for confirmation
    read -p "Continue with full clean build? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Build cancelled"
        exit 0
    fi

    clean_build
    install_root_deps
    setup_grpc_tools
    setup_husky
    install_webview_deps
    generate_protos
    type_check
    lint_code
    build_webview
    build_extension
    package_vsix
    verify_build
    print_summary
}

# Run main
main "$@"
