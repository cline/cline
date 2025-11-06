#!/bin/bash
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "Error: ANTHROPIC_API_KEY environment variable is not set"
    echo "Set it with: export ANTHROPIC_API_KEY='your-key-here'"
    exit 1
fi

docker run -it --rm \
    -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
    -v "$(pwd):/workspace" \
    -v cline-home:/root/.cline \
    gcr.io/cline-preview/cline-cli:latest "$@"
