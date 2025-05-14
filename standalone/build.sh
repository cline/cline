#!/bin/bash
set -uxe

BUILD_DIR=dist-standalone

mkdir -p $BUILD_DIR 2>/dev/null || true

# Generate the code to setup the gRPC handlers.
npm run protos > /dev/null

NODE_OPTIONS=--no-warnings node standalone/generate-server-setup.js

# Compile the standalone extension.
npm run compile-standalone

# Copy the standalone's vscode replacement module into the build dir.
cp -av standalone/runtime-files/. $BUILD_DIR

cd $BUILD_DIR

if find node_modules -name '*.node' | grep .; then
  echo Native node modules are being used. Build cannot proceed.
  exit 1
fi

# # Zip all the files needed for the standalone extension.
zip -q -r standalone.zip . -x standalone.zip

# echo Built standalone cline: $(realpath standalone.zip)
