#!/usr/bin/env bash
set -eu #x

# This installs the cline-core app to the user's home directory,
# and starts the service.

if [[ "${1:-}" == "-h" ]]; then
    ./scripts/test-hostbridge-server.ts &
fi

CORE_DIR=~/.cline/core
INSTALL_DIR=$CORE_DIR/dev-instance/
LOG_FILE=~/.cline/cline-core-service.log

ZIP_FILE=standalone.zip
ZIP=dist-standalone/${ZIP_FILE}

# Remove old unpacked versions to force reinstall
rm -rf $CORE_DIR/* || true

mkdir -p $INSTALL_DIR
cp $ZIP $INSTALL_DIR
cd $INSTALL_DIR
unp $ZIP_FILE > /dev/null

pkill -f cline-core.js || true

# Detect platform name using the same logic as ClineDirs.kt in the plugin.
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

if [[ "$OS" == "darwin" && "$ARCH" == "x86_64" ]]; then
    PLATFORM_NAME="darwin-x64"
elif [[ "$OS" == "darwin" && "$ARCH" == "arm64" ]]; then
    PLATFORM_NAME="darwin-arm64"
elif [[ "$OS" == *"mingw"* || "$OS" == *"cygwin"* || "$OS" == *"msys"* ]] && [[ "$ARCH" == "x86_64" || "$ARCH" == "amd64" ]]; then
    # Note: This script requires a bash-compatible environment on Windows (Git Bash, MSYS2, Cygwin)
    PLATFORM_NAME="win-x64"
elif [[ "$OS" == "linux" && ("$ARCH" == "x86_64" || "$ARCH" == "amd64") ]]; then
    PLATFORM_NAME="linux-x64"
else
    echo "Unsupported platform: $OS $ARCH"
    exit 1
fi

BINARY_MODULES_DIR="./binaries/$PLATFORM_NAME/node_modules"

echo pwd: $(pwd)
set -x
NODE_PATH=$BINARY_MODULES_DIR:./node_modules DEV_WORKSPACE_FOLDER=/tmp/ node cline-core.js 2>&1 | tee $LOG_FILE
