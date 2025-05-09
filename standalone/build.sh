#!/bin/bash
set -eux

BUILD_DIR=build/

if [ ! -f ../dist/extension.js ]; then
  echo You need to build the cline extension before running this script.
  exit 1
fi

mkdir -p $BUILD_DIR 2>/dev/null || true
cp -av files/* $BUILD_DIR

# Generate gRPC service definition protos
PROTO_DIR=../proto
HEALTH_PROTO=$(node -p 'require("grpc-health-check").protoPath')
HEALTH_PROTO_DIR=$(dirname $HEALTH_PROTO)

npx grpc_tools_node_protoc \
  --js_out=import_style=commonjs,binary:$BUILD_DIR \
  --grpc_out=grpc_js:$BUILD_DIR \
  --proto_path=$PROTO_DIR --proto_path=$HEALTH_PROTO_DIR \
  ${PROTO_DIR}/*.proto $HEALTH_PROTO

cp ../dist/extension.js build/
echo 'module.exports.Controller = Controller' >> build/extension.js
node generate-server.js

cd $BUILD_DIR
npm install
if find node_modules -name '*.node' | grep .; then
  echo Native node modules are being used. Build cannot proceed.
  exit 1
fi

zip -r standalone.zip . -x standalone.zip

