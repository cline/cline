import { Empty, Int64Request } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Shows task completion changes in a diff view
 * @param controller The controller instance
 * @param request The request containing the timestamp of the message
 * @returns Empty response
 */
export async function taskCompletionViewChanges(controller: Controller, request: Int64Request): Promise<Empty> {
	try {
		if (request.value && controller.task) {
			await controller.task.checkpointManager?.presentMultifileDiff(request.value, true)
		}
		return Empty.create()
	} catch (error) {
		console.error("Error in taskCompletionViewChanges handler:", error)
		throw error
	}
}
