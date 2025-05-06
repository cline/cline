#!/bin/bash
set -eu

BUILD_DIR=build/

if [ ! -f ../dist/extension.js ]; then
  echo You need to build the cline extension before running this script.
  exit 1
fi

mkdir -p $BUILD_DIR 2>/dev/null || true

./get-usages.sh

node prune-types.js

node generate-stubs.js
cp stub-utils.js $BUILD_DIR

# Generate gRPC service definition protos
PROTO_DIR=../proto
HEALTH_PROTO=$(node -p 'require("grpc-health-check").protoPath')
HEALTH_PROTO_DIR=$(dirname $HEALTH_PROTO)

npx grpc_tools_node_protoc \
  --js_out=import_style=commonjs,binary:$BUILD_DIR \
  --grpc_out=grpc_js:$BUILD_DIR \
  --proto_path=$PROTO_DIR --proto_path=$HEALTH_PROTO_DIR \
  ${PROTO_DIR}/*.proto $HEALTH_PROTO

node generate-server.js

node assemble-standalone.js
