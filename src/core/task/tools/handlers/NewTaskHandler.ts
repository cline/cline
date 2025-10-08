import type { ToolUse } from "@core/assistant-message"
import { formatResponse } from "@core/prompts/responses"
import { processFilesIntoText } from "@integrations/misc/extract-text"
import { showSystemNotification } from "@integrations/notifications"
import { ClineDefaultTool } from "@/shared/tools"
import type { ToolResponse } from "../../index"
import type { IPartialBlockHandler, IToolHandler } from "../ToolExecutorCoordinator"
import type { TaskConfig } from "../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../types/UIHelpers"
import { containsNewTaskTemplateContent } from "./PlanModeRespondHandler"

export class NewTaskHandler implements IToolHandler, IPartialBlockHandler {
	readonly name = ClineDefaultTool.NEW_TASK
	constructor() {}

	getDescription(block: ToolUse): string {
		return `[${block.name} for creating a new task]`
	}

	/**
	 * Handle partial block streaming for new_task
	 */
	async handlePartialBlock(block: ToolUse, uiHelpers: StronglyTypedUIHelpers): Promise<void> {
		const context = uiHelpers.removeClosingTag(block, "context", block.params.context)
		await uiHelpers.ask(this.name, context, true).catch(() => {})
	}

	async execute(config: TaskConfig, block: ToolUse): Promise<ToolResponse> {
		const context: string | undefined = block.params.context

		// Validate required parameters
		if (!context) {
			config.taskState.consecutiveMistakeCount++
			return await config.callbacks.sayAndCreateMissingParamError(block.name, "context")
		}

		config.taskState.consecutiveMistakeCount = 0

		// Runtime gate: block new_task in ACT MODE unless explicitly requested by the user
		if (config.mode === "act") {
			return formatResponse.toolError(
				"New task creation is blocked in ACT MODE. Use read_file/list_files to inspect the workspace, apply changes with replace_in_file/write_to_file, and run commands with execute_command to complete the current task. Only use new_task when the user explicitly asks to start a new task."
			)
		}

		const hasMeaningfulProgress =
			Boolean(config.taskState.currentFocusChainChecklist) ||
			config.taskState.didReadProjectFile ||
			config.taskState.didEditFile ||
			config.taskState.didRunCommand

		if (hasMeaningfulProgress) {
			return formatResponse.toolError(
				"You're already in the middle of this task with a live checklist or recent tool use. Keep iterating with plan_mode_respond and follow up with read_file/write_to_file/execute_command instead of starting a new task.",
			)
		}

		if (containsNewTaskTemplateContent(context)) {
			return formatResponse.toolError(
				"The new_task context still contains template boilerplate. Replace the bracketed instructions with real progress and continue the existing task using plan_mode_respond and task_progress.",
			)
		}

		// Show notification if auto-approval is enabled
		if (config.autoApprovalSettings.enabled && config.autoApprovalSettings.enableNotifications) {
			showSystemNotification({
				subtitle: "Cline wants to start a new task...",
				message: `Cline is suggesting to start a new task with: ${context}`,
			})
		}

		// Ask user for response
		console.log("[NewTaskHandler] Final new_task context", {
			taskId: config.taskId,
			mode: config.mode,
			context,
			reasoning: config.taskState.latestReasoningMessage ?? null,
		})
		const { text, images, files: newTaskFiles } = await config.callbacks.ask(this.name, context, false)

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
