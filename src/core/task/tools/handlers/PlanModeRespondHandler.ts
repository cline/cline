import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { findLast, parsePartialArrayString } from "@shared/array"
import { telemetryService } from "@/services/telemetry"
import { ClinePlanModeResponse } from "@/shared/ExtensionMessage"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class PlanModeRespondHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.PLAN_MODE

	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	/**
	 * Handle partial block streaming for plan_mode_respond
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const response = block.params.response
		const optionsRaw = block.params.options

		const sharedMessage = {
			response: uiHelpers.removeClosingTag(block, "response", response),
			options: parsePartialArrayString(uiHelpers.removeClosingTag(block, "options", optionsRaw)),
		} satisfies ClinePlanModeResponse

		await uiHelpers.ask(this.name, JSON.stringify(sharedMessage), true).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const response: string | undefined = block.params.response
		const optionsRaw: string | undefined = block.params.options
		const needsMoreExploration: boolean = block.params.needs_more_exploration === "true"

		// Validate required parameters
		if (!response) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "response")
		}

		config.taskState.consecutiveMistakeCount = 0

		// The plan_mode_respond tool tends to run into this issue where the model realizes mid-tool call that it should have called another tool before calling plan_mode_respond. And it ends the plan_mode_respond tool call with 'Proceeding to reading files...' which doesn't do anything because we restrict to 1 tool call per message. As an escape hatch for the model, we provide it the optionality to tack on a parameter at the end of its response `needs_more_exploration`, which will allow the loop to continue.
		if (needsMoreExploration) {
			return formatResponse.toolResult(
				`[You have indicated that you need more exploration. Proceed with calling tools to continue the planning process.]`,
			)
		}

		// For safety, if we are in yolo mode and we get a plan_mode_respond tool call we should always continue the loop
		if (config.yoloModeToggled && config.mode === "act") {
			return formatResponse.toolResult(`[Go ahead and execute.]`)
		}

		// Store the number of options for telemetry
		const options = parsePartialArrayString(optionsRaw || "[]")

		const sharedMessage = {
			response: response,
			options: options,
		}

		// Auto-switch to Act mode while in yolo mode
		if (config.mode === "plan" && config.yoloModeToggled && !needsMoreExploration) {
			// Trigger automatic mode switch
			const switchSuccessful = await config.callbacks.switchToActMode()

			if (switchSuccessful) {
				// Complete the plan mode response tool call (this is a unique case where we auto-respond to the user with an ask response)
				const lastPlanMessage = findLast(config.messageState.getClineMessages(), (m: any) => m.ask === this.name)
				if (lastPlanMessage) {
					lastPlanMessage.text = JSON.stringify({
						...sharedMessage,
					} satisfies ClinePlanModeResponse)
					lastPlanMessage.partial = false
					await config.messageState.saveClineMessagesAndUpdateHistory()
				}

				// we dont need to process any text, options, files or other content here
				return formatResponse.toolResult(`[The user has switched to ACT MODE, so you may now proceed with the task.]`)
			} else {
				console.warn("YOLO MODE: Failed to switch to ACT MODE, continuing with normal plan mode")
			}
		}

		// Set awaiting plan response state
		config.taskState.isAwaitingPlanResponse = true

		// Ask for user response
		let {
			text,
			images,
			files: planResponseFiles,
		} = await config.callbacks.ask(this.name, JSON.stringify(sharedMessage), false)

		config.taskState.isAwaitingPlanResponse = false

		// webview invoke sendMessage will send this marker in order to put webview into the proper state (responding to an ask) and as a flag to extension that the user switched to ACT mode.
		if (text === "PLAN_MODE_TOGGLE_RESPONSE") {
			text = ""
		}

		// Check if options contains the text response
		if (optionsRaw && text && parsePartialArrayString(optionsRaw).includes(text)) {
			telemetryService.captureOptionSelected(config.ulid, options.length, "plan")
			// Valid option selected, don't show user message in UI
			// Update last plan message with selected option
			const lastPlanMessage = findLast(config.messageState.getClineMessages(), (m: any) => m.ask === this.name)
			if (lastPlanMessage) {
				lastPlanMessage.text = JSON.stringify({
					...sharedMessage,
					selected: text,
				} satisfies ClinePlanModeResponse)
				await config.messageState.saveClineMessagesAndUpdateHistory()
			}
		} else {
			// Option not selected, send user feedback
			if (text || (images && images.length > 0) || (planResponseFiles && planResponseFiles.length > 0)) {
				telemetryService.captureOptionsIgnored(config.ulid, options.length, "plan")
				await config.callbacks.say("user_feedback", text ?? "", images, planResponseFiles)
			}
		}

		let fileContentString = ""
		if (planResponseFiles && planResponseFiles.length > 0) {
			const { processFilesIntoText } = await import("@integrations/misc/extract-text")
			fileContentString = await processFilesIntoText(planResponseFiles)
		}

		// Handle mode switching response
		if (config.taskState.didRespondToPlanAskBySwitchingMode) {
			const result = formatResponse.toolResult(
				`[The user has switched to ACT MODE, so you may now proceed with the task.]` +
					(text
						? `\n\nThe user also provided the following message when switching to ACT MODE:\n<user_message>\n${text}\n</user_message>`
						: ""),
				images,
				fileContentString,
			)
			// Reset the flag after using it to prevent it from persisting
			config.taskState.didRespondToPlanAskBySwitchingMode = false
			return result
		} else {
			// if we didn't switch to ACT MODE, then we can just send the user_feedback message
			return formatResponse.toolResult(`<user_message>\n${text}\n</user_message>`, images, fileContentString)
		}
	}
}
