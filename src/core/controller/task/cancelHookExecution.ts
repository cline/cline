import { Boolean, EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Cancels the currently running hook execution
 * @param controller The controller instance
 * @param _request Empty request (no parameters needed)
 * @returns Boolean indicating whether a hook was successfully cancelled
 */
export async function cancelHookExecution(controller: Controller, _request: EmptyRequest): Promise<Boolean> {
	const success = await controller.cancelHookExecution()
	return Boolean.create({ value: success })
}
