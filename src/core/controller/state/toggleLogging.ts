import { Controller } from ".."
import { Empty } from "../../../shared/proto/common"
import { ToggleLoggingRequest } from "../../../shared/proto/state"

/**
 * Toggles the logging state
 * @param controller The controller instance
 * @param request The request containing the new logging state
 * @returns Empty response
 */
export async function toggleLogging(controller: Controller, request: ToggleLoggingRequest): Promise<Empty> {
	try {
		await controller.setLogging(request.enabled)
		return Empty.create()
	} catch (error) {
		console.error("Failed to toggle logging:", error)
		throw error
	}
}
