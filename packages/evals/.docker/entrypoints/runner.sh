#!/bin/bash

# Set environment variable to suppress WSL install prompt for VS Code
export DONT_PROMPT_WSL_INSTALL=1

if [ $# -eq 0 ]; then
    exec bash
else
    exec "$@"
fi
