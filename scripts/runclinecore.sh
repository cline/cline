#!/usr/bin/env bash
set -eu #x
# This installs the cline-core app to the user's home directory,
# and starts the service.

CORE_DIR=~/.cline/core
INSTALL_DIR=$CORE_DIR/0.0.1

ZIP_FILE=standalone.zip
ZIP=dist-standalone/${ZIP_FILE}

# Remove old unpacked versions to force reinstall
rm -rf $CORE_DIR/* || true

mkdir -p $INSTALL_DIR
cp $ZIP $INSTALL_DIR
cd $INSTALL_DIR
unp $ZIP_FILE > /dev/null

pkill -f cline-core.js || true
NODE_PATH=./node_modules DEV_WORKSPACE_FOLDER=/tmp/ node cline-core.js
