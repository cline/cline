import { Empty } from "@shared/proto/cline/common"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { Controller } from ".."

export async function updateSettings(_controller: Controller, _request: UpdateSettingsRequest): Promise<Empty> {
	return Empty.create({})
}
