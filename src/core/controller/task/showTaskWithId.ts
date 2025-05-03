import { Controller } from ".."
import { Empty } from "../../../shared/proto/common"
import { ShowTaskWithIdRequest } from "../../../shared/proto/task"

/**
 * Shows a task with the specified ID
 * @param controller The controller instance
 * @param request The request containing the task ID
 * @returns Empty response
 */
export async function showTaskWithId(controller: Controller, request: ShowTaskWithIdRequest): Promise<Empty> {
	try {
		await controller.showTaskWithId(request.taskId)
		return Empty.create()
	} catch (error) {
		throw error
	}
}
