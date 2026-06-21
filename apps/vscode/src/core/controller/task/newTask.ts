import { String } from "@shared/proto/cline/common"
import { NewTaskRequest } from "@shared/proto/cline/task"
import { Controller } from ".."

export async function newTask(_controller: Controller, _request: NewTaskRequest): Promise<String> {
	return String.create({})
}
