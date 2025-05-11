#!/bin/bash
set -uxe

BUILD_DIR=build

if [ ! -f ../dist/extension.js ]; then
  echo You need to build the cline extension before running this script.
  exit 1
fi

mkdir -p $BUILD_DIR 2>/dev/null || true

# Copy the standalone files into the buld dir.
cp -av files/. $BUILD_DIR

PROTO_DIR=../proto
# The proto files are needed when using protoLoader and gRPC reflection.
rm -f $BUILD_DIR/*.proto
cp -av $PROTO_DIR/*.proto $BUILD_DIR

# Copy the pre-built extension
cp ../dist/extension.js $BUILD_DIR
echo 'module.exports.Controller = Controller' >> build/extension.js

# Generate gRPC server for the services and handlers.
node generate-server.js

# Install npm modules used by the extension at runtime.
cd $BUILD_DIR
npm install

if find node_modules -name '*.node' | grep .; then
  echo Native node modules are being used. Build cannot proceed.
  exit 1
fi

# Zip all the files needed for the standalone extension.
zip -q -r standalone.zip . -x standalone.zip

echo Built standalone cline: $(realpath standalone.zip)
