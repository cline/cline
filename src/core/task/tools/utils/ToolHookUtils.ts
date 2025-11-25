import type { ToolUse } from "@core/assistant-message"
import { PreToolUseHookCancellationError } from "@core/hooks/PreToolUseHookCancellationError"
import type { TaskConfig } from "../types/TaskConfig"

/**
 * Utility functions for tool hook execution.
 */
export class ToolHookUtils {
	/**
	 * Runs the PreToolUse hook if enabled.
	 *
	 * This should be called by tool handlers after approval succeeds
	 * but before the actual tool execution begins.
	 *
	 * @param config The task configuration
	 * @param block The tool use block being executed
	 * @returns Promise<boolean> - true if execution should continue, false if hook cancelled
	 * @throws PreToolUseHookCancellationError if the hook requests cancellation
	 */
	static async runPreToolUseIfEnabled(config: TaskConfig, block: ToolUse): Promise<boolean> {
		// Check if hooks are enabled via user setting
		const hooksEnabled = config.services.stateManager.getGlobalSettingsKey("hooksEnabled")

		if (!hooksEnabled) {
			return true // Hooks disabled, continue execution
		}

		if (block.name == "attempt_completion") {
			return true // Skip this hook
		}

		// Import the hook executor dynamically
		const { executeHook } = await import("@core/hooks/hook-executor")

		// Build pending tool info for display
		const pendingToolInfo: any = {
			tool: block.name,
		}

		// Add relevant parameters for display based on tool type
		if (block.params.path) {
			pendingToolInfo.path = block.params.path
		}
		if (block.params.command) {
			pendingToolInfo.command = block.params.command
		}
		if (block.params.content && typeof block.params.content === "string") {
			pendingToolInfo.content = block.params.content.slice(0, 200)
		}
		if (block.params.diff && typeof block.params.diff === "string") {
			pendingToolInfo.diff = block.params.diff.slice(0, 200)
		}
		if (block.params.regex) {
			pendingToolInfo.regex = block.params.regex
		}
		if (block.params.url) {
			pendingToolInfo.url = block.params.url
		}
		// For MCP operations, show tool/resource identifiers
		if (block.params.tool_name) {
			pendingToolInfo.mcpTool = block.params.tool_name
		}
		if (block.params.server_name) {
			pendingToolInfo.mcpServer = block.params.server_name
		}
		if (block.params.uri) {
			pendingToolInfo.resourceUri = block.params.uri
		}

		// Execute the PreToolUse hook
		const preToolResult = await executeHook({
			hookName: "PreToolUse",
			hookInput: {
				preToolUse: {
					toolName: block.name,
					parameters: block.params,
				},
			},
			isCancellable: true,
			say: config.callbacks.say,
			setActiveHookExecution: config.callbacks.setActiveHookExecution,
			clearActiveHookExecution: config.callbacks.clearActiveHookExecution,
			messageStateHandler: config.messageState,
			taskId: config.taskId,
			hooksEnabled,
			toolName: block.name,
			pendingToolInfo,
		})

		// Handle cancellation from hook
		if (preToolResult.cancel === true) {
			// Clear the active hook execution state BEFORE calling cancelTask
			// This prevents abortTask from trying to "cancel" an already-completed hook
			await config.callbacks.clearActiveHookExecution()

			// Abort the entire task (consistent with PostToolUse and other hook cancellations)
			await config.callbacks.cancelTask()
			throw new PreToolUseHookCancellationError(preToolResult.errorMessage || "PreToolUse hook requested cancellation")
		}

		// If task was aborted (e.g., via cancel button during hook), throw cancellation error
		if (config.taskState.abort) {
			throw new PreToolUseHookCancellationError("Task was aborted during PreToolUse hook execution")
		}

		// Add context modification to the conversation if provided by the hook
		if (preToolResult.contextModification) {
			ToolHookUtils.addHookContextToConversation(config, preToolResult.contextModification, "PreToolUse")
		}

		return true // Hook succeeded, continue execution
	}

	/**
	 * Adds hook context modification to the conversation if provided.
	 * Parses the context to extract type prefix and formats as XML.
	 *
	 * @param config The task configuration
	 * @param contextModification The context string from the hook output
	 * @param source The hook source name ("PreToolUse" or "PostToolUse")
	 */
	private static addHookContextToConversation(
		config: TaskConfig,
		contextModification: string | undefined,
		source: string,
	): void {
		if (!contextModification) {
			return
		}

		const contextText = contextModification.trim()
		if (!contextText) {
			return
		}

		// Extract context type from first line if specified (e.g., "WORKSPACE_RULES: ...")
		const lines = contextText.split("\n")
		const firstLine = lines[0]
		let contextType = "general"
		let content = contextText

		// Check if first line specifies a type: "TYPE: content"
		const typeMatchRegex = /^([A-Z_]+):\s*(.*)/
		const typeMatch = typeMatchRegex.exec(firstLine)
		if (typeMatch) {
			contextType = typeMatch[1].toLowerCase()
			const remainingLines = lines.slice(1).filter((l: string) => l.trim())
			content = typeMatch[2] ? [typeMatch[2], ...remainingLines].join("\n") : remainingLines.join("\n")
		}

		const hookContextBlock = {
			type: "text" as const,
			text: `<hook_context source="${source}" type="${contextType}">\n${content}\n</hook_context>`,
		}

		config.taskState.userMessageContent.push(hookContextBlock)
	}
}
