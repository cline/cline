import { Empty, StringRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function taskFeedback(_controller: Controller, _request: StringRequest): Promise<Empty> {
	return Empty.create({})
}
