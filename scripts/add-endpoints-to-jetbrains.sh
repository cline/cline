#!/bin/bash
set -euo pipefail

# Script to add endpoints.json to a JetBrains plugin ZIP for enterprise distribution
# Usage: ./add-endpoints-to-jetbrains.sh <source.zip> <output.zip> <endpoints.json>

if [ "$#" -ne 3 ]; then
    echo "Error: Invalid number of arguments"
    echo "Usage: $0 <source.zip> <output.zip> <endpoints.json>"
    echo ""
    echo "Example:"
    echo "  $0 cline-jetbrains-3.55.0.zip cline-jetbrains-3.55.0-enterprise.zip endpoints.json"
    exit 1
fi

SOURCE_ZIP="$1"
OUTPUT_ZIP="$2"
ENDPOINTS_JSON="$3"

# Validate inputs
if [ ! -f "$SOURCE_ZIP" ]; then
    echo "Error: Source ZIP file not found: $SOURCE_ZIP"
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

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "Extracting JetBrains plugin ZIP..."
unzip -q "$SOURCE_ZIP" -d "$TEMP_DIR"

# Find the plugin lib directory (where the main JAR is located)
# JetBrains plugins typically have a structure like: cline/lib/
# We need to add endpoints.json to the root of the plugin directory
PLUGIN_DIR="$TEMP_DIR/cline"
if [ ! -d "$PLUGIN_DIR" ]; then
    # Try to find any directory that looks like a plugin root
    PLUGIN_DIR=$(find "$TEMP_DIR" -maxdepth 1 -type d ! -path "$TEMP_DIR" | head -n 1)
    if [ -z "$PLUGIN_DIR" ] || [ ! -d "$PLUGIN_DIR" ]; then
        echo "Warning: Could not find plugin directory, adding to ZIP root"
        PLUGIN_DIR="$TEMP_DIR"
    fi
fi

echo "Adding endpoints.json to plugin directory..."
cp "$ENDPOINTS_JSON" "$PLUGIN_DIR/endpoints.json"

# Repackage ZIP
echo "Repackaging ZIP..."
cd "$TEMP_DIR"
zip -q -r "$(basename "$OUTPUT_ZIP")" .
cd - > /dev/null

# Move to final location
mv "$TEMP_DIR/$(basename "$OUTPUT_ZIP")" "$OUTPUT_ZIP"

echo "✓ Successfully created $OUTPUT_ZIP with bundled endpoints.json"
echo ""
echo "The package is ready for enterprise distribution."
echo "When installed in JetBrains IDEs, Cline will automatically use the bundled configuration."
