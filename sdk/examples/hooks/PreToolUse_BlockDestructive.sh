#!/usr/bin/env bash
# Cline Hook: PreToolUse (Block Destructive)
# Blocks dangerous operations
# Copy to ~/.cline/hooks/PreToolUse.sh and chmod +x

input=$(cat)
tool=$(echo "$input" | jq -r '.tool_call.name // ""')
cmd=$(echo "$input" | jq -r '.tool_call.input.command // ""')

# Block dangerous git commands
if [ "$tool" = "run_commands" ]; then
  if [[ $cmd =~ (git\ reset\ --hard|git\ push\ --force|git\ push\ -f) ]]; then
    jq -n --arg cmd "$cmd" '{cancel: true, errorMessage: "Destructive git command blocked: \($cmd). Use with explicit approval."}'
    exit 0
  fi

  # Block bulk deletes
  if [[ $cmd =~ (rm\ -rf|rm\ -r.*\*) ]]; then
    jq -n --arg cmd "$cmd" '{cancel: true, errorMessage: "Bulk delete blocked: \($cmd). This is too risky."}'
    exit 0
  fi
fi

# Allow everything else
echo '{}'
