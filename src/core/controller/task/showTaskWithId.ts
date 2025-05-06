import { Controller } from ".."
import { Empty, StringRequest } from "../../../shared/proto/common"

/**
 * Shows a task with the specified ID
 * @param controller The controller instance
 * @param request The request containing the task ID
 * @returns Empty response
 */
export async function showTaskWithId(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		await controller.showTaskWithId(request.value)
		return Empty.create()
	} catch (error) {
		throw error
	}
}
