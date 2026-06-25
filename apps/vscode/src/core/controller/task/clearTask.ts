import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Clears the current task
 * @param controller The controller instance
 * @param _request The empty request
 * @returns Empty response
 */
export async function clearTask(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const startedAt = Date.now()
	await controller.clearTask()
	const afterClearTask = Date.now()
	await controller.postStateToWebview()
	const totalElapsed = Date.now() - startedAt

	if (totalElapsed > 250) {
		Logger.warn(
			`[TaskService.clearTask] took ${totalElapsed}ms (controller.clearTask=${afterClearTask - startedAt}ms, postStateToWebview=${Date.now() - afterClearTask}ms)`,
		)
	}

	return Empty.create()
}
