#!/bin/bash
# Test script for install.sh
# This validates the install script without actually running it

set -e

echo "Testing install.sh script..."
echo ""

# Test 1: Script syntax
echo "Test 1: Script Syntax Verification"
if bash -n scripts/install.sh; then
    echo "  ✅ PASS: Script syntax is valid"
else
    echo "  ❌ FAIL: Script has syntax errors"
    exit 1
fi
echo ""

# Test 2: Check for required functions
echo "Test 2: Required Functions Check"
required_functions=(
    "detect_platform"
    "print_message"
    "error_exit"
    "command_exists"
    "check_prerequisites"
    "get_download_url"
    "install_cline"
    "configure_path"
    "verify_installation"
    "print_success"
    "main"
)

for func in "${required_functions[@]}"; do
    if grep -q "^$func()" scripts/install.sh || grep -q "^${func} ()" scripts/install.sh; then
        echo "  ✅ PASS: Function '$func' exists"
    else
        echo "  ❌ FAIL: Function '$func' not found"
        exit 1
    fi
done
echo ""

# Test 3: Check for required variables
echo "Test 3: Required Variables Check"
required_vars=(
    "INSTALL_DIR"
    "GITHUB_REPO"
    "RELEASE_TAG"
)

for var in "${required_vars[@]}"; do
    if grep -q "$var=" scripts/install.sh; then
        echo "  ✅ PASS: Variable '$var' is defined"
    else
        echo "  ❌ FAIL: Variable '$var' not found"
        exit 1
    fi
done
echo ""

# Test 4: Check for platform support
echo "Test 4: Platform Support Check"
platforms=("darwin-x64" "darwin-arm64" "linux-x64")
for platform in "${platforms[@]}"; do
    if grep -q "$platform" scripts/install.sh; then
        echo "  ✅ PASS: Platform '$platform' supported"
    else
        echo "  ❌ FAIL: Platform '$platform' not found"
        exit 1
    fi
done
echo ""

# Test 5: Check for error handling
echo "Test 5: Error Handling Check"
if grep -q "error_exit" scripts/install.sh && grep -q "set -e" scripts/install.sh; then
    echo "  ✅ PASS: Error handling present"
else
    echo "  ❌ FAIL: Error handling missing"
    exit 1
fi
echo ""

# Test 6: Check for PATH configuration
echo "Test 6: PATH Configuration Check"
if grep -q "export PATH=" scripts/install.sh; then
    echo "  ✅ PASS: PATH configuration present"
else
    echo "  ❌ FAIL: PATH configuration missing"
    exit 1
fi
echo ""

# Test 7: Check for verification step
echo "Test 7: Installation Verification Check"
if grep -q "verify_installation" scripts/install.sh; then
    echo "  ✅ PASS: Installation verification present"
else
    echo "  ❌ FAIL: Installation verification missing"
    exit 1
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "All tests passed! ✅"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "The install script is ready for use:"
echo "  curl -fsSL https://raw.githubusercontent.com/cline/cline/main/scripts/install.sh | bash"
