import { Controller } from ".."
import { Empty } from "../../../shared/proto/common"
import { DeleteTasksWithIds } from "../../../shared/proto/task"
import { TaskMethodHandler } from "./index"

/**
 * Deletes tasks with the specified IDs
 * @param controller The controller instance
 * @param request The request containing an array of task IDs to delete
 * @returns Empty response
 * @throws Error if operation fails
 */
export const deleteTasksWithIds: TaskMethodHandler = async (
	controller: Controller,
	request: DeleteTasksWithIds,
): Promise<Empty> => {
	if (!request.ids || request.ids.length === 0) {
		throw new Error("Missing task IDs")
	}

	await Promise.all(request.ids.map((id) => controller.deleteTaskWithId(id)))

	return Empty.create()
}
