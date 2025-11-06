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

# Execute cline with provided arguments
exec cline "$@"
