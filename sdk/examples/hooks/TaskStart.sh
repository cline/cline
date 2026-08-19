#!/usr/bin/env bash
# Cline Hook: TaskStart
# Logs when an agent task starts
# Copy to ~/.cline/hooks/TaskStart.sh and chmod +x

input=$(cat)
timestamp=$(echo "$input" | jq -r '.timestamp // "unknown"')
sessionId=$(echo "$input" | jq -r '.sessionContext.rootSessionId // "unknown"')

echo "🚀 Task started at $timestamp" >&2
echo "   Session: $sessionId" >&2

# Lifecycle events are informational only
echo '{}'
