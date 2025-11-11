import { ApiHandler } from "@core/api"
import { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ToolResponse } from "@core/task"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { Logger } from "@services/logging/Logger"
import { telemetryService } from "@services/telemetry"
import { ClineAsk } from "@shared/ExtensionMessage"
import { showNotificationForApproval } from "../../utils"
import type { ToolExecutorCoordinator } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

/**
 * Utility functions for handling tool results and feedback
 */
export class ToolResultUtils {
	/**
	 * Push tool result to user message content with proper formatting
	 */
	static pushToolResult(
		content: ToolResponse,
		block: ToolUse,
		userMessageContent: any[],
		toolDescription: (block: ToolUse) => string,
		_api: ApiHandler,
		markToolAsUsed: () => void,
		coordinator?: ToolExecutorCoordinator,
		toolUseIdMap?: Map<string, string>,
	): void {
		if (typeof content === "string") {
			const resultText = content || "(tool did not return anything)"

			// Try to get description from coordinator first, otherwise use the provided function
			const description = coordinator
				? (() => {
						const handler = coordinator.getHandler(block.name)
						return handler ? handler.getDescription(block) : toolDescription(block)
					})()
				: toolDescription(block)

			// Get tool_use_id from map, or use "cline" as fallback for backward compatibility
			const toolUseId = toolUseIdMap?.get(block.name) || "cline"

			// If we have already added a tool result for this tool use, skip adding another one
			if (
				userMessageContent.some((item) => item.type === "tool_result" && item.tool_use_id === toolUseId && item.content)
			) {
				Logger.warn(`ToolResultUtils: Tool result for tool_use_id ${toolUseId} already exists. Skipping duplicate.`)
				return
			}

			// Create ToolResultBlockParam with description and result
			userMessageContent.push(ToolResultUtils.createToolResultBlock(`${description} Result:\n${resultText}`, toolUseId))
		} else {
			// For complex content (arrays with text/image blocks), pass it through directly
			// The content array should already be properly formatted with type, text, source, etc.
			const toolUseId = toolUseIdMap?.get(block.name) || "cline"
			userMessageContent.push(ToolResultUtils.createToolResultBlock(content, toolUseId))
		}
		// once a tool result has been collected, ignore all other tool uses since we should only ever present one tool result per message
		markToolAsUsed()
	}

	private static createToolResultBlock(content: ToolResponse, id?: string) {
		// If id is "cline", we treat it as a plain text result for backward compatibility
		// as we cannot find any existing tool call that matches this id.
		if (id === "cline") {
			return {
				type: "text",
				text: typeof content === "string" ? content : JSON.stringify(content, null, 2),
			}
		}

		// For tool_result blocks, content can be either a string or an array of content blocks
		// When it's a string, we need to wrap it in the proper format
		// When it's an array, it should already be properly formatted (e.g., with text and image blocks)
		return {
			type: "tool_result",
			tool_use_id: id,
			content: typeof content === "string" ? content : content,
		}
	}

	/**
	 * Push additional tool feedback from user to message content
	 */
	static pushAdditionalToolFeedback(
		userMessageContent: any[],
		feedback?: string,
		images?: string[],
		fileContentString?: string,
	): void {
		// Check if we have any meaningful content to add
		const hasMeaningfulFeedback = feedback && feedback.trim() !== ""
		const hasImages = images && images.length > 0
		const hasMeaningfulFileContent = fileContentString && fileContentString.trim() !== ""

		// Only proceed if we have at least one meaningful piece of content
		if (!hasMeaningfulFeedback && !hasImages && !hasMeaningfulFileContent) {
			return
		}

		// Build the feedback text only if we have meaningful feedback
		const feedbackText = hasMeaningfulFeedback
			? `The user provided the following feedback:\n<feedback>\n${feedback}\n</feedback>`
			: "The user provided additional content:"

		const content = formatResponse.toolResult(feedbackText, images, hasMeaningfulFileContent ? fileContentString : undefined)
		if (typeof content === "string") {
			userMessageContent.push({
				type: "text",
				text: content,
			})
		} else {
			userMessageContent.push(...content)
		}
	}

	/**
	 * Handles tool approval flow and processes any user feedback
	 * Returns approval status and the timestamp of the tool ask message (for hook ordering)
	 */
	static async askApprovalAndPushFeedback(
		type: ClineAsk,
		completeMessage: string,
		config: TaskConfig,
	): Promise<{ didApprove: boolean; askTs?: number }> {
		const { response, text, images, files } = await config.callbacks.ask(type, completeMessage, false)
		// Get the timestamp from the ask message that was just created
		const askTs = config.messageState.getClineMessages().at(-1)?.ts

		if (text || (images && images.length > 0) || (files && files.length > 0)) {
			let fileContentString = ""
			if (files && files.length > 0) {
				fileContentString = await processFilesIntoText(files)
			}

			ToolResultUtils.pushAdditionalToolFeedback(config.taskState.userMessageContent, text, images, fileContentString)
			await config.callbacks.say("user_feedback", text, images, files)
		}

		if (response !== "yesButtonClicked") {
			// User pressed reject button or responded with a message, which we treat as a rejection
			config.taskState.didRejectTool = true // Prevent further tool uses in this message
			return { didApprove: false, askTs }
		} else {
			// User hit the approve button, and may have provided feedback
			return { didApprove: true, askTs }
		}
	}

	/**
	 * Shows a notification for tool approval (respecting user settings)
	 */
	static showToolNotification(notificationMessage: string, enableNotifications: boolean): void {
		showNotificationForApproval(notificationMessage, enableNotifications)
	}

	/**
	 * Asks for tool approval and handles user feedback
	 * Returns approval status and ask timestamp
	 */
	static async askToolApproval(
		config: TaskConfig,
		askType: ClineAsk,
		completeMessage: string,
	): Promise<{ didApprove: boolean; askTs?: number }> {
		const { didApprove, askTs } = await ToolResultUtils.askApprovalAndPushFeedback(askType, completeMessage, config)
		config.taskState.currentToolAskMessageTs = askTs
		return { didApprove, askTs }
	}

	/**
	 * Sends a tool approval message and updates the timestamp
	 */
	static async sendToolMessage(config: TaskConfig, sayType: "tool" | "use_mcp_server", completeMessage: string): Promise<void> {
		const sayTs = await config.callbacks.say(sayType, completeMessage, undefined, undefined, false)
		// When completing a partial message, say() returns undefined but updates the existing message
		config.taskState.currentToolAskMessageTs = sayTs ?? config.messageState.getClineMessages().at(-1)?.ts
	}

	/**
	 * Captures telemetry for an auto-approved tool execution
	 */
	static captureAutoApprovedTool(config: TaskConfig, block: ToolUse, workspaceContext?: any): void {
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		telemetryService.captureToolUsage(
			config.ulid,
			block.name,
			config.api.getModel().id,
			provider,
			true, // autoApproved
			true, // approved
			workspaceContext,
			block.isNativeToolCall,
		)
	}

	/**
	 * Captures telemetry for a manually approved tool execution
	 */
	static captureApprovedTool(config: TaskConfig, block: ToolUse, workspaceContext?: any): void {
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		telemetryService.captureToolUsage(
			config.ulid,
			block.name,
			config.api.getModel().id,
			provider,
			false, // autoApproved
			true, // approved
			workspaceContext,
			block.isNativeToolCall,
		)
	}

	/**
	 * Captures telemetry for a denied tool execution
	 */
	static captureDeniedTool(config: TaskConfig, block: ToolUse, workspaceContext?: any): void {
		const apiConfig = config.services.stateManager.getApiConfiguration()
		const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
		const provider = (currentMode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string

		telemetryService.captureToolUsage(
			config.ulid,
			block.name,
			config.api.getModel().id,
			provider,
			false, // autoApproved
			false, // approved
			workspaceContext,
			block.isNativeToolCall,
		)
	}

	/**
	 * Helper for the common sub-pattern of cleaning up partial messages and sending the complete message
	 * Used in auto-approval flows where we convert "ask" messages to "say" messages
	 */
	static async cleanupAndSendToolMessage(
		config: TaskConfig,
		messageType: "tool" | "use_mcp_server",
		completeMessage: string,
	): Promise<void> {
		await config.callbacks.removeLastPartialMessageIfExistsWithType("ask", messageType)
		await ToolResultUtils.sendToolMessage(config, messageType, completeMessage)
	}

	/**
	 * Helper for the common sub-pattern of handling approval results with telemetry
	 * Returns the appropriate response if denied, or undefined if approved (to continue execution)
	 */
	static handleApprovalResult(
		didApprove: boolean,
		config: TaskConfig,
		block: ToolUse,
		workspaceContext?: any,
	): ToolResponse | undefined {
		if (!didApprove) {
			ToolResultUtils.captureDeniedTool(config, block, workspaceContext)
			return formatResponse.toolDenied()
		}
		ToolResultUtils.captureApprovedTool(config, block, workspaceContext)
		return undefined
	}

	/**
	 * Executes manual approval flow for MCP operations (both tools and resources).
	 * Handles notification, cleanup, approval, and telemetry for MCP server interactions.
	 *
	 * @param config Task configuration
	 * @param block The tool use block being executed
	 * @param notificationMessage The full notification message to display to the user
	 * @param completeMessage The complete message to send for approval
	 * @returns ToolResponse if denied (to return early), or undefined if approved (to continue execution)
	 */
	static async executeManualApprovalForMcpOperation(
		config: TaskConfig,
		block: ToolUse,
		notificationMessage: string,
		completeMessage: string,
	): Promise<ToolResponse | undefined> {
		ToolResultUtils.showToolNotification(notificationMessage, config.autoApprovalSettings.enableNotifications)
		await config.callbacks.removeLastPartialMessageIfExistsWithType("say", "use_mcp_server")
		const { didApprove } = await ToolResultUtils.askToolApproval(config, "use_mcp_server", completeMessage)
		return ToolResultUtils.handleApprovalResult(didApprove, config, block)
	}
}
