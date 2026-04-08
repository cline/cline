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
    "print_message"
    "check_prerequisites"
    "check_rate_limit"
    "show_rate_limit_error"
    "get_release_info"
    "check_existing_installation"
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
    "requested_version"
    "FORCE_INSTALL"
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
if grep -q 'darwin)' scripts/install.sh && grep -q 'linux)' scripts/install.sh; then
    echo "  ✅ PASS: Supported operating systems are defined"
else
    echo "  ❌ FAIL: Supported operating systems not found"
    exit 1
fi

if grep -q '"x86_64"' scripts/install.sh && grep -q 'arch="x64"' scripts/install.sh; then
    echo "  ✅ PASS: x86_64 is normalized to x64"
else
    echo "  ❌ FAIL: x86_64 normalization not found"
    exit 1
fi

if grep -q '"aarch64"' scripts/install.sh && grep -q 'arch="arm64"' scripts/install.sh; then
    echo "  ✅ PASS: aarch64 is normalized to arm64"
else
    echo "  ❌ FAIL: aarch64 normalization not found"
    exit 1
fi

if grep -q 'platform="darwin-\$arch"' scripts/install.sh && grep -q 'platform="linux-\$arch"' scripts/install.sh; then
    echo "  ✅ PASS: Platform strings are constructed for macOS and Linux"
else
    echo "  ❌ FAIL: Platform string construction not found"
    exit 1
fi
echo ""

# Test 5: Check for error handling
echo "Test 5: Error Handling Check"
if grep -q "print_error()" scripts/install.sh && grep -q "set -euo pipefail" scripts/install.sh; then
    echo "  ✅ PASS: Error handling present"
else
    echo "  ❌ FAIL: Error handling missing"
    exit 1
fi
echo ""

# Test 6: Check for PATH configuration
echo "Test 6: PATH Configuration Check"
if grep -q "export PATH=" scripts/install.sh || grep -q "fish_add_path" scripts/install.sh; then
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
