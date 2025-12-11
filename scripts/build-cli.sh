##!/bin/bash
set -eu

# Extract version information for ldflags (moved to top for early build)
CORE_VERSION=$(node -p "require('./package.json').version")
CLI_VERSION=$(node -p "require('./cli/package.json').version")
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
DATE=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
BUILT_BY="${USER:-unknown}"

# Build ldflags to inject version info
LDFLAGS="-X 'github.com/cline/cli/pkg/cli/global.Version=${CORE_VERSION}' \
         -X 'github.com/cline/cli/pkg/cli/global.CliVersion=${CLI_VERSION}' \
         -X 'github.com/cline/cli/pkg/cli/global.Commit=${COMMIT}' \
         -X 'github.com/cline/cli/pkg/cli/global.Date=${DATE}' \
         -X 'github.com/cline/cli/pkg/cli/global.BuiltBy=${BUILT_BY}'"

# Now run NPM protos and compile-standalone (protos must be generated before Go build)
npm run protos
npm run protos-go

# Build the Go CLI binaries
cd cli
go mod tidy
go mod download

# Detect current platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

# Normalize architecture names
case "$ARCH" in
    x86_64)
        ARCH="amd64"
        ;;
    aarch64)
        ARCH="arm64"
        ;;
    arm64)
        ARCH="arm64"
        ;;
esac

echo "Building for current platform ($OS-$ARCH)..."

GO111MODULE=on go build -ldflags "$LDFLAGS" -o bin/cline ./cmd/cline
echo "  ✓ bin/cline built"

GO111MODULE=on go build -ldflags "$LDFLAGS" -o bin/cline-host ./cmd/cline-host
echo "  ✓ bin/cline-host built"

echo ""
echo "Go CLI build complete for current platform!"

cd ..

npm run compile-standalone

# This section copies the JS-based standalone core components
mkdir -p dist-standalone/extension
cp package.json dist-standalone/extension
cp dist-standalone/cline-core.js dist-standalone/extension/cline-core.js # Ensure this copies to extension dir

# Finally, copy the Go binaries to dist-standalone/bin
mkdir -p dist-standalone/bin
cp cli/bin/cline dist-standalone/bin/cline
cp cli/bin/cline dist-standalone/bin/cline-${OS}-${ARCH}
cp cli/bin/cline-host dist-standalone/bin/cline-host
cp cli/bin/cline-host dist-standalone/bin/cline-host-${OS}-${ARCH}
echo "Copied Go binaries to dist-standalone/bin/ (both generic and platform-specific names)"
