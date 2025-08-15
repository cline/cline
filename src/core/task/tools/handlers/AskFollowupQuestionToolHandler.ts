import { ClineAskQuestion } from "@shared/ExtensionMessage"
import { parsePartialArrayString, findLast } from "@shared/array"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { telemetryService } from "@services/posthog/PostHogClientProvider"
import { ToolResponse } from "../.."
import { ToolUse } from "../../../assistant-message"
import { formatResponse } from "../../../prompts/responses"
import type { IToolHandler } from "../ToolExecutorCoordinator"
import { ToolUseName } from "../../../assistant-message"

export class AskFollowupQuestionToolHandler implements IToolHandler {
	name = "ask_followup_question"
	supportedTools: ToolUseName[] = ["ask_followup_question"]

	async execute(config: any, block: ToolUse): Promise<ToolResponse> {
		const question: string | undefined = block.params.question
		const optionsRaw: string | undefined = block.params.options

		if (!question) {
			throw new Error("Question is required for ask_followup_question")
		}

		// Store the number of options for telemetry
		const options = parsePartialArrayString(optionsRaw || "[]")

		const sharedMessage = {
			question: question,
			options: options,
		} satisfies ClineAskQuestion

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
