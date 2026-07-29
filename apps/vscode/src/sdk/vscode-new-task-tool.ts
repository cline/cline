/**
 * Custom `new_task` tool + `/newtask` slash-command expansion.
 *
 * Ports the legacy extension's `/newtask` flow to the SDK runtime:
 *   1. The user sends `/newtask [extra instructions]` in an active task.
 *   2. `expandNewTaskSlashCommand()` replaces the token with explicit
 *      instructions telling the model to call the `new_task` tool with a
 *      detailed context summary of the conversation so far.
 *   3. The tool (registered via createVscodeExtraTools) captures the summary
 *      and ends the run (`lifecycle.completesRun`), after which SdkController
 *      emits an `ask: "new_task"` message. The webview renders the existing
 *      "Start New Task with Context" button, whose handler starts a fresh task
 *      preloaded with the captured context.
 */

import type { AgentTool } from "@cline/shared"

export const NEW_TASK_TOOL_NAME = "new_task"

/**
 * Matches a leading-or-whitespace-preceded `/newtask` token followed by
 * whitespace or end-of-string, mirroring the token rules of
 * slash-command-expansion.ts (and the legacy parser) so URLs and file paths
 * never match.
 */
const NEW_TASK_COMMAND_REGEX = /(^|\s)\/newtask(?=\s|$)/i

/**
 * Instructions injected in place of `/newtask`. Adapted from the legacy
 * extension's `newTaskToolResponse()` (core/prompts/commands.ts): the SDK
 * runtime uses native tool calling and registers the `new_task` tool in the
 * session's toolset, so the XML calling convention is omitted.
 */
const NEW_TASK_INSTRUCTIONS = `<explicit_instructions type="new_task">
The user has explicitly asked you to help them create a new task with preloaded context, which you will generate. The user may have provided instructions or additional information for you to consider when summarizing existing work and creating the context for the new task.
Irrespective of whether additional information or instructions are given, you are ONLY allowed to respond to this message by calling the new_task tool. Do not respond with text before or after the tool call.

Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions. This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the new task.
The user will be presented with a preview of your generated context and can choose to create a new task or keep chatting in the current conversation.

The \`context\` argument must, where applicable based on the current task, include:
  1. Current Work: Describe in detail what was being worked on prior to this request to create a new task. Pay special attention to the more recent messages / conversation.
  2. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for the new task.
  3. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  4. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  5. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.

Below is the user's input when they indicated that they wanted to create a new task.
</explicit_instructions>
`

/**
 * Expand the first `/newtask` token in `text` into the explicit new-task
 * instructions, mirroring legacy semantics (instructions first, token
 * removed, the rest of the user's message preserved). Returns the input
 * unchanged when the token is absent.
 */
export function expandNewTaskSlashCommand(text: string): { text: string; expanded: boolean } {
	const match = NEW_TASK_COMMAND_REGEX.exec(text)
	if (!match) {
		return { text, expanded: false }
	}
	const tokenStart = match.index + match[1].length
	const tokenEnd = tokenStart + "/newtask".length
	const remainder = (text.slice(0, tokenStart) + text.slice(tokenEnd)).trim()
	return { text: `${NEW_TASK_INSTRUCTIONS}\n${remainder}`, expanded: true }
}

export interface NewTaskToolInput {
	context?: string
}

export interface CreateNewTaskToolOptions {
	/**
	 * Receives the model-generated context summary. SdkController buffers it
	 * and emits the `ask: "new_task"` message once the turn completes, so the
	 * ask is the final message and the webview enables its button row.
	 */
	onNewTaskContext: (context: string) => void
}

export function createNewTaskTool(options: CreateNewTaskToolOptions): AgentTool {
	return {
		name: NEW_TASK_TOOL_NAME,
		description:
			"Create a detailed summary of the conversation so far to preload a new task with. " +
			"The user will be shown a preview of the context and can choose to start a new task with it. " +
			"Only call this tool when the user has explicitly asked to create a new task.",
		inputSchema: {
			type: "object",
			properties: {
				context: {
					type: "string",
					description:
						"The context to preload the new task with, covering: current work, key technical concepts, " +
						"relevant files and code, problem solving, and pending tasks with next steps.",
				},
			},
			required: ["context"],
		},
		// A successful call ends the run so the emitted ask is the final message.
		lifecycle: { completesRun: true },
		execute: (input) => {
			const { context: rawContext } = (input ?? {}) as NewTaskToolInput
			const context = typeof rawContext === "string" ? rawContext.trim() : ""
			if (!context) {
				return "Error: the `context` argument is required and must not be empty."
			}
			options.onNewTaskContext(context)
			return "The user has been shown a preview of the new task context and can choose to start a new task with it. End your turn now."
		},
	}
}
