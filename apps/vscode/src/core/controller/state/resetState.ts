import { Empty } from "@shared/proto/cline/common"
import { ResetStateRequest } from "@shared/proto/cline/state"
import { Controller } from ".."

export async function resetState(_controller: Controller, _request: ResetStateRequest): Promise<Empty> {
	return Empty.create({})
}
