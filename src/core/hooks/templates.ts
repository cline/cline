/**
 * Hook script templates for all supported hook types.
 * Templates are provided as executable Bash shell scripts with comprehensive examples.
 * Scripts use jq for JSON parsing when available, with fallback to basic parsing.
 */

export function getHookTemplate(hookName: string): string {
	const templates: Record<string, string> = {
		TaskStart: getTaskStartTemplate(),
		TaskResume: getTaskResumeTemplate(),
		TaskCancel: getTaskCancelTemplate(),
		TaskComplete: getTaskCompleteTemplate(),
		PreToolUse: getPreToolUseTemplate(),
		PostToolUse: getPostToolUseTemplate(),
		UserPromptSubmit: getUserPromptSubmitTemplate(),
		PreCompact: getPreCompactTemplate(),
	}

	return templates[hookName] || getDefaultTemplate(hookName)
}

function getTaskStartTemplate(): string {
	return `#!/bin/bash
#
# TaskStart Hook
# 
# Executes when a new task begins.
# 
# Input: { taskId, taskStart: { task: string }, clineVersion, timestamp, ... }
# Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
# 
# Use cases:
# - Log task start time
# - Add context about environment or project state
# - Check prerequisites before starting
# - Notify external systems (Slack, issue trackers, etc.)

# Read JSON input from stdin
INPUT=$(cat)

# Parse input using jq (or fallback to basic parsing)
if command -v jq &> /dev/null; then
  TASK=$(echo "$INPUT" | jq -r '.taskStart.task')
  TASK_ID=$(echo "$INPUT" | jq -r '.taskId')
  TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp')
else
  # Fallback if jq is not available
  TASK="<task>"
  TASK_ID="<taskId>"
  TIMESTAMP=$(date +%s%3N)
fi

# Example: Log task start
echo "[TaskStart] Task started: $TASK" >&2
echo "[TaskStart] Task ID: $TASK_ID" >&2

# Example: Add context to the task
TIMESTAMP_ISO=$(date -u -d @"$((TIMESTAMP/1000))" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
CONTEXT_MOD="Note: Task started at $TIMESTAMP_ISO"

# Return result as JSON
echo "{\"cancel\":false,\"contextModification\":\"$CONTEXT_MOD\",\"errorMessage\":\"\"}"
`
}

function getTaskResumeTemplate(): string {
	return `#!/bin/bash
#
# TaskResume Hook
# 
# Executes when a task is resumed after being interrupted.
# 
# Input: { taskId, taskResume: { task: string }, clineVersion, timestamp, ... }
# Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
# 
# Use cases:
# - Check for changes since task was paused
# - Refresh context with latest project state
# - Notify that work is resuming

# Read JSON input from stdin
INPUT=$(cat)

# Parse input using jq (or fallback to basic parsing)
if command -v jq &> /dev/null; then
  TASK=$(echo "$INPUT" | jq -r '.taskResume.task')
else
  TASK="<task>"
fi

echo "[TaskResume] Resuming task: $TASK" >&2

# Return result
echo "{\"cancel\":false,\"contextModification\":\"\",\"errorMessage\":\"\"}"
`
}

function getTaskCancelTemplate(): string {
	return `#!/bin/bash
#
# TaskCancel Hook
# 
# Executes when a task is cancelled by the user.
# 
# Input: { taskId, taskCancel: { task: string }, clineVersion, timestamp, ... }
# Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
# 
# Use cases:
# - Clean up temporary files or resources
# - Notify external systems about cancellation
# - Log cancellation for analytics

# Read JSON input from stdin
INPUT=$(cat)

# Parse input using jq (or fallback to basic parsing)
if command -v jq &> /dev/null; then
  TASK=$(echo "$INPUT" | jq -r '.taskCancel.task')
else
  TASK="<task>"
fi

echo "[TaskCancel] Task cancelled: $TASK" >&2

# Return result
echo "{\"cancel\":false,\"contextModification\":\"\",\"errorMessage\":\"\"}"
`
}

function getTaskCompleteTemplate(): string {
	return `#!/bin/bash
#
# TaskComplete Hook
# 
# Executes when a task completes successfully.
# 
# Input: { taskId, taskComplete: { task: string }, clineVersion, timestamp, ... }
# Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
# 
# Use cases:
# - Run tests or validation
# - Generate reports or summaries
# - Notify stakeholders
# - Trigger CI/CD pipelines

# Read JSON input from stdin
INPUT=$(cat)

# Parse input using jq (or fallback to basic parsing)
if command -v jq &> /dev/null; then
  TASK=$(echo "$INPUT" | jq -r '.taskComplete.task')
else
  TASK="<task>"
fi

echo "[TaskComplete] Task completed: $TASK" >&2

# Return result
echo "{\"cancel\":false,\"contextModification\":\"\",\"errorMessage\":\"\"}"
`
}

function getPreToolUseTemplate(): string {
	return `#!/bin/bash
#
# PreToolUse Hook
# 
# Executes before any tool is used (read_file, write_to_file, execute_command, etc.)
# 
# Input: { taskId, preToolUse: { tool: string, parameters: object }, ... }
# Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
# 
# Use cases:
# - Block dangerous operations
# - Add safety checks before file modifications
# - Log tool usage
# - Validate parameters before execution

# Read JSON input from stdin
INPUT=$(cat)

# Parse input using jq (or fallback to basic parsing)
if command -v jq &> /dev/null; then
  TOOL=$(echo "$INPUT" | jq -r '.preToolUse.tool')
  COMMAND=$(echo "$INPUT" | jq -r '.preToolUse.parameters.command // empty')
else
  TOOL="<tool>"
  COMMAND=""
fi

# Example: Block dangerous operations
if [[ "$TOOL" == "execute_command" ]] && [[ "$COMMAND" == *"rm -rf /"* ]]; then
  echo "{\"cancel\":true,\"errorMessage\":\"Dangerous command blocked by PreToolUse hook\"}"
  exit 0
fi

# Example: Log tool usage
echo "[PreToolUse] Tool about to execute: $TOOL" >&2

# Allow execution
echo "{\"cancel\":false,\"contextModification\":\"\",\"errorMessage\":\"\"}"
`
}

function getPostToolUseTemplate(): string {
	return `#!/bin/bash
#
# PostToolUse Hook
# 
# Executes after any tool is used successfully or fails.
# 
# Input: { 
#   taskId, 
#   postToolUse: { 
#     tool: string, 
#     parameters: object,
#     result: string,
#     success: boolean,
#     durationMs: number
#   }, 
#   ... 
# }
# Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
# 
# Use cases:
# - Audit tool usage
# - Validate results
# - Trigger follow-up actions
# - Monitor performance

# Read JSON input from stdin
INPUT=$(cat)

# Parse input using jq (or fallback to basic parsing)
if command -v jq &> /dev/null; then
  TOOL=$(echo "$INPUT" | jq -r '.postToolUse.tool')
  SUCCESS=$(echo "$INPUT" | jq -r '.postToolUse.success')
  DURATION=$(echo "$INPUT" | jq -r '.postToolUse.durationMs')
else
  TOOL="<tool>"
  SUCCESS="true"
  DURATION="0"
fi

# Log tool completion
STATUS="success"
[[ "$SUCCESS" == "false" ]] && STATUS="failed"
echo "[PostToolUse] Tool completed: $TOOL ($STATUS) in \${DURATION}ms" >&2

# Return result
echo "{\"cancel\":false,\"contextModification\":\"\",\"errorMessage\":\"\"}"
`
}

function getUserPromptSubmitTemplate(): string {
	return `#!/bin/bash
#
# UserPromptSubmit Hook
# 
# Executes when the user submits a prompt to Cline.
# 
# Input: { taskId, userPromptSubmit: { prompt: string }, clineVersion, timestamp, ... }
# Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
# 
# Use cases:
# - Log user prompts for analytics
# - Add context based on prompt content
# - Validate or sanitize prompts
# - Trigger external integrations

# Read JSON input from stdin
INPUT=$(cat)

# Parse input using jq (or fallback to basic parsing)
if command -v jq &> /dev/null; then
  PROMPT=$(echo "$INPUT" | jq -r '.userPromptSubmit.prompt')
  PROMPT_LENGTH=\${#PROMPT}
else
  PROMPT_LENGTH=0
fi

echo "[UserPromptSubmit] User submitted prompt (length: $PROMPT_LENGTH)" >&2

# Return result
echo "{\"cancel\":false,\"contextModification\":\"\",\"errorMessage\":\"\"}"
`
}

function getPreCompactTemplate(): string {
	return `#!/bin/bash
#
# PreCompact Hook
# 
# Executes before conversation context is compacted (to free up token space).
# 
# Input: { 
#   taskId, 
#   preCompact: { 
#     conversationLength: number,
#     estimatedTokens: number 
#   }, 
#   ... 
# }
# Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
# 
# Use cases:
# - Archive important conversation parts
# - Log compaction events
# - Add summary before context is lost

# Read JSON input from stdin
INPUT=$(cat)

# Parse input using jq (or fallback to basic parsing)
if command -v jq &> /dev/null; then
  CONV_LENGTH=$(echo "$INPUT" | jq -r '.preCompact.conversationLength')
  EST_TOKENS=$(echo "$INPUT" | jq -r '.preCompact.estimatedTokens')
else
  CONV_LENGTH="<length>"
  EST_TOKENS="<tokens>"
fi

echo "[PreCompact] About to compact conversation (messages: $CONV_LENGTH, tokens: $EST_TOKENS)" >&2

# Return result
echo "{\"cancel\":false,\"contextModification\":\"\",\"errorMessage\":\"\"}"
`
}

function getDefaultTemplate(hookName: string): string {
	return `#!/bin/bash
#
# ${hookName} Hook
# 
# Input: JSON via stdin
# Output: JSON to stdout

# Read JSON input from stdin
INPUT=$(cat)

# Parse input using jq (or fallback to basic parsing)
if command -v jq &> /dev/null; then
  TASK_ID=$(echo "$INPUT" | jq -r '.taskId')
else
  TASK_ID="<taskId>"
fi

# Your hook logic here
echo "[${hookName}] Executed for task $TASK_ID" >&2

# Return result
echo "{\"cancel\":false,\"contextModification\":\"\",\"errorMessage\":\"\"}"
`
}
