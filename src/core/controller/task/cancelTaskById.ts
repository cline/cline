import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Cancel a specific task by ID
 * @param controller The controller instance
 * @param request The request containing the task ID to cancel
 * @returns Empty response
 */
export async function cancelTaskById(controller: Controller, request: StringRequest): Promise<Empty> {
	const taskId = request.value
	await controller.cancelTask(taskId)
	return Empty.create()
}
