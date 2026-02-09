import { BeadResponse, BeadTaskStatus, BeadUpdateEvent, BeadUpdateType } from "@shared/proto/beadsmith/bead"
import { EmptyRequest } from "@shared/proto/beadsmith/common"
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
 * Skips the current bead without committing
 * @param controller The controller instance
 * @param _request Empty request
 * @returns BeadResponse with updated bead and task status
 */
export async function skipBead(controller: Controller, _request: EmptyRequest): Promise<BeadResponse> {
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

		// Skip the bead
		beadManager.skipBead()
		const state = beadManager.getState()

		Logger.info(`[skipBead] Skipped bead ${currentBead.id}`)

		// Notify subscribers about the bead skip
		await sendBeadUpdateEvent(
			BeadUpdateEvent.create({
				type: BeadUpdateType.BEAD_UPDATE_SKIPPED,
				taskStatus: convertStatusToProto(state.status),
			}),
		)

		return BeadResponse.create({
			taskStatus: convertStatusToProto(state.status),
		})
	} catch (error) {
		Logger.error("[skipBead] Failed to skip bead:", error)
		return BeadResponse.create({
			taskStatus: BeadTaskStatus.BEAD_TASK_STATUS_FAILED,
		})
	}
}
