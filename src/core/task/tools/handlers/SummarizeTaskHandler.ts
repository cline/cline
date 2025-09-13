import type { ToolUse } from "@core/assistant-message"
import { continuationPrompt } from "@core/prompts/contextManagement"
import { formatResponse } from "@core/prompts/responses"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { telemetryService } from "@services/posthog/PostHogClientProvider"
import { ClineSayTool } from "@shared/ExtensionMessage"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class SummarizeTaskHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = "summarize_task"

	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		// For partial blocks, don't execute yet
		if (block.partial) {
			return ""
		}

		try {
			const context: string | undefined = block.params.context

			// Validate required parameters
			if (!context) {
				config.taskState.consecutiveMistakeCount++
				return "Missing required parameter: context"
			}

			config.taskState.consecutiveMistakeCount = 0

			// Show completed summary in tool UI
			const completeMessage = JSON.stringify({
				tool: "summarizeTask",
				content: context,
			} satisfies ClineSayTool)

			await config.callbacks.say("tool", completeMessage, undefined, undefined, false)

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
				apiConversationHistory,
			)

			// Set summarizing state
			config.taskState.currentlySummarizing = true

			// Capture telemetry after main business logic is complete
			const telemetryData = config.services.contextManager.getContextTelemetryData(
				config.messageState.getClineMessages(),
				config.api,
				config.taskState.lastAutoCompactTriggerIndex,
			)

			if (telemetryData) {
				telemetryService.captureSummarizeTask(
					config.ulid,
					config.api.getModel().id,
					telemetryData.tokensUsed,
					telemetryData.maxContextWindow,
				)
			}

			return toolResult
		} catch (error) {
			return `Error summarizing context window: ${(error as Error).message}`
		}
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const context = block.params.context || ""

		// Show streaming summary generation in tool UI
		const partialMessage = JSON.stringify({
			tool: "summarizeTask",
			content: uiHelpers.removeClosingTag(block, "context", context),
		} satisfies ClineSayTool)

		await uiHelpers.say("tool", partialMessage, undefined, undefined, block.partial)
	}
}
