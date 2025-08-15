import { ToolUse } from "@core/assistant-message"
import { ToolResponse } from "@core/task"
import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { isNextGenModelFamily } from "@utils/model-utils"
import { ApiHandler } from "@api/index"

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
		api: ApiHandler,
		markToolAsUsed: () => void,
	): void {
		const isNextGenModel = isNextGenModelFamily(api)

		if (typeof content === "string") {
			const resultText = content || "(tool did not return anything)"

			// Non-Claude 4: Use traditional format with header
			userMessageContent.push({
				type: "text",
				text: `${toolDescription(block)} Result:`,
			})
			userMessageContent.push({
				type: "text",
				text: resultText,
			})
		} else {
			userMessageContent.push(...content)
		}
		// once a tool result has been collected, ignore all other tool uses since we should only ever present one tool result per message
		markToolAsUsed()
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
		if (!feedback && (!images || images.length === 0) && !fileContentString) {
			return
		}
		const content = formatResponse.toolResult(
			`The user provided the following feedback:\n<feedback>\n${feedback}\n</feedback>`,
			images,
			fileContentString,
		)
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
	 * Process files into text content for feedback
	 */
	static async processFilesForFeedback(files?: string[]): Promise<string> {
		if (!files || files.length === 0) {
			return ""
		}
		return await processFilesIntoText(files)
	}
}
