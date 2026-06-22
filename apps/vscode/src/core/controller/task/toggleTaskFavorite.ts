import { Empty } from "@shared/proto/cline/common"
import { TaskFavoriteRequest } from "@shared/proto/cline/task"
import { Controller } from "../"

export async function toggleTaskFavorite(_controller: Controller, _request: TaskFavoriteRequest): Promise<Empty> {
	return Empty.create({})
}
