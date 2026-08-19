import { GetTaskHistoryRequest, TaskHistoryArray } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Gets filtered task history.
 * Task history retrieval/filtering is delegated to the SDK-backed controller.
 * @param controller The controller instance
 * @param request Filter parameters for task history
 * @returns TaskHistoryArray with filtered task list
 */
export async function getTaskHistory(controller: Controller, request: GetTaskHistoryRequest): Promise<TaskHistoryArray> {
	try {
		return await controller.getTaskHistory(request)
	} catch (error) {
		Logger.error("Error in getTaskHistory:", error)
		throw error
	}
}
