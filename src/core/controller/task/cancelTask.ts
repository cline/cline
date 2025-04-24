import { Controller } from ".."
import { Empty, EmptyRequest } from "../../../shared/proto/common"

/**
 * Cancel the currently running task
 * @param controller The controller instance
 * @param _request The empty request
 * @returns Empty response
 */
export async function cancelTask(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await controller.cancelTask()
	return Empty.create()
}
