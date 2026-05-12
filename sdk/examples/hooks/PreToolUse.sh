#!/usr/bin/env bash
# Cline Hook: PreToolUse
# Logs every tool call before it executes
# Copy to ~/.cline/hooks/PreToolUse.sh and chmod +x

input=$(cat)
tool=$(echo "$input" | jq -r '.tool_call.name // "unknown"')
args=$(echo "$input" | jq -r '.preToolUse.parameters | to_entries | map("\(.key)=\(.value)") | join(", ")' 2>/dev/null || echo "")

echo "🔧 Tool: $tool" >&2
if [ -n "$args" ] && [ "$args" != "null" ]; then
  echo "   Args: $args" >&2
fi

# Return empty object to allow the call to proceed
echo '{}'
