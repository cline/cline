import { Controller } from ".."
import { Empty, StringRequest } from "../../../shared/proto/common"
import { TaskMethodHandler } from "./index"

/**
 * Deletes tasks with the specified IDs
 * @param controller The controller instance
 * @param request The request containing a JSON string array of task IDs to delete
 * @returns Empty response
 * @throws Error if operation fails
 */
export const deleteTasksWithIds: TaskMethodHandler = async (controller: Controller, request: StringRequest): Promise<Empty> => {
	if (!request.value) {
		throw new Error("Missing task IDs")
	}

	try {
		const ids = JSON.parse(request.value) as string[]

		if (!Array.isArray(ids)) {
			throw new Error("Invalid task IDs format")
		}

		await Promise.all(ids.map((id) => controller.deleteTaskWithId(id)))

		return Empty.create()
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error("Invalid JSON format for task IDs")
		}
		throw error
	}
}
