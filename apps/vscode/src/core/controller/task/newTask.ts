import { String } from "@shared/proto/cline/common"
import { NewTaskRequest } from "@shared/proto/cline/task"
import { Controller } from ".."

/**
 * Creates a new task with the given text and optional images/files.
 * @param controller The controller instance
 * @param request The new task request containing text and optional images/files
 * @returns A String proto carrying the (best-effort) task id
 */
export async function newTask(controller: Controller, request: NewTaskRequest): Promise<String> {
	await controller.initTask(request.text, request.images, request.files)
	return String.create({ value: "" })
}
