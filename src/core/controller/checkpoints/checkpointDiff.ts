import { Empty, Int64Request } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function checkpointDiff(controller: Controller, request: Int64Request): Promise<Empty> {
	if (request.value) {
		const mgr = controller.task?.checkpointManager
		await mgr?.presentMultifileDiff?.(request.value, false) // preserve `this`
	}
	return Empty.create()
}
