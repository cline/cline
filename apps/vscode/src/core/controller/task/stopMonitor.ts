import { Empty, type StringRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Stops a background monitor for the active SDK session on the user's behalf.
 *
 * @param controller The controller instance
 * @param request The request containing the monitor ID
 * @returns Empty response
 */
export async function stopMonitor(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		await controller.stopMonitor(request.value)
		return Empty.create()
	} catch (error) {
		Logger.error("Error in stopMonitor handler:", error)
		throw error
	}
}
