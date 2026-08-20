import { Empty } from "@shared/proto/cline/common"
import type { StopMonitorRequest } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Stops a background monitor for a specific SDK session on the user's behalf.
 *
 * @param controller The controller instance
 * @param request The request containing the monitor ID and its owning session ID
 * @returns Empty response
 */
export async function stopMonitor(controller: Controller, request: StopMonitorRequest): Promise<Empty> {
	try {
		await controller.stopMonitor(request.monitorId, request.sessionId)
		return Empty.create()
	} catch (error) {
		Logger.error("Error in stopMonitor handler:", error)
		throw error
	}
}
