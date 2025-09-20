import { Empty, StringArrayRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

/**
 * Exports multiple tasks with the given IDs to markdown
 * @param controller The controller instance
 * @param request The request containing an array of task IDs to export
 * @returns Empty response
 */
export async function exportTasksWithIds(controller: Controller, request: StringArrayRequest): Promise<Empty> {
	try {
		if (!request.value || request.value.length === 0) {
			throw new Error("No task IDs provided for export")
		}

		// Export each task individually using the existing export function
		for (const id of request.value) {
			await controller.exportTaskWithId(id)
		}

		return Empty.create()
	} catch (error) {
		// Log the error but allow it to propagate for proper gRPC error handling
		console.error(`Error exporting tasks with IDs ${request.value}:`, error)
		throw error
	}
}
