import { Controller } from ".."
import { Empty, Int64Request } from "@shared/proto/cline/common"

export async function checkpointDiff(controller: Controller, request: Int64Request): Promise<Empty> {
	if (request.value) {
		await controller.task?.presentMultifileDiff(request.value, false)
	}
	return Empty
}
