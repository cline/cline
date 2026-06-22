import { PathHashMap } from "@shared/proto/cline/checkpoints"
import { StringArrayRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function getCwdHash(_controller: Controller, _request: StringArrayRequest): Promise<PathHashMap> {
	return PathHashMap.create({})
}
