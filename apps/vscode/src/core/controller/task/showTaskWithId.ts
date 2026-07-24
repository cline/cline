import { StringRequest } from "@shared/proto/cline/common"
import { TaskResponse } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."
import { sendChatButtonClickedEvent } from "../ui/subscribeToChatButtonClicked"

/**
 * Shows a task with the specified ID by loading its messages from disk.
 * Task lookup/loading is delegated to the SDK-backed controller.
 */
export async function showTaskWithId(controller: Controller, request: StringRequest): Promise<TaskResponse> {
	try {
		const response = await controller.showTaskWithId(request.value)
		await sendChatButtonClickedEvent()
		return response
	} catch (error) {
		Logger.error("Error in showTaskWithId:", error)
		throw error
	}
}
