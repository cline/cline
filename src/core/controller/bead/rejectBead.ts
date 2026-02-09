import { BeadResponse, BeadTaskStatus, BeadUpdateEvent, BeadUpdateType, RejectBeadRequest } from "@shared/proto/beadsmith/bead"
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
 * Rejects the current bead with feedback
 * @param controller The controller instance
 * @param request The reject bead request with feedback
 * @returns BeadResponse with updated bead and task status
 */
export async function rejectBead(controller: Controller, request: RejectBeadRequest): Promise<BeadResponse> {
	try {
		const beadManager = controller.getBeadManager()
		if (!beadManager) {
			return BeadResponse.create({
				taskStatus: BeadTaskStatus.BEAD_TASK_STATUS_FAILED,
			})
		}

		const currentBead = beadManager.getCurrentBead()
		if (!currentBead) {
			return BeadResponse.create({
				taskStatus: BeadTaskStatus.BEAD_TASK_STATUS_FAILED,
			})
		}

		// Reject the bead with feedback
		beadManager.rejectBead(request.feedback)
		const state = beadManager.getState()

		Logger.info(`[rejectBead] Rejected bead ${currentBead.id} with feedback`)

		// Notify subscribers about the bead rejection
		await sendBeadUpdateEvent(
			BeadUpdateEvent.create({
				type: BeadUpdateType.BEAD_UPDATE_REJECTED,
				taskStatus: convertStatusToProto(state.status),
			}),
		)

		return BeadResponse.create({
			taskStatus: convertStatusToProto(state.status),
		})
	} catch (error) {
		Logger.error("[rejectBead] Failed to reject bead:", error)
		return BeadResponse.create({
			taskStatus: BeadTaskStatus.BEAD_TASK_STATUS_FAILED,
		})
	}
}
