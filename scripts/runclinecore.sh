#!/usr/bin/env bash
set -eu #x

# This installs the cline-core app to the user's home directory,
# and starts the service.

if [[ "${1:-}" == "-h" ]]; then
    ./scripts/test-hostbridge-server.ts &
fi

CORE_DIR=~/.cline/core
INSTALL_DIR=$CORE_DIR/0.0.1
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

NODE_PATH=./node_modules DEV_WORKSPACE_FOLDER=/tmp/ node cline-core.js 2>&1 | tee $LOG_FILE
