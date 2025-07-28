import { Controller } from ".."
import { Empty, StringRequest } from "@shared/proto/cline/common"

/**
 * Exports a task with the given ID to markdown
 * @param controller The controller instance
 * @param request The request containing the task ID in the value field
 * @returns Empty response
 */
export async function exportTaskWithId(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		if (request.value) {
			await controller.exportTaskWithId(request.value)
		}
		return Empty.create()
	} catch (error) {
		// Log the error but allow it to propagate for proper gRPC error handling
		console.error(`Error exporting task with ID ${request.value}:`, error)
		throw error
	}
}
