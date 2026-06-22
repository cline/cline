import { Boolean } from "@shared/proto/cline/common"
import { TogglePlanActModeRequest } from "@shared/proto/cline/state"
import { Controller } from ".."

export async function togglePlanActModeProto(_controller: Controller, _request: TogglePlanActModeRequest): Promise<Boolean> {
	return Boolean.create({})
}
