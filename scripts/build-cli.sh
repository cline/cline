#!/bin/bash
set -eux

npm run protos
npm run protos-go

mkdir -p dist-standalone/extension
cp package.json dist-standalone/extension

# Extract version information for ldflags
VERSION=$(node -p "require('./package.json').version")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
DATE=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
BUILT_BY="${USER:-unknown}"

# Build ldflags to inject version info
LDFLAGS="-X 'github.com/cline/cli/pkg/cli.Version=${VERSION}' \
         -X 'github.com/cline/cli/pkg/cli.Commit=${COMMIT}' \
         -X 'github.com/cline/cli/pkg/cli.Date=${DATE}' \
         -X 'github.com/cline/cli/pkg/cli.BuiltBy=${BUILT_BY}'"

cd cli
GO111MODULE=on go build -ldflags "$LDFLAGS" -o bin/cline ./cmd/cline 
echo 'cli/bin/cline built'
GO111MODULE=on go build -ldflags "$LDFLAGS" -o bin/cline-host ./cmd/cline-host
echo 'cli/bin/cline-host built'
# Copy binaries to dist-standalone/bin
cd ..
mkdir -p dist-standalone/bin
cp cli/bin/cline dist-standalone/bin/cline
cp cli/bin/cline-host dist-standalone/bin/cline-host
echo 'Copied binaries to dist-standalone/bin/'