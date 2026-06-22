import { DeleteAllTaskHistoryCount } from "@shared/proto/cline/task"
import { Controller } from ".."

export async function deleteAllTaskHistory(_controller: Controller): Promise<DeleteAllTaskHistoryCount> {
	return DeleteAllTaskHistoryCount.create({})
}
