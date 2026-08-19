#!/usr/bin/env bash
# Cline Hook: PostToolUse
# Logs tool results after execution
# Copy to ~/.cline/hooks/PostToolUse.sh and chmod +x

input=$(cat)
tool=$(echo "$input" | jq -r '.tool_result.name // "unknown"')
success=$(echo "$input" | jq -r '.postToolUse.success // false')
duration=$(echo "$input" | jq -r '.postToolUse.executionTimeMs // 0')

status="✅"
[ "$success" != "true" ] && status="❌"

echo "$status Tool completed: $tool (${duration}ms)" >&2

# Return empty object (PostToolUse events are informational)
echo '{}'
