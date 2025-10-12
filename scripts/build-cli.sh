#!/bin/bash
set -eux

npm run protos
npm run protos-go

mkdir -p dist-standalone/extension
cp package.json dist-standalone/extension 

cd cli
GO111MODULE=on go build -o bin/cline ./cmd/cline 
echo 'cli/bin/cline built'
GO111MODULE=on go build -o bin/cline-host ./cmd/cline-host
echo 'cli/bin/cline-host built'

# Copy CLI binaries to dist-standalone
mkdir -p ../dist-standalone/bin
cp bin/cline ../dist-standalone/bin/cline
cp bin/cline-host ../dist-standalone/bin/cline-host
