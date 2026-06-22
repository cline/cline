import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Cancels the active task turn.
 * @param controller The controller instance
 * @returns Empty response
 */
export async function cancelTask(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await controller.cancelTask()
	return Empty.create({})
}
