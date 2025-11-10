#!/bin/bash
set -e

# Clone repository if REPO_URL is provided
if [ -n "$REPO_URL" ]; then
    echo "Cloning repository: $REPO_URL"
    REPO_NAME=$(basename "$REPO_URL" .git)
    
    if [ -n "$REPO_BRANCH" ]; then
        git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$REPO_NAME"
    else
        git clone --depth 1 "$REPO_URL" "$REPO_NAME"
    fi
    
    cd "$REPO_NAME"
fi

# If first argument is 'bash' or 'sh', start interactive shell
if [ "$1" = "bash" ] || [ "$1" = "sh" ]; then
    exec "$@"
fi

# Create Cline instance
echo "Creating Cline instance..."
INSTANCE_OUTPUT=$(cline instance new --output-format json 2>&1)
echo "$INSTANCE_OUTPUT"

# Parse instance address from output
INSTANCE_ADDRESS=$(echo "$INSTANCE_OUTPUT" | grep -oP 'Address:\s+\K\S+' || echo "localhost:50052")
echo "Instance address: $INSTANCE_ADDRESS"

# Configure Cline instance
echo "Configuring Cline instance..."
if [ -n "$ANTHROPIC_API_KEY" ]; then
    cline config set --address "$INSTANCE_ADDRESS" \
        plan-mode-api-provider=anthropic \
        act-mode-api-provider=anthropic \
        api-key="$ANTHROPIC_API_KEY" \
        act-mode-api-model-id=claude-sonnet-4-5-20250929 \
        plan-mode-api-model-id=claude-sonnet-4-5-20250929
    echo "Configuration complete"
else
    echo "Warning: ANTHROPIC_API_KEY not set, skipping API configuration"
fi

# Execute cline with provided arguments, using the instance address
exec cline "$@" --address "$INSTANCE_ADDRESS" --oneshot
