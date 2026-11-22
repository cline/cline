import { Empty } from "@shared/proto/cline/common"
import { RunScheduledTaskRequest } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Starts one queued chat immediately instead of waiting for a completion — the
 * "Run now" action in the "Scheduled Tasks" view. The row is spent (removed from
 * the queue) whether it opens a prompted chat or an empty one, so it never fires
 * a second time for a later completion.
 *
 * @param controller The controller instance
 * @param request The id of the queued row to start
 * @returns Empty response
 */
export async function runScheduledTaskNow(controller: Controller, request: RunScheduledTaskRequest): Promise<Empty> {
	try {
		await controller.runScheduledTaskNow(request.scheduledTaskId)
		return Empty.create({})
	} catch (error) {
		Logger.error("Failed to start the scheduled task now:", error)
		throw error
	}
}
