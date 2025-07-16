scripts/runstandalone.sh#!/usr/bin/env bash
set -eu #x

CORE_DIR=~/.cline/core
INSTALL_DIR=$CORE_DIR/0.0.1

# Build standalone app
./gradlew buildStandaloneZip

# Remove old unpacked versions to force reinstall
rm -rf $CORE_DIR/* || true

mkdir -p $INSTALL_DIR
cp cline/dist-standalone/standalone.zip $INSTALL_DIR
cd $INSTALL_DIR
unp standalone.zip > /dev/null

pkill -f cline-core.js || true
NODE_PATH=./node_modules node cline-core.js
