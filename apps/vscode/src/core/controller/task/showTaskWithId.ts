import { StringRequest } from "@shared/proto/cline/common"
import { TaskResponse } from "@shared/proto/cline/task"
import { Controller } from ".."

export async function showTaskWithId(_controller: Controller, _request: StringRequest): Promise<TaskResponse> {
	return TaskResponse.create({})
}
