import { Empty, Int64Request } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function checkpointDiff(controller: Controller, request: Int64Request): Promise<Empty> {
	if (request.value) {
		await controller.task?.checkpointManager?.presentMultifileDiff?.(request.value, false)
	}
	return Empty.create()
}
