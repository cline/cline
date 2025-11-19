/**
 * Hook script templates for all supported hook types.
 * Templates are provided as executable Node.js scripts with comprehensive examples.
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
	return `#!/usr/bin/env node
/**
 * TaskStart Hook
 * 
 * Executes when a new task begins.
 * 
 * Input: { taskId, taskStart: { task: string }, clineVersion, timestamp, ... }
 * Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
 * 
 * Use cases:
 * - Log task start time
 * - Add context about environment or project state
 * - Check prerequisites before starting
 * - Notify external systems (Slack, issue trackers, etc.)
 */

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'))

// Example: Log task start
console.error(\`[TaskStart] Task started: \${input.taskStart.task}\`)
console.error(\`[TaskStart] Task ID: \${input.taskId}\`)

// Example: Add context to the task
const contextModification = \`Note: Task started at \${new Date(Number(input.timestamp)).toISOString()}\`

// Return result
console.log(JSON.stringify({
  cancel: false,
  contextModification,
  errorMessage: ""
}))
`
}

function getTaskResumeTemplate(): string {
	return `#!/usr/bin/env node
/**
 * TaskResume Hook
 * 
 * Executes when a task is resumed after being interrupted.
 * 
 * Input: { taskId, taskResume: { task: string }, clineVersion, timestamp, ... }
 * Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
 * 
 * Use cases:
 * - Check for changes since task was paused
 * - Refresh context with latest project state
 * - Notify that work is resuming
 */

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'))

console.error(\`[TaskResume] Resuming task: \${input.taskResume.task}\`)

// Return result
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))
`
}

function getTaskCancelTemplate(): string {
	return `#!/usr/bin/env node
/**
 * TaskCancel Hook
 * 
 * Executes when a task is cancelled by the user.
 * 
 * Input: { taskId, taskCancel: { task: string }, clineVersion, timestamp, ... }
 * Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
 * 
 * Use cases:
 * - Clean up temporary files or resources
 * - Notify external systems about cancellation
 * - Log cancellation for analytics
 */

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'))

console.error(\`[TaskCancel] Task cancelled: \${input.taskCancel.task}\`)

// Return result
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))
`
}

function getTaskCompleteTemplate(): string {
	return `#!/usr/bin/env node
/**
 * TaskComplete Hook
 * 
 * Executes when a task completes successfully.
 * 
 * Input: { taskId, taskComplete: { task: string }, clineVersion, timestamp, ... }
 * Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
 * 
 * Use cases:
 * - Run tests or validation
 * - Generate reports or summaries
 * - Notify stakeholders
 * - Trigger CI/CD pipelines
 */

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'))

console.error(\`[TaskComplete] Task completed: \${input.taskComplete.task}\`)

// Return result
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))
`
}

function getPreToolUseTemplate(): string {
	return `#!/usr/bin/env node
/**
 * PreToolUse Hook
 * 
 * Executes before any tool is used (read_file, write_to_file, execute_command, etc.)
 * 
 * Input: { taskId, preToolUse: { tool: string, parameters: object }, ... }
 * Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
 * 
 * Use cases:
 * - Block dangerous operations
 * - Add safety checks before file modifications
 * - Log tool usage
 * - Validate parameters before execution
 */

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'))

const { tool, parameters } = input.preToolUse

// Example: Block dangerous operations
if (tool === "execute_command" && parameters.command.includes("rm -rf /")) {
  console.log(JSON.stringify({
    cancel: true,
    errorMessage: "Dangerous command blocked by PreToolUse hook"
  }))
  process.exit(0)
}

// Example: Log tool usage
console.error(\`[PreToolUse] Tool about to execute: \${tool}\`)

// Allow execution
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))
`
}

function getPostToolUseTemplate(): string {
	return `#!/usr/bin/env node
/**
 * PostToolUse Hook
 * 
 * Executes after any tool is used successfully or fails.
 * 
 * Input: { 
 *   taskId, 
 *   postToolUse: { 
 *     tool: string, 
 *     parameters: object,
 *     result: string,
 *     success: boolean,
 *     durationMs: number
 *   }, 
 *   ... 
 * }
 * Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
 * 
 * Use cases:
 * - Audit tool usage
 * - Validate results
 * - Trigger follow-up actions
 * - Monitor performance
 */

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'))

const { tool, success, durationMs } = input.postToolUse

console.error(\`[PostToolUse] Tool completed: \${tool} (\${success ? 'success' : 'failed'}) in \${durationMs}ms\`)

// Return result
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))
`
}

function getUserPromptSubmitTemplate(): string {
	return `#!/usr/bin/env node
/**
 * UserPromptSubmit Hook
 * 
 * Executes when the user submits a prompt to Cline.
 * 
 * Input: { taskId, userPromptSubmit: { prompt: string }, clineVersion, timestamp, ... }
 * Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
 * 
 * Use cases:
 * - Log user prompts for analytics
 * - Add context based on prompt content
 * - Validate or sanitize prompts
 * - Trigger external integrations
 */

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'))

const { prompt } = input.userPromptSubmit

console.error(\`[UserPromptSubmit] User submitted prompt (length: \${prompt.length})\`)

// Return result
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))
`
}

function getPreCompactTemplate(): string {
	return `#!/usr/bin/env node
/**
 * PreCompact Hook
 * 
 * Executes before conversation context is compacted (to free up token space).
 * 
 * Input: { 
 *   taskId, 
 *   preCompact: { 
 *     conversationLength: number,
 *     estimatedTokens: number 
 *   }, 
 *   ... 
 * }
 * Output: { cancel: boolean, contextModification?: string, errorMessage?: string }
 * 
 * Use cases:
 * - Archive important conversation parts
 * - Log compaction events
 * - Add summary before context is lost
 */

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'))

const { conversationLength, estimatedTokens } = input.preCompact

console.error(\`[PreCompact] About to compact conversation (messages: \${conversationLength}, tokens: \${estimatedTokens})\`)

// Return result
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))
`
}

function getDefaultTemplate(hookName: string): string {
	return `#!/usr/bin/env node
/**
 * ${hookName} Hook
 * 
 * Input: JSON via stdin
 * Output: JSON to stdout
 */

const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'))

// Your hook logic here
console.error(\`[${hookName}] Executed for task \${input.taskId}\`)

// Return result
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))
`
}
