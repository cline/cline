#!/bin/bash
set -eux

npm run protos
npm run protos-go

mkdir dist-standalone/extension || true
cp package.json dist-standalone/extension 

cd cli
GO111MODULE=on go build -o bin/cline ./cmd/cline 
echo '🖥️ cli/bin/cline built'
GO111MODULE=on go build -o bin/cline-host ./cmd/cline-host

echo '🖥️ cli/bin/cline-host built'
