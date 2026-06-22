import type { BooleanRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function setWelcomeViewCompleted(_controller: Controller, _request: BooleanRequest): Promise<Empty> {
	return Empty.create({})
}
