import { GetTaskHistoryRequest, TaskHistoryArray } from "@shared/proto/cline/task"
import { Controller } from ".."

export async function getTaskHistory(_controller: Controller, _request: GetTaskHistoryRequest): Promise<TaskHistoryArray> {
	return TaskHistoryArray.create({})
}
