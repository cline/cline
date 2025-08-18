import { formatResponse } from "@core/prompts/responses"
import { continuationPrompt } from "@core/prompts/contextManagement"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import type { ToolUse } from "@core/assistant-message"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"

export class SummarizeTaskHandler implements IToolHandler {
	readonly name = "summarize_task"

	constructor() {}

	async execute(config: any, block: ToolUse): Promise<ToolResponse> {
		// For partial blocks, don't execute yet
		if (block.partial) {
			return ""
		}

		const context: string | undefined = block.params.context

		// Validate required parameters
		if (!context) {
			config.taskState.consecutiveMistakeCount++
			return "Missing required parameter: context"
		}

		config.taskState.consecutiveMistakeCount = 0

		// Show completed summary in tool UI
		await config.callbacks.say(
			"tool",
			JSON.stringify({
				tool: "summarizeTask",
				content: context,
			}),
			undefined,
			undefined,
			false,
		)

		// Use the continuationPrompt to format the tool result
		const toolResult = formatResponse.toolResult(continuationPrompt(context))

		// Handle context management
		const apiConversationHistory = config.messageState.getApiConversationHistory()
		const keepStrategy = "none"

		// clear the context history at this point in time. note that this will not include the assistant message
		// for summarizing, which we will need to delete later
		config.taskState.conversationHistoryDeletedRange = config.services.contextManager.getNextTruncationRange(
			apiConversationHistory,
			config.taskState.conversationHistoryDeletedRange,
			keepStrategy,
		)
		await config.messageState.saveClineMessagesAndUpdateHistory()
		await config.services.contextManager.triggerApplyStandardContextTruncationNoticeChange(
			Date.now(),
			await ensureTaskDirectoryExists(config.context, config.taskId),
		)

		// Set summarizing state
		config.taskState.currentlySummarizing = true

		return toolResult
	}
}
