import { Controller } from ".."
import { Empty } from "../../../shared/proto/common"
import { NewTaskRequest } from "../../../shared/proto/task"
import { getRelativePaths } from "../file/getRelativePaths"

/**
 * Creates a new task with the given text and optional images
 * @param controller The controller instance
 * @param request The new task request containing text and optional images
 * @returns Empty response
 */
export async function newTask(controller: Controller, request: NewTaskRequest): Promise<Empty> {
	console.log("[DEBUG] NEW TASK:", request.text.substring(0, 16))
	await controller.initTask(request.text, request.images, request.files)
	try {
		const res = await getRelativePaths(controller, { uris: ["/home/etrnl/"] })
		console.log("[DEBUG] DID TEST getRelativePaths TASK:", res.values)
	} catch (e) {
		console.log(e)
	}
	return Empty.create()
}
