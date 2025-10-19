#!/usr/bin/env bash

# Script to build the Cline NPM package with telemetry keys injected
# This script ensures all environment variables are properly set and builds are successful

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Required environment variables
REQUIRED_VARS=(
  "TELEMETRY_SERVICE_API_KEY"
  "ERROR_SERVICE_API_KEY"
)

# Optional but recommended environment variables
OPTIONAL_VARS=(
  "CLINE_ENVIRONMENT"
  "POSTHOG_TELEMETRY_ENABLED"
)

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Cline NPM Package Build Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 1: Verify required environment variables are set
echo -e "${BLUE}Step 1: Verifying environment variables...${NC}"
MISSING_VARS=()
for VAR in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!VAR}" ]; then
    MISSING_VARS+=("$VAR")
    echo -e "${RED}✗ $VAR is not set${NC}"
  else
    # Show first 10 chars for verification (don't expose full key)
    VAR_VALUE="${!VAR}"
    echo -e "${GREEN}✓ $VAR is set (${VAR_VALUE:0:10}...)${NC}"
  fi
done

# Check optional variables
for VAR in "${OPTIONAL_VARS[@]}"; do
  if [ -z "${!VAR}" ]; then
    echo -e "${YELLOW}⚠ $VAR is not set (optional)${NC}"
  else
    echo -e "${GREEN}✓ $VAR is set: ${!VAR}${NC}"
  fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
  echo -e "\n${RED}Error: Missing required environment variables:${NC}"
  printf '%s\n' "${MISSING_VARS[@]}"
  echo -e "\n${YELLOW}Please set these variables before running the build:${NC}"
  echo -e "export TELEMETRY_SERVICE_API_KEY=\"your_posthog_api_key\""
  echo -e "export ERROR_SERVICE_API_KEY=\"your_error_tracking_api_key\""
  exit 1
fi

# Step 2: Verify Node.js can see the environment variables
echo -e "\n${BLUE}Step 2: Verifying Node.js can access environment variables...${NC}"
if node -e "
  const telemetryKey = process.env.TELEMETRY_SERVICE_API_KEY;
  const errorKey = process.env.ERROR_SERVICE_API_KEY;
  if (!telemetryKey || !errorKey) {
    console.error('Node.js cannot see environment variables!');
    process.exit(1);
  }
  console.log('✓ TELEMETRY_SERVICE_API_KEY visible to Node.js');
  console.log('✓ ERROR_SERVICE_API_KEY visible to Node.js');
"; then
  echo -e "${GREEN}✓ Node.js can access environment variables${NC}"
else
  echo -e "${RED}✗ Node.js cannot access environment variables${NC}"
  echo -e "${YELLOW}Make sure to use 'export' when setting variables:${NC}"
  echo -e "export TELEMETRY_SERVICE_API_KEY=\"...\""
  exit 1
fi

# Step 3: Clean previous builds
echo -e "\n${BLUE}Step 3: Cleaning previous builds...${NC}"
rm -rf dist-standalone
echo -e "${GREEN}✓ Cleaned dist-standalone directory${NC}"

# Step 4: Build Go CLI binaries for all platforms
echo -e "\n${BLUE}Step 4: Building Go CLI binaries for all platforms...${NC}"
if npm run compile-cli-all-platforms; then
  echo -e "${GREEN}✓ Go CLI binaries built successfully${NC}"
  
  # Verify binaries were created
  if ls cli/bin/cline-* 1> /dev/null 2>&1; then
    echo -e "${GREEN}✓ CLI binaries verified:${NC}"
    ls -lh cli/bin/cline-* | awk '{print "  " $9 " (" $5 ")"}'
  else
    echo -e "${RED}✗ No CLI binaries found in cli/bin/${NC}"
    exit 1
  fi
else
  echo -e "${RED}✗ Failed to build Go CLI binaries${NC}"
  exit 1
fi

# Step 5: Build the standalone package with esbuild
echo -e "\n${BLUE}Step 5: Building standalone package with esbuild...${NC}"
if npm run compile-standalone-npm; then
  echo -e "${GREEN}✓ Standalone package built successfully${NC}"
else
  echo -e "${RED}✗ Failed to build standalone package${NC}"
  exit 1
fi

# Step 6: Verify telemetry keys were injected
echo -e "\n${BLUE}Step 6: Verifying telemetry keys were injected...${NC}"

# Check if the compiled file still has process.env references (bad)
if grep -q "process.env.TELEMETRY_SERVICE_API_KEY" dist-standalone/cline-core.js; then
  echo -e "${RED}✗ Keys were NOT injected! Found 'process.env.TELEMETRY_SERVICE_API_KEY' in compiled code${NC}"
  echo -e "${YELLOW}This means the environment variables were not replaced during build${NC}"
  exit 1
fi

# Check if actual keys are present (good)
if grep -q "data.cline.bot" dist-standalone/cline-core.js; then
  # Extract a snippet of the PostHog config
  POSTHOG_CONFIG=$(grep -A 3 "data.cline.bot" dist-standalone/cline-core.js | head -5)
  if echo "$POSTHOG_CONFIG" | grep -q "apiKey.*phc_"; then
    echo -e "${GREEN}✓ Telemetry keys successfully injected into compiled code${NC}"
  else
    echo -e "${YELLOW}⚠ PostHog config found but apiKey format unclear${NC}"
    echo -e "${YELLOW}Config snippet:${NC}"
    echo "$POSTHOG_CONFIG"
  fi
else
  echo -e "${YELLOW}⚠ Could not verify PostHog config in compiled code${NC}"
fi

# Step 7: Display build summary
echo -e "\n${BLUE}========================================${NC}"
echo -e "${GREEN}Build completed successfully!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}Package location:${NC} dist-standalone/"
echo -e "${GREEN}Package version:${NC} $(node -p "require('./dist-standalone/package.json').version" 2>/dev/null || echo "unknown")"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo -e "1. Test locally:  ${YELLOW}cd dist-standalone && npm link${NC}"
echo -e "2. Verify:        ${YELLOW}cline version${NC}"
echo -e "3. Publish:       ${YELLOW}cd dist-standalone && npm publish${NC}"
echo ""
echo -e "${YELLOW}Note: Check PostHog dashboard after running cline commands to verify telemetry${NC}"
