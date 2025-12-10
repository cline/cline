import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { findLast, parsePartialArrayString } from "@shared/array"
import { ClineAsk, ClineAskQuestion } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import { telemetryService } from "@/services/telemetry"
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import { ToolResponse } from "../.."
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class AskFollowupQuestionToolHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.ASK

	getDescription(block: ToolUse): string {
		return `[${block.name} for '${block.params.question}']`
	}

	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const question = block.params.question || ""
		const optionsRaw = block.params.options || "[]"
		const sharedMessage = {
			question: uiHelpers.removeClosingTag(block, "question", question),
			options: parsePartialArrayString(uiHelpers.removeClosingTag(block, "options", optionsRaw)),
		} satisfies ClineAskQuestion

		await uiHelpers.ask("followup" as ClineAsk, JSON.stringify(sharedMessage), block.partial).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const question: string | undefined = block.params.question
		const optionsRaw: string | undefined = block.params.options

		// Validate required parameter
		if (!question) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(this.name, "question")
		}
		config.taskState.consecutiveMistakeCount = 0

		// Show notification if enabled
		if (config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: "Cline has a question...",
				message: question.replace(/\n/g, " "),
			})
		}

		const sharedMessage = {
			question: question,
			options: parsePartialArrayString(optionsRaw || "[]"),
		} satisfies ClineAskQuestion

		const options = parsePartialArrayString(optionsRaw || "[]")

		// Ask the question
		const {
			text,
			images,
			files: followupFiles,
		} = await config.callbacks.ask("followup", JSON.stringify(sharedMessage), false)

		// Check if options contains the text response
		if (optionsRaw && text && options.includes(text)) {
			telemetryService.captureOptionSelected(config.ulid, options.length, "act")

			// Valid option selected, update last followup message with selected option
			const clineMessages = config.messageState.getClineMessages()
			const lastFollowupMessage = findLast(clineMessages, (m: any) => m.ask === "followup")
			if (lastFollowupMessage) {
				lastFollowupMessage.text = JSON.stringify({
					...sharedMessage,
					selected: text,
				} satisfies ClineAskQuestion)
				await config.messageState.saveClineMessagesAndUpdateHistory()
			}
		} else {
			// Option not selected, send user feedback
			telemetryService.captureOptionsIgnored(config.ulid, options.length, "act")
			await config.callbacks.say("user_feedback", text ?? "", images, followupFiles)
		}

		// Process any attached files
		let fileContentString = ""
		if (followupFiles && followupFiles.length > 0) {
			fileContentString = await processFilesIntoText(followupFiles)
		}

		return formatResponse.toolResult(`<answer>\n${text}\n</answer>`, images, fileContentString)
	}
}
