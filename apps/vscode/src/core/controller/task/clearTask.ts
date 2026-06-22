import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Clears the active task and resets the transcript.
 * @param controller The controller instance
 * @returns Empty response
 */
export async function clearTask(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await controller.clearTask()
	return Empty.create({})
}
