#!/usr/bin/env bash
set -euo pipefail

# File hook example: runs when the agent session ends successfully.
#
# Install:
#   mkdir -p .cline/hooks
#   cp examples/hooks/agent_end.sh .cline/hooks/agent_end.sh
#   chmod +x .cline/hooks/agent_end.sh

payload="$(cat)"

if command -v jq >/dev/null 2>&1; then
	task_id="$(printf '%s' "$payload" | jq -r '.taskId // .conversation_id // "unknown"')"
	output="$(printf '%s' "$payload" | jq -r '.turn.outputText // ""' | tr '\n' ' ' | cut -c 1-180)"
else
	task_id="unknown"
	output=""
fi

printf '[hook:agent_end] task completed: %s\n' "$task_id" >&2
if [ -n "$output" ]; then
	printf '[hook:agent_end] output: %s\n' "$output" >&2
fi

# Empty JSON means "no control changes".
printf '{}\n'
