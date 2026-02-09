import { BeadTaskStatus, BeadUpdateEvent, BeadUpdateType } from "@shared/proto/beadsmith/bead"
import { Empty, EmptyRequest } from "@shared/proto/beadsmith/common"
import { Logger } from "@shared/services/Logger"
import { Controller } from ".."
import { sendBeadUpdateEvent } from "./subscribeToBeadUpdates"

/**
 * Cancels the current bead task
 * @param controller The controller instance
 * @param _request Empty request
 * @returns Empty response
 */
export async function cancelBeadTask(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		const beadManager = controller.getBeadManager()
		if (!beadManager) {
			Logger.warn("[cancelBeadTask] No BeadManager to cancel")
			return Empty.create()
		}

		const state = beadManager.getState()
		if (state.status === "idle" || state.status === "completed" || state.status === "failed") {
			Logger.debug("[cancelBeadTask] Task already in terminal state, nothing to cancel")
			return Empty.create()
		}

		const taskId = state.currentTask?.id ?? ""

		// Cancel the task
		beadManager.cancelTask()

		Logger.info(`[cancelBeadTask] Cancelled task ${taskId}`)

		// Notify subscribers about the task cancellation (using FAILED type)
		await sendBeadUpdateEvent(
			BeadUpdateEvent.create({
				type: BeadUpdateType.BEAD_UPDATE_FAILED,
				taskStatus: BeadTaskStatus.BEAD_TASK_STATUS_FAILED,
				message: "Task was cancelled",
			}),
		)

		return Empty.create()
	} catch (error) {
		Logger.error("[cancelBeadTask] Failed to cancel task:", error)
		return Empty.create()
	}
}
