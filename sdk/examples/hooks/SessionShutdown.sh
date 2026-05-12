#!/usr/bin/env bash
# Cline Hook: SessionShutdown
# Logs when a session shuts down (normally or due to error)
# Copy to ~/.cline/hooks/SessionShutdown.sh and chmod +x

input=$(cat)
timestamp=$(echo "$input" | jq -r '.timestamp // "unknown"')
reason=$(echo "$input" | jq -r '.reason // "unknown"')

echo "🔌 Session shutdown at $timestamp" >&2
echo "   Reason: $reason" >&2

# Lifecycle events are informational only
echo '{}'
