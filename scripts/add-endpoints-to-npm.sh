#!/bin/bash
set -euo pipefail

# Script to add endpoints.json to an NPM tarball for enterprise distribution
# Usage: ./add-endpoints-to-npm.sh <source.tgz> <output.tgz> <endpoints.json>

if [ "$#" -ne 3 ]; then
    echo "Error: Invalid number of arguments"
    echo "Usage: $0 <source.tgz> <output.tgz> <endpoints.json>"
    echo ""
    echo "Example:"
    echo "  $0 cline-3.55.0.tgz cline-3.55.0-enterprise.tgz endpoints.json"
    exit 1
fi

SOURCE_TGZ="$1"
OUTPUT_TGZ="$2"
ENDPOINTS_JSON="$3"

# Validate inputs
if [ ! -f "$SOURCE_TGZ" ]; then
    echo "Error: Source tarball file not found: $SOURCE_TGZ"
    exit 1
fi

if [ ! -f "$ENDPOINTS_JSON" ]; then
    echo "Error: endpoints.json file not found: $ENDPOINTS_JSON"
    exit 1
fi

# Validate endpoints.json is valid JSON
if ! jq empty "$ENDPOINTS_JSON" 2>/dev/null; then
    echo "Error: $ENDPOINTS_JSON is not valid JSON"
    exit 1
fi

# Validate required fields exist
REQUIRED_FIELDS=("appBaseUrl" "apiBaseUrl" "mcpBaseUrl")
for field in "${REQUIRED_FIELDS[@]}"; do
    if ! jq -e ".$field" "$ENDPOINTS_JSON" > /dev/null 2>&1; then
        echo "Error: Missing required field '$field' in $ENDPOINTS_JSON"
        exit 1
    fi
    
    # Validate field is a non-empty string
    value=$(jq -r ".$field" "$ENDPOINTS_JSON")
    if [ -z "$value" ] || [ "$value" = "null" ]; then
        echo "Error: Field '$field' must be a non-empty string"
        exit 1
    fi
    
    # Validate URL format (basic check)
    if ! [[ "$value" =~ ^https?:// ]]; then
        echo "Error: Field '$field' must be a valid URL (got: $value)"
        exit 1
    fi
done

echo "✓ Validated endpoints.json"

# Resolve absolute path for output file before changing directories
OUTPUT_TGZ_ABS=$(cd "$(dirname "$OUTPUT_TGZ")" && pwd)/$(basename "$OUTPUT_TGZ")

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "Extracting NPM tarball..."
tar -xzf "$SOURCE_TGZ" -C "$TEMP_DIR"

# Copy endpoints.json to package root
# NPM tarballs extract to a 'package' directory
echo "Adding endpoints.json to package root..."
cp "$ENDPOINTS_JSON" "$TEMP_DIR/package/endpoints.json"

# Repackage tarball
echo "Repackaging tarball..."
cd "$TEMP_DIR"
tar -czf "$OUTPUT_TGZ_ABS" package
cd - > /dev/null

echo "✓ Successfully created $OUTPUT_TGZ with bundled endpoints.json"
echo ""
echo "The package is ready for enterprise distribution."
echo "When installed via npm, Cline will automatically use the bundled configuration."
