import { BooleanResponse, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Switch to a different active task
 * @param controller The controller instance
 * @param request The request containing the task ID to switch to
 * @returns BooleanResponse indicating success
 */
export async function switchTask(controller: Controller, request: StringRequest): Promise<BooleanResponse> {
	const taskId = request.value
	const success = await controller.switchTask(taskId)
	return BooleanResponse.create({ value: success })
}
