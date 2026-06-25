import { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ToolResponse } from "@core/task"
import { processFilesIntoText } from "@/integrations/misc/extract-text"
import { ClineAsk } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { getMiddleTruncationParts, truncateMiddle } from "@utils/string"
import type { ToolExecutorCoordinator } from "../ToolExecutorCoordinator"
import { TaskConfig } from "../types/TaskConfig"

export const MAX_TOOL_RESULT_TEXT_CHARS = 8_000
const TOOL_RESULT_TRUNCATION_REASON = "tool result truncated"
type ToolResponseBlocks = Exclude<ToolResponse, string>

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

			// Get tool_use_id from map using call_id, or use "cline" as fallback for backward compatibility
			const toolUseId = toolUseIdMap?.get(block.call_id || "") || "cline"

			// If we have already added a tool result for this tool use, skip adding another one
			if (
				userMessageContent.some((item) => item.type === "tool_result" && item.tool_use_id === toolUseId && item.content)
			) {
				Logger.warn(`ToolResultUtils: Tool result for tool_use_id ${toolUseId} already exists. Skipping duplicate.`)
				return
			}

			// Create ToolResultBlockParam with description and result
			userMessageContent.push(
				ToolResultUtils.createToolResultBlock(`${description} Result:\n${resultText}`, toolUseId, block.call_id),
			)
		} else {
			// For complex content (arrays with text/image blocks), pass it through directly
			// The content array should already be properly formatted with type, text, source, etc.
			const toolUseId = toolUseIdMap?.get(block.call_id || "") || "cline"

			// If using backward-compatible "cline" ID and content is an array, spread it directly
			// instead of wrapping it (which would cause JSON.stringify in createToolResultBlock)
			if ((toolUseId === "cline" || !toolUseId) && Array.isArray(content)) {
				userMessageContent.push(...ToolResultUtils.truncateToolResponseBlocks(content))
			} else {
				userMessageContent.push(ToolResultUtils.createToolResultBlock(content, toolUseId, block.call_id))
			}
		}
	}

	private static createToolResultBlock(content: ToolResponse, id?: string, call_id?: string) {
		// If id is "cline", we treat it as a plain text result for backward compatibility
		// as we cannot find any existing tool call that matches this id.
		if (id === "cline" || !id) {
			const text =
				typeof content === "string"
					? content
					: JSON.stringify(ToolResultUtils.truncateToolResponseContent(content), null, 2)
			return {
				type: "text",
				text: ToolResultUtils.truncateToolResultText(text),
			}
		}

		// For tool_result blocks, content can be either a string or an array of content blocks
		// When it's a string, we need to wrap it in the proper format
		// When it's an array, it should already be properly formatted (e.g., with text and image blocks)
		return {
			type: "tool_result",
			tool_use_id: id,
			call_id: call_id,
			content: ToolResultUtils.truncateToolResponseContent(content),
		}
	}

	private static truncateToolResponseContent(content: ToolResponse): ToolResponse {
		return typeof content === "string"
			? ToolResultUtils.truncateToolResultText(content)
			: ToolResultUtils.truncateToolResponseBlocks(content)
	}

	private static truncateToolResponseBlocks(content: ToolResponseBlocks): ToolResponseBlocks {
		const textLength = content.reduce((total, block) => {
			return block.type === "text" ? total + block.text.length : total
		}, 0)
		const truncation = getMiddleTruncationParts(
			textLength,
			MAX_TOOL_RESULT_TEXT_CHARS,
			ToolResultUtils.createToolResultTruncationMarker,
		)
		if (!truncation) {
			return content
		}

		const prefixText = ToolResultUtils.takeTextFromStart(content, truncation.prefixChars)
		const suffixText = ToolResultUtils.takeTextFromEnd(content, truncation.suffixChars)
		const nonTextBlocks = content.filter((block) => block.type !== "text")
		const truncatedBlocks: ToolResponseBlocks = []
		if (prefixText) {
			truncatedBlocks.push({ type: "text", text: prefixText })
		}
		if (truncation.marker) {
			truncatedBlocks.push({ type: "text", text: truncation.marker })
		}
		truncatedBlocks.push(...nonTextBlocks)
		if (suffixText) {
			truncatedBlocks.push({ type: "text", text: suffixText })
		}
		return truncatedBlocks
	}

	private static takeTextFromStart(content: ToolResponseBlocks, chars: number): string {
		let remaining = chars
		let text = ""
		for (const block of content) {
			if (remaining <= 0) {
				break
			}
			if (block.type !== "text") {
				continue
			}
			const chunk = block.text.slice(0, remaining)
			text += chunk
			remaining -= chunk.length
		}
		return text
	}

	private static takeTextFromEnd(content: ToolResponseBlocks, chars: number): string {
		let remaining = chars
		let text = ""
		for (let i = content.length - 1; i >= 0 && remaining > 0; i--) {
			const block = content[i]
			if (block.type !== "text") {
				continue
			}
			const chunk = block.text.slice(Math.max(0, block.text.length - remaining))
			text = `${chunk}${text}`
			remaining -= chunk.length
		}
		return text
	}

	private static truncateToolResultText(text: string): string {
		return truncateMiddle(text, MAX_TOOL_RESULT_TEXT_CHARS, ToolResultUtils.createToolResultTruncationMarker)
	}

	private static createToolResultTruncationMarker(removed: number): string {
		return `\n... (${TOOL_RESULT_TRUNCATION_REASON}, ${removed} chars omitted) ...\n`
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
		if (config.isSubagentExecution) {
			return true
		}

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
		}
		// User hit the approve button, and may have provided feedback
		return true
	}
}
