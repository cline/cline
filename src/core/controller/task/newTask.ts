import { Controller } from ".."
import { Empty } from "../../../shared/proto/common"
import { NewTaskRequest } from "../../../shared/proto/task"

/**
 * Creates a new task with the given text and optional images
 * @param controller The controller instance
 * @param request The new task request containing text and optional images
 * @returns Empty response
 */
export async function newTask(controller: Controller, request: NewTaskRequest): Promise<Empty> {
	if (controller.phaseTracker === undefined) {
		await controller.initTask(request.text, request.images, request.files)
	} else {
		const taskCreated = await controller.spawnNewTask(request.text, request.images, request.files)
		if (!taskCreated) {
			// User cancelled the task creation, don't return Empty.create()
			// This will prevent the gRPC response from being sent immediately
			throw new Error("Task creation cancelled by user")
		}
	}
	return Empty.create()
}
