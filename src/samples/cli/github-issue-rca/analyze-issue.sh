#!/bin/bash
# Analyze a GitHub issue using Cline CLI

if [ -z "$1" ]; then
    echo "Usage: $0 <github-issue-url> [prompt]"
    echo "Example: $0 https://github.com/owner/repo/issues/123"
    echo "Example: $0 https://github.com/owner/repo/issues/123 'What is the security impact?'"
    exit 1
fi

ISSUE_URL="$1"
PROMPT="${2:-What is the root cause of this issue}"

cline -y "$PROMPT: $ISSUE_URL" --mode act
