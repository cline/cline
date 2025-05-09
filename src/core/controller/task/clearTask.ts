import { Controller } from ".."
import { Empty, EmptyRequest } from "../../../shared/proto/common"

/**
 * Clears the current task
 * @param controller The controller instance
 * @param _request The empty request
 * @returns Empty response
 */
export async function clearTask(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	// clearTask is called here when the user closes the task
	await controller.clearTask()
	await controller.postStateToWebview()
	return Empty.create()
}
