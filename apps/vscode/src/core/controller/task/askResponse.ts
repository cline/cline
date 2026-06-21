import { Empty } from "@shared/proto/cline/common"
import { AskResponseRequest } from "@shared/proto/cline/task"
import { Controller } from ".."

export async function askResponse(_controller: Controller, _request: AskResponseRequest): Promise<Empty> {
	return Empty.create({})
}
