import { ApiHandler } from "@core/api"
import { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ToolResponse } from "@core/task"
import { processFilesIntoText } from "@/integrations/misc/extract-text"
import { ClineAsk } from "@/shared/ExtensionMessage"
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
	 */
	static async askApprovalAndPushFeedback(type: ClineAsk, completeMessage: string, config: TaskConfig) {
		const { response, text, images, files } = await config.callbacks.ask(type, completeMessage, false)

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
			return false
		} else {
			// User hit the approve button, and may have provided feedback
			return true
		}
	}
}
