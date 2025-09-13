import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ensureTaskDirectoryExists } from "@core/storage/disk"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { ClineAsk } from "@shared/ExtensionMessage"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class CondenseHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = "condense"

	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
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

		// Show notification if auto-approval is enabled
		if (config.autoApprovalSettings.enabled && config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: "Cline wants to condense the conversation...",
				message: `Cline is suggesting to condense your conversation with: ${context}`,
			})
		}

		// Ask user for response
		const { text, images, files: condenseFiles } = await config.callbacks.ask("condense", context, false)

		// If the user provided a response, treat it as feedback
		if (text || (images && images.length > 0) || (condenseFiles && condenseFiles.length > 0)) {
			let fileContentString = ""
			if (condenseFiles && condenseFiles.length > 0) {
				fileContentString = await processFilesIntoText(condenseFiles)
			}

			await config.callbacks.say("user_feedback", text ?? "", images, condenseFiles)
			return formatResponse.toolResult(
				`The user provided feedback on the condensed conversation summary:\n<feedback>\n${text}\n</feedback>`,
				images,
				fileContentString,
			)
		} else {
			// If no response, the user accepted the condensed version
			const apiConversationHistory = config.messageState.getApiConversationHistory()
			const lastMessage = apiConversationHistory[apiConversationHistory.length - 1]
			const summaryAlreadyAppended = lastMessage && lastMessage.role === "assistant"
			const keepStrategy = summaryAlreadyAppended ? "lastTwo" : "none"

			// clear the context history at this point in time
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

			return formatResponse.toolResult(formatResponse.condense())
		}
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const context = block.params.context || ""
		const cleanedContext = uiHelpers.removeClosingTag(block, "context", context)

		await uiHelpers.removeLastPartialMessageIfExistsWithType("say", "condense")
		await uiHelpers.ask("condense" as ClineAsk, cleanedContext, block.partial).catch(() => {})
	}
}
