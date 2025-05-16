import { Controller } from ".."
import { Empty } from "../../../shared/proto/common"
import { NewTaskRequest } from "../../../shared/proto/task"
import { handleFileServiceRequest } from "../file"

/**
 * Creates a new task with the given text and optional images
 * @param controller The controller instance
 * @param request The new task request containing text and optional images
 * @returns Empty response
 */
export async function newTask(controller: Controller, request: NewTaskRequest): Promise<Empty> {
	console.log("[DEBUG] DOING NEW TASK")
	await controller.initTask(request.text, request.images)
	try {
		console.log("[DEBUG] DOING getRelativePaths TASK")
		const res = await handleFileServiceRequest(controller, "getRelativePaths", { uris: ["/home/etrnl/"] })
	} catch (e) {
		console.log(e)
	}
	return Empty.create()
}
