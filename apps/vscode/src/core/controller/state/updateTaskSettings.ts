import { Empty } from "@shared/proto/cline/common"
import { UpdateTaskSettingsRequest } from "@shared/proto/cline/state"
import { Controller } from ".."

export async function updateTaskSettings(_controller: Controller, _request: UpdateTaskSettingsRequest): Promise<Empty> {
	return Empty.create({})
}
