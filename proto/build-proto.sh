#!/bin/bash

set -e

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Get the root directory of the project
ROOT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Define output directories
TS_OUT_DIR="$ROOT_DIR/src/shared/proto"

# Create the output directories if they don't exist
mkdir -p "$TS_OUT_DIR"

# Clean up any existing generated files
echo "Cleaning up existing generated TypeScript files..."
find "$TS_OUT_DIR" -name "*.ts" -type f -delete

# Process all proto files from the proto directory
echo "Processing proto files from $SCRIPT_DIR..."
find "$SCRIPT_DIR" -name "*.proto" -type f | while read -r proto_file; do
  echo "Generating TypeScript code for $(basename "$proto_file")..."
  protoc \
    --plugin=protoc-gen-ts_proto="$ROOT_DIR/node_modules/.bin/protoc-gen-ts_proto" \
    --ts_proto_out="$TS_OUT_DIR" \
    --ts_proto_opt=outputServices=generic-definitions,env=node,esModuleInterop=true,useDate=false,useOptionals=messages \
    --proto_path="$SCRIPT_DIR" \
    "$proto_file"
done

echo "Protocol Buffer code generation completed successfully."
echo "TypeScript files generated in: $TS_OUT_DIR"

# Make the script executable
chmod +x "$SCRIPT_DIR/build-proto.sh"
