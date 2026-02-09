import { createBeadCommitService } from "@core/beads"
import { ApproveBeadRequest, BeadResponse, BeadTaskStatus, BeadUpdateEvent, BeadUpdateType } from "@shared/proto/beadsmith/bead"
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
 * Approves the current bead and commits changes
 * @param controller The controller instance
 * @param _request The approve bead request
 * @returns BeadResponse with updated bead and task status
 */
export async function approveBead(controller: Controller, _request: ApproveBeadRequest): Promise<BeadResponse> {
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

		// Get workspace root and commit settings
		const workspaceRoot = controller.getWorkspaceManager()?.getPrimaryRoot()?.path
		const beadCommitMode = controller.stateManager.getGlobalSettingsKey("beadCommitMode")

		// Commit the bead changes if we have a workspace and files were changed
		let commitHash: string | undefined
		if (workspaceRoot && currentBead.filesChanged.length > 0) {
			const taskId = beadManager.getState().currentTask?.id
			const commitService = createBeadCommitService(workspaceRoot, taskId)

			const commitResult = await commitService.commitBead(currentBead, {
				mode: beadCommitMode,
			})

			if (commitResult.success) {
				commitHash = commitResult.commitHash
				Logger.info(`[approveBead] Committed bead ${currentBead.beadNumber} with hash ${commitHash}`)
			} else {
				// Log the error but don't fail the approval - commit is optional
				Logger.warn(`[approveBead] Failed to commit bead: ${commitResult.error}`)
			}
		}

		// Approve the bead with the commit hash
		await beadManager.approveBead(commitHash)
		const state = beadManager.getState()

		Logger.info(`[approveBead] Approved bead ${currentBead.id}`)

		// Notify subscribers about the bead approval
		await sendBeadUpdateEvent(
			BeadUpdateEvent.create({
				type: BeadUpdateType.BEAD_UPDATE_APPROVED,
				taskStatus: convertStatusToProto(state.status),
			}),
		)

		return BeadResponse.create({
			taskStatus: convertStatusToProto(state.status),
		})
	} catch (error) {
		Logger.error("[approveBead] Failed to approve bead:", error)
		return BeadResponse.create({
			taskStatus: BeadTaskStatus.BEAD_TASK_STATUS_FAILED,
		})
	}
}
