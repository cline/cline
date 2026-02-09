import { BeadTaskStatus, BeadUpdateEvent, BeadUpdateType } from "@shared/proto/beadsmith/bead"
import { Empty, EmptyRequest } from "@shared/proto/beadsmith/common"
import { Logger } from "@shared/services/Logger"
import { Controller } from ".."
import { sendBeadUpdateEvent } from "./subscribeToBeadUpdates"

/**
 * Convert domain task status to proto status
 */
function convertStatusToProto(status: string): BeadTaskStatus {
	switch (status) {
		case "idle":
			return BeadTaskStatus.BEAD_TASK_STATUS_IDLE
		case "running":
			return BeadTaskStatus.BEAD_TASK_STATUS_RUNNING
		case "paused":
			return BeadTaskStatus.BEAD_TASK_STATUS_PAUSED
		case "awaiting_approval":
			return BeadTaskStatus.BEAD_TASK_STATUS_AWAITING_APPROVAL
		case "completed":
			return BeadTaskStatus.BEAD_TASK_STATUS_COMPLETED
		case "failed":
			return BeadTaskStatus.BEAD_TASK_STATUS_FAILED
		default:
			return BeadTaskStatus.BEAD_TASK_STATUS_UNSPECIFIED
	}
}

/**
 * Pauses the current bead task
 * @param controller The controller instance
 * @param _request Empty request
 * @returns Empty response
 */
export async function pauseBeadTask(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		const beadManager = controller.getBeadManager()
		if (!beadManager) {
			Logger.warn("[pauseBeadTask] No BeadManager to pause")
			return Empty.create()
		}

		const state = beadManager.getState()
		if (state.status !== "running") {
			Logger.debug(`[pauseBeadTask] Task not running (status: ${state.status}), cannot pause`)
			return Empty.create()
		}

		// Pause the task
		beadManager.pauseTask()
		const newState = beadManager.getState()

		Logger.info(`[pauseBeadTask] Paused task ${state.currentTask?.id}`)

		// Notify subscribers about the task pause (using PROGRESS type for state changes)
		await sendBeadUpdateEvent(
			BeadUpdateEvent.create({
				type: BeadUpdateType.BEAD_UPDATE_PROGRESS,
				taskStatus: convertStatusToProto(newState.status),
			}),
		)

		return Empty.create()
	} catch (error) {
		Logger.error("[pauseBeadTask] Failed to pause task:", error)
		return Empty.create()
	}
}
