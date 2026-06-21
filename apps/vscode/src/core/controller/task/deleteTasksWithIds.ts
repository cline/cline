import { Empty, StringArrayRequest } from "@shared/proto/cline/common"
import { Controller } from ".."

export async function deleteTasksWithIds(_controller: Controller, _request: StringArrayRequest): Promise<Empty> {
	return Empty.create({})
}
