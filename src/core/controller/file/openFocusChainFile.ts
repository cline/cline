import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import { telemetryService } from "../../../services/telemetry"
import { Empty, StringRequest } from "../../../shared/proto/cline/common"
import { ensureFocusChainFile, extractFocusChainListFromText } from "../../task/focus-chain/file-utils"
import { Controller } from ".."

/**
 * Opens or creates a focus chain checklist markdown file for editing
 * The file is stored at <globalStorage>/tasks/<taskId>/focus_chain_taskid_<taskId>.md
 */
export async function openFocusChainFile(controller: Controller, request: StringRequest): Promise<Empty> {
	if (!request.value) {
		throw new Error("Task ID is required")
	}

	const taskId = request.value

	// Get the current focus chain list from the task's most recent task_progress message
	let initialFocusChainContent: string | undefined
	const currentTask = controller.task
	if (currentTask) {
		// Get the task's message history and find the most recent task_progress message
		// TODO - can we decouple this from ClineMessages?
		const clineMessages = currentTask.messageStateHandler.getClineMessages()
		const lastProgressMessage = clineMessages
			.slice()
			.reverse()
			.find((m) => m.say === "task_progress")

		if (lastProgressMessage && lastProgressMessage.text) {
			initialFocusChainContent = extractFocusChainListFromText(lastProgressMessage.text) || undefined
		}
	}

	const focusChainFilePath = await ensureFocusChainFile(taskId, initialFocusChainContent)
	telemetryService.captureFocusChainListOpened(taskId)
	await openFileIntegration(focusChainFilePath)

	return Empty.create()
}
