import { Empty } from "@shared/proto/cline/common"
import { EditMessageAndRegenerateRequest } from "@shared/proto/cline/task"
import { Controller } from ".."

export async function editMessageAndRegenerate(
	_controller: Controller,
	_request: EditMessageAndRegenerateRequest,
): Promise<Empty> {
	return Empty.create({})
}
