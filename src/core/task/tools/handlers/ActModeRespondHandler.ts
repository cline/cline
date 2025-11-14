import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { ClineDefaultTool } from "@shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"

export class ActModeRespondHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.ACT_MODE

	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name}]`
	}

	/**
	 * Handle partial block streaming for act_mode_respond
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const response = block.params.response

		const message = uiHelpers.removeClosingTag(block, "response", response)

		// Display partial message as "text" type to avoid blocking
		await uiHelpers.say("text", message, undefined, undefined, true).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const response: string | undefined = block.params.response
		const taskProgress: string | undefined = block.params.task_progress

		// Validate we're in ACT mode
		if (config.mode !== "act") {
			config.taskState.consecutiveMistakeCount++
			return formatResponse.toolError(
				`The act_mode_respond tool is only available in ACT MODE. You are currently in ${config.mode.toUpperCase()} MODE. Please use the appropriate tool for your current mode.`,
			)
		}

		// Validate required parameters
		if (!response) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "response")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Display complete message to user using "text" type (non-blocking)
		// This allows us to show the progress update and immediately continue
		await config.callbacks.say("text", response, undefined, undefined, false)

		// Update focus chain if task_progress provided
		if (taskProgress) {
			await config.callbacks.updateFCListFromToolResponse(taskProgress)
		}

		// Return success immediately to allow LLM to continue execution
		// The key difference from plan_mode_respond: no blocking for user input
		return formatResponse.toolResult(`[Message displayed to user. You may now proceed with the next steps.]`)
	}
}
