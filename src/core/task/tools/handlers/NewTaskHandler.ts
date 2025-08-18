import { showSystemNotification } from "@integrations/notifications"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { formatResponse } from "@core/prompts/responses"
import type { ToolUse } from "@core/assistant-message"
import type { ToolResponse } from "../../index"
import type { IToolHandler } from "../ToolExecutorCoordinator"

export class NewTaskHandler implements IToolHandler {
	readonly name = "new_task"

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

		// Show notification if auto-approval is enabled
		if (config.autoApprovalSettings.enabled && config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: "Cline wants to start a new task...",
				message: `Cline is suggesting to start a new task with: ${context}`,
			})
		}

		// Ask user for response
		const { text, images, files: newTaskFiles } = await config.callbacks.ask("new_task", context, false)

		// If the user provided a response, treat it as feedback
		if (text || (images && images.length > 0) || (newTaskFiles && newTaskFiles.length > 0)) {
			let fileContentString = ""
			if (newTaskFiles && newTaskFiles.length > 0) {
				fileContentString = await processFilesIntoText(newTaskFiles)
			}

			await config.callbacks.say("user_feedback", text ?? "", images, newTaskFiles)
			return formatResponse.toolResult(
				`The user provided feedback instead of creating a new task:\n<feedback>\n${text}\n</feedback>`,
				images,
				fileContentString,
			)
		} else {
			// If no response, the user clicked the "Create New Task" button
			return formatResponse.toolResult(`The user has created a new task with the provided context.`)
		}
	}
}
