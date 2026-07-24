import { Empty } from "@shared/proto/cline/common"
import { TaskFavoriteRequest } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../"

export async function toggleTaskFavorite(controller: Controller, request: TaskFavoriteRequest): Promise<Empty> {
	if (!request.taskId) {
		Logger.error(`[toggleTaskFavorite] Invalid request: taskId missing`)
		return Empty.create({})
	}

	try {
		await controller.toggleTaskFavorite(request.taskId, request.isFavorited)
		return Empty.create({})
	} catch (error) {
		Logger.error("Error in toggleTaskFavorite:", error)
		throw error
	}
}
