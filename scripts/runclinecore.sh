#!/usr/bin/env bash
set -eu #x
# This compiles the cline-core app, installs it to the user's home directory,
# and runs the service.

CORE_DIR=~/.cline/core
INSTALL_DIR=$CORE_DIR/0.0.1

# Build cline core
npm run compile-standalone

# Remove old unpacked versions to force reinstall
rm -rf $CORE_DIR/* || true

mkdir -p $INSTALL_DIR
cp dist-standalone/standalone.zip $INSTALL_DIR
cd $INSTALL_DIR
unp standalone.zip > /dev/null

pkill -f cline-core.js || true
NODE_PATH=./node_modules node cline-core.js
