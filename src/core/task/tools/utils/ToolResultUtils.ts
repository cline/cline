import { ApiHandler } from "@core/api"
import { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ToolResponse } from "@core/task"
import type { ToolExecutorCoordinator } from "../ToolExecutorCoordinator"

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

			// Non-Claude 4: Use traditional format with header
			userMessageContent.push({
				type: "text",
				text: `${description} Result:`,
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
}
