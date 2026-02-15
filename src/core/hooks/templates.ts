/**
 * Hook script templates for all supported hook types.
 * Templates are provided as executable Bash shell scripts with cross-platform compatibility.
 * Scripts work out of the box without external dependencies (jq is optional).
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
# ============================================================================
# TaskStart Hook
# Runs when a new task begins.
# ============================================================================
#
# EXAMPLE INPUT (JSON via stdin):
# {
#   "clineVersion": "3.17.0",
#   "hookName": "TaskStart",
#   "taskId": "abc123",
#   "timestamp": "1749484935515",
#   "workspaceRoots": ["/path/to/project"],
#   "userId": "user-123",
#   "taskStart": {
#     "taskMetadata": {
#       "task": "Create a new feature..."
#     }
#   }
# }
#
# OUTPUT: JSON with { cancel, contextModification, errorMessage }
# - cancel: true to abort the task before it starts
# - contextModification: text to add to the conversation context
# - errorMessage: shown to user if cancel is true
# ============================================================================

# Read input from stdin
INPUT=$(cat)

# --- Parse JSON (works with or without jq) ---
get_json_value() {
  local key="$1"
  if command -v jq >/dev/null 2>&1; then
    echo "$INPUT" | jq -r "$key // empty" 2>/dev/null
  else
    # Simple grep fallback for basic string values
    echo "$INPUT" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*: *"\\([^"]*\\)".*/\\1/'
  fi
}

TASK_ID=$(get_json_value "taskId")
TIMESTAMP=$(get_json_value "timestamp")

# --- Example: Log task start to a file ---
# Uncomment to enable logging:
# LOG_FILE="\${HOME}/.cline/task-log.txt"
# mkdir -p "$(dirname "$LOG_FILE")"
# echo "[\$(date '+%Y-%m-%d %H:%M:%S')] Task started: $TASK_ID" >> "$LOG_FILE"

# --- Example: Add project context ---
# Check for project-specific information and inject it into the conversation.
# This is useful for adding rules, conventions, or current state.

CONTEXT=""

# Check for package.json to identify Node.js projects
if [ -f "package.json" ]; then
  PROJECT_NAME=$(get_json_value "name" < package.json 2>/dev/null || echo "")
  if [ -n "$PROJECT_NAME" ]; then
    CONTEXT="Project: $PROJECT_NAME (Node.js)"
  fi
fi

# Check for .git to add branch info
if [ -d ".git" ]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  if [ -n "$BRANCH" ]; then
    CONTEXT="\${CONTEXT:+$CONTEXT | }Git branch: $BRANCH"
  fi
fi

# --- Output result ---
# Using printf for cross-platform JSON output
printf '{"cancel":false,"contextModification":"%s","errorMessage":""}' "$CONTEXT"
`
}

function getTaskResumeTemplate(): string {
	return `#!/bin/bash
# ============================================================================
# TaskResume Hook
# Runs when a task is resumed after being paused.
# ============================================================================
#
# EXAMPLE INPUT (JSON via stdin):
# {
#   "clineVersion": "3.17.0",
#   "hookName": "TaskResume",
#   "taskId": "abc123",
#   "timestamp": "1749484935515",
#   "workspaceRoots": ["/path/to/project"],
#   "userId": "user-123",
#   "taskResume": {
#     "taskMetadata": { "task": "..." },
#     "previousState": { "lastActiveTime": "..." }
#   }
# }
#
# OUTPUT: JSON with { cancel, contextModification, errorMessage }
# ============================================================================

INPUT=$(cat)

# --- Parse JSON ---
get_json_value() {
  local key="$1"
  if command -v jq >/dev/null 2>&1; then
    echo "$INPUT" | jq -r "$key // empty" 2>/dev/null
  else
    echo "$INPUT" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*: *"\\([^"]*\\)".*/\\1/'
  fi
}

TASK_ID=$(get_json_value "taskId")

# --- Example: Check what changed since the task was paused ---
CONTEXT=""

# Check for uncommitted git changes
if [ -d ".git" ]; then
  CHANGED_FILES=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [ "$CHANGED_FILES" -gt 0 ]; then
    CONTEXT="Note: $CHANGED_FILES file(s) have uncommitted changes since this task was paused."
  fi
fi

# --- Example: Check if dependencies changed ---
# Uncomment to detect dependency changes:
# if [ -f "package-lock.json" ]; then
#   if ! git diff --quiet package-lock.json 2>/dev/null; then
#     CONTEXT="\${CONTEXT:+$CONTEXT }Dependencies may have changed - consider running npm install."
#   fi
# fi

printf '{"cancel":false,"contextModification":"%s","errorMessage":""}' "$CONTEXT"
`
}

function getTaskCancelTemplate(): string {
	return `#!/bin/bash
# ============================================================================
# TaskCancel Hook
# Runs when the user cancels a task.
# ============================================================================
#
# EXAMPLE INPUT (JSON via stdin):
# {
#   "clineVersion": "3.17.0",
#   "hookName": "TaskCancel",
#   "taskId": "abc123",
#   "timestamp": "1749484935515",
#   "workspaceRoots": ["/path/to/project"],
#   "userId": "user-123",
#   "taskCancel": {
#     "taskMetadata": { "task": "..." }
#   }
# }
#
# OUTPUT: JSON with { cancel, contextModification, errorMessage }
# Note: "cancel" in output doesn't prevent cancellation - it's already happening.
# ============================================================================

INPUT=$(cat)

# --- Parse JSON ---
get_json_value() {
  local key="$1"
  if command -v jq >/dev/null 2>&1; then
    echo "$INPUT" | jq -r "$key // empty" 2>/dev/null
  else
    echo "$INPUT" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*: *"\\([^"]*\\)".*/\\1/'
  fi
}

TASK_ID=$(get_json_value "taskId")

# --- Example: Log cancellation ---
# LOG_FILE="\${HOME}/.cline/task-log.txt"
# mkdir -p "$(dirname "$LOG_FILE")"
# echo "[\$(date '+%Y-%m-%d %H:%M:%S')] Task cancelled: $TASK_ID" >> "$LOG_FILE"

# --- Example: Clean up temporary files ---
# Uncomment to clean up task-specific temp files:
# TEMP_DIR="/tmp/cline-$TASK_ID"
# if [ -d "$TEMP_DIR" ]; then
#   rm -rf "$TEMP_DIR"
# fi

printf '{"cancel":false,"contextModification":"","errorMessage":""}'
`
}

function getTaskCompleteTemplate(): string {
	return `#!/bin/bash
# ============================================================================
# TaskComplete Hook
# Runs when a task completes successfully.
# ============================================================================
#
# EXAMPLE INPUT (JSON via stdin):
# {
#   "clineVersion": "3.17.0",
#   "hookName": "TaskComplete",
#   "taskId": "abc123",
#   "timestamp": "1749484935515",
#   "workspaceRoots": ["/path/to/project"],
#   "userId": "user-123",
#   "taskComplete": {
#     "taskMetadata": { "task": "..." }
#   }
# }
#
# OUTPUT: JSON with { cancel, contextModification, errorMessage }
# ============================================================================

INPUT=$(cat)

# --- Parse JSON ---
get_json_value() {
  local key="$1"
  if command -v jq >/dev/null 2>&1; then
    echo "$INPUT" | jq -r "$key // empty" 2>/dev/null
  else
    echo "$INPUT" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*: *"\\([^"]*\\)".*/\\1/'
  fi
}

TASK_ID=$(get_json_value "taskId")

# --- Example: Log completion ---
# LOG_FILE="\${HOME}/.cline/task-log.txt"
# mkdir -p "$(dirname "$LOG_FILE")"
# echo "[\$(date '+%Y-%m-%d %H:%M:%S')] Task completed: $TASK_ID" >> "$LOG_FILE"

# --- Example: Run tests after task completion ---
# Uncomment to run tests when task completes:
# if [ -f "package.json" ]; then
#   npm test 2>&1 | head -20
# fi

# --- Example: Show git diff summary ---
CONTEXT=""
if [ -d ".git" ]; then
  CHANGES=$(git diff --stat HEAD~1 2>/dev/null | tail -1)
  if [ -n "$CHANGES" ]; then
    CONTEXT="Changes in this session: $CHANGES"
  fi
fi

printf '{"cancel":false,"contextModification":"%s","errorMessage":""}' "$CONTEXT"
`
}

function getPreToolUseTemplate(): string {
	return `#!/bin/bash
# ============================================================================
# PreToolUse Hook
# Runs BEFORE a tool is executed. Can block tool execution.
# ============================================================================
#
# EXAMPLE INPUT (JSON via stdin):
# {
#   "clineVersion": "3.17.0",
#   "hookName": "PreToolUse",
#   "taskId": "abc123",
#   "timestamp": "1749484935515",
#   "workspaceRoots": ["/path/to/project"],
#   "userId": "user-123",
#   "preToolUse": {
#     "toolName": "execute_command",
#     "parameters": {
#       "command": "npm install"
#     }
#   }
# }
#
# OUTPUT: JSON with { cancel, contextModification, errorMessage }
# - Set cancel=true to BLOCK the tool from running
# - errorMessage explains why the tool was blocked
# ============================================================================

INPUT=$(cat)

# --- Parse JSON ---
if command -v jq >/dev/null 2>&1; then
  TOOL_NAME=$(echo "$INPUT" | jq -r '.preToolUse.toolName // empty')
  COMMAND=$(echo "$INPUT" | jq -r '.preToolUse.parameters.command // empty')
  FILE_PATH=$(echo "$INPUT" | jq -r '.preToolUse.parameters.path // empty')
else
  # Fallback parsing for common fields
  TOOL_NAME=$(echo "$INPUT" | grep -o '"toolName"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"toolName"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
  COMMAND=$(echo "$INPUT" | grep -o '"command"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"command"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
  FILE_PATH=$(echo "$INPUT" | grep -o '"path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"path"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
fi

# --- Safety checks ---
CANCEL="false"
ERROR_MSG=""
CONTEXT=""

# Block dangerous commands
if [ "$TOOL_NAME" = "execute_command" ]; then
  # Block recursive force delete at root
  if echo "$COMMAND" | grep -qE 'rm[[:space:]]+-rf[[:space:]]+/[^/]|rm[[:space:]]+-rf[[:space:]]+/$'; then
    CANCEL="true"
    ERROR_MSG="Blocked: Dangerous recursive delete command"
  fi
  
  # Block commands that could expose secrets
  if echo "$COMMAND" | grep -qiE 'curl.*(-d|--data).*password|wget.*password'; then
    CANCEL="true"
    ERROR_MSG="Blocked: Command may expose sensitive data"
  fi
fi

# --- Example: Warn about file operations outside workspace ---
# Uncomment to add warnings for file operations:
# if [ "$TOOL_NAME" = "write_to_file" ] && [ -n "$FILE_PATH" ]; then
#   case "$FILE_PATH" in
#     /*) CONTEXT="Note: Writing to absolute path outside workspace" ;;
#   esac
# fi

# --- Output result ---
if [ "$CANCEL" = "true" ]; then
  printf '{"cancel":true,"contextModification":"","errorMessage":"%s"}' "$ERROR_MSG"
else
  printf '{"cancel":false,"contextModification":"%s","errorMessage":""}' "$CONTEXT"
fi
`
}

function getPostToolUseTemplate(): string {
	return `#!/bin/bash
# ============================================================================
# PostToolUse Hook
# Runs AFTER a tool has executed (success or failure).
# ============================================================================
#
# EXAMPLE INPUT (JSON via stdin):
# {
#   "clineVersion": "3.17.0",
#   "hookName": "PostToolUse",
#   "taskId": "abc123",
#   "timestamp": "1749484935515",
#   "workspaceRoots": ["/path/to/project"],
#   "userId": "user-123",
#   "postToolUse": {
#     "toolName": "write_to_file",
#     "parameters": { "path": "src/index.ts" },
#     "result": "File written successfully",
#     "success": true,
#     "executionTimeMs": 150
#   }
# }
#
# OUTPUT: JSON with { cancel, contextModification, errorMessage }
# ============================================================================

INPUT=$(cat)

# --- Parse JSON ---
if command -v jq >/dev/null 2>&1; then
  TOOL_NAME=$(echo "$INPUT" | jq -r '.postToolUse.toolName // empty')
  SUCCESS=$(echo "$INPUT" | jq -r '.postToolUse.success // empty')
  EXEC_TIME=$(echo "$INPUT" | jq -r '.postToolUse.executionTimeMs // empty')
  FILE_PATH=$(echo "$INPUT" | jq -r '.postToolUse.parameters.path // empty')
else
  TOOL_NAME=$(echo "$INPUT" | grep -o '"toolName"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"toolName"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
  SUCCESS=$(echo "$INPUT" | grep -o '"success"[[:space:]]*:[[:space:]]*[a-z]*' | head -1 | sed 's/.*:[[:space:]]*//')
  EXEC_TIME=$(echo "$INPUT" | grep -o '"executionTimeMs"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | sed 's/.*:[[:space:]]*//')
  FILE_PATH=$(echo "$INPUT" | grep -o '"path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"path"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
fi

# --- Example: Log tool usage ---
# LOG_FILE="\${HOME}/.cline/tool-log.txt"
# mkdir -p "$(dirname "$LOG_FILE")"
# echo "[\$(date '+%Y-%m-%d %H:%M:%S')] $TOOL_NAME: success=$SUCCESS time=\${EXEC_TIME}ms" >> "$LOG_FILE"

# --- Example: Track slow operations ---
CONTEXT=""
if [ -n "$EXEC_TIME" ] && [ "$EXEC_TIME" -gt 5000 ] 2>/dev/null; then
  CONTEXT="Note: $TOOL_NAME took \${EXEC_TIME}ms (>5s)"
fi

# --- Example: Notify about file changes ---
# Uncomment to add context after file modifications:
# if [ "$TOOL_NAME" = "write_to_file" ] && [ "$SUCCESS" = "true" ]; then
#   CONTEXT="File modified: $FILE_PATH"
# fi

printf '{"cancel":false,"contextModification":"%s","errorMessage":""}' "$CONTEXT"
`
}

function getUserPromptSubmitTemplate(): string {
	return `#!/bin/bash
# ============================================================================
# UserPromptSubmit Hook
# Runs when the user submits a prompt to Cline.
# ============================================================================
#
# EXAMPLE INPUT (JSON via stdin):
# {
#   "clineVersion": "3.17.0",
#   "hookName": "UserPromptSubmit",
#   "taskId": "abc123",
#   "timestamp": "1749484935515",
#   "workspaceRoots": ["/path/to/project"],
#   "userId": "user-123",
#   "userPromptSubmit": {
#     "prompt": "Add a new login feature",
#     "attachments": []
#   }
# }
#
# OUTPUT: JSON with { cancel, contextModification, errorMessage }
# - Set cancel=true to block the prompt from being sent
# ============================================================================

INPUT=$(cat)

# --- Parse JSON ---
if command -v jq >/dev/null 2>&1; then
  PROMPT=$(echo "$INPUT" | jq -r '.userPromptSubmit.prompt // empty')
  TASK_ID=$(echo "$INPUT" | jq -r '.taskId // empty')
else
  PROMPT=$(echo "$INPUT" | grep -o '"prompt"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"prompt"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
  TASK_ID=$(echo "$INPUT" | grep -o '"taskId"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"taskId"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
fi

# --- Example: Log prompts for analytics ---
# LOG_FILE="\${HOME}/.cline/prompt-log.txt"
# mkdir -p "$(dirname "$LOG_FILE")"
# echo "[\$(date '+%Y-%m-%d %H:%M:%S')] $TASK_ID: $PROMPT" >> "$LOG_FILE"

# --- Example: Add context based on prompt content ---
CONTEXT=""

# Detect if user is asking about tests
if echo "$PROMPT" | grep -qiE '\\btest|\\bspec|\\bjest|\\bmocha'; then
  if [ -f "jest.config.js" ] || [ -f "jest.config.ts" ]; then
    CONTEXT="Project uses Jest for testing."
  elif [ -f ".mocharc.json" ] || [ -f ".mocharc.js" ]; then
    CONTEXT="Project uses Mocha for testing."
  fi
fi

# Detect if user is asking about deployment
if echo "$PROMPT" | grep -qiE '\\bdeploy|\\bproduction|\\brelease'; then
  if [ -f ".github/workflows/deploy.yml" ]; then
    CONTEXT="Project has GitHub Actions deployment workflow."
  elif [ -f "Dockerfile" ]; then
    CONTEXT="Project uses Docker for deployment."
  fi
fi

printf '{"cancel":false,"contextModification":"%s","errorMessage":""}' "$CONTEXT"
`
}

function getPreCompactTemplate(): string {
	return `#!/bin/bash
# ============================================================================
# PreCompact Hook
# Runs before the conversation context is compacted (to free up token space).
# ============================================================================
#
# EXAMPLE INPUT (JSON via stdin):
# {
#   "clineVersion": "3.17.0",
#   "hookName": "PreCompact",
#   "taskId": "abc123",
#   "timestamp": "1749484935515",
#   "workspaceRoots": ["/path/to/project"],
#   "userId": "user-123",
#   "preCompact": {
#     "contextSize": 180000,
#     "messagesToCompact": 45,
#     "compactionStrategy": "half"
#   }
# }
#
# OUTPUT: JSON with { cancel, contextModification, errorMessage }
# - contextModification can add a summary that persists after compaction
# ============================================================================

INPUT=$(cat)

# --- Parse JSON ---
if command -v jq >/dev/null 2>&1; then
  CONTEXT_SIZE=$(echo "$INPUT" | jq -r '.preCompact.contextSize // empty')
  MSG_COUNT=$(echo "$INPUT" | jq -r '.preCompact.messagesToCompact // empty')
  STRATEGY=$(echo "$INPUT" | jq -r '.preCompact.compactionStrategy // empty')
  TASK_ID=$(echo "$INPUT" | jq -r '.taskId // empty')
else
  CONTEXT_SIZE=$(echo "$INPUT" | grep -o '"contextSize"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | sed 's/.*:[[:space:]]*//')
  MSG_COUNT=$(echo "$INPUT" | grep -o '"messagesToCompact"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | sed 's/.*:[[:space:]]*//')
  STRATEGY=$(echo "$INPUT" | grep -o '"compactionStrategy"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
  TASK_ID=$(echo "$INPUT" | grep -o '"taskId"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"taskId"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
fi

# --- Example: Log compaction events ---
# LOG_FILE="\${HOME}/.cline/compaction-log.txt"
# mkdir -p "$(dirname "$LOG_FILE")"
# echo "[\$(date '+%Y-%m-%d %H:%M:%S')] Compacting $MSG_COUNT messages (strategy: $STRATEGY)" >> "$LOG_FILE"

# --- Example: Archive important context before compaction ---
# Uncomment to save a summary before context is lost:
# ARCHIVE_DIR="\${HOME}/.cline/archives"
# mkdir -p "$ARCHIVE_DIR"
# echo "$INPUT" > "$ARCHIVE_DIR/$TASK_ID-\$(date +%s).json"

# --- Example: Add reminder of what was being worked on ---
CONTEXT=""

# Check current git status to remind about work in progress
if [ -d ".git" ]; then
  STAGED=$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')
  if [ "$STAGED" -gt 0 ]; then
    CONTEXT="Note: $STAGED file(s) are staged for commit."
  fi
fi

printf '{"cancel":false,"contextModification":"%s","errorMessage":""}' "$CONTEXT"
`
}

function getDefaultTemplate(hookName: string): string {
	return `#!/bin/bash
# ============================================================================
# ${hookName} Hook
# ============================================================================
#
# INPUT: JSON via stdin (contains taskId, timestamp, hookName, and hook-specific data)
# OUTPUT: JSON to stdout with { cancel, contextModification, errorMessage }
#
# - cancel: boolean - set to true to cancel/block the operation
# - contextModification: string - text to add to the conversation context
# - errorMessage: string - error message to show if cancelled
# ============================================================================

INPUT=$(cat)

# --- Parse JSON ---
if command -v jq >/dev/null 2>&1; then
  TASK_ID=$(echo "$INPUT" | jq -r '.taskId // empty')
else
  TASK_ID=$(echo "$INPUT" | grep -o '"taskId"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"taskId"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/')
fi

# --- Your hook logic here ---
# Add your custom logic below

# --- Output result ---
printf '{"cancel":false,"contextModification":"","errorMessage":""}'
`
}
