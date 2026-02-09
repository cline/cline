import { getBeadStorage } from "@core/beads"
import type { Bead, BeadTaskSummary } from "@shared/beads"
import {
	BeadHistoryResponse,
	BeadTaskStatus,
	Bead as ProtoBead,
	BeadStatus as ProtoBeadStatus,
	BeadTaskSummary as ProtoBeadTaskSummary,
} from "@shared/proto/beadsmith/bead"
import { StringRequest } from "@shared/proto/beadsmith/common"
import { Logger } from "@shared/services/Logger"
import { Controller } from ".."

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
 * Convert domain bead status to proto status
 */
function convertBeadStatusToProto(status: string): ProtoBeadStatus {
	switch (status) {
		case "running":
			return ProtoBeadStatus.BEAD_STATUS_RUNNING
		case "awaiting_approval":
			return ProtoBeadStatus.BEAD_STATUS_AWAITING_APPROVAL
		case "approved":
			return ProtoBeadStatus.BEAD_STATUS_APPROVED
		case "rejected":
			return ProtoBeadStatus.BEAD_STATUS_REJECTED
		case "skipped":
			return ProtoBeadStatus.BEAD_STATUS_SKIPPED
		default:
			return ProtoBeadStatus.BEAD_STATUS_UNSPECIFIED
	}
}

/**
 * Convert domain bead to proto bead
 */
function convertBeadToProto(bead: Bead): ProtoBead {
	return ProtoBead.create({
		id: bead.id,
		taskId: bead.taskId,
		beadNumber: bead.beadNumber,
		status: convertBeadStatusToProto(bead.status),
		startedAt: bead.startedAt,
		completedAt: bead.completedAt,
		prompt: bead.prompt,
		response: bead.response,
		tokensUsed: bead.tokensUsed,
		iterationCount: bead.iterationCount,
		errors: bead.errors,
		rejectionFeedback: bead.rejectionFeedback,
		commitHash: bead.commitHash,
	})
}

/**
 * Convert domain summary to proto summary
 */
function convertSummaryToProto(summary: BeadTaskSummary): ProtoBeadTaskSummary {
	return ProtoBeadTaskSummary.create({
		beadCount: summary.beadCount,
		totalTokensUsed: summary.totalTokensUsed,
		success: summary.success,
		status: convertStatusToProto(summary.status),
		completedAt: summary.completedAt,
		errorMessage: summary.errorMessage,
	})
}

/**
 * Gets the history of beads for a task
 * @param controller The controller instance
 * @param request StringRequest with task ID
 * @returns BeadHistoryResponse with bead history
 */
export async function getBeadHistory(controller: Controller, request: StringRequest): Promise<BeadHistoryResponse> {
	try {
		const taskId = request.value
		if (!taskId) {
			return BeadHistoryResponse.create({
				beads: [],
				summary: ProtoBeadTaskSummary.create({
					beadCount: 0,
					totalTokensUsed: 0,
					success: false,
					status: BeadTaskStatus.BEAD_TASK_STATUS_IDLE,
					completedAt: 0,
				}),
			})
		}

		// Check if this is the current task in the BeadManager
		const beadManager = controller.getBeadManager()
		if (beadManager) {
			const state = beadManager.getState()
			if (state.currentTask?.id === taskId) {
				// Return current task state
				return BeadHistoryResponse.create({
					beads: state.beads.map(convertBeadToProto),
					summary: ProtoBeadTaskSummary.create({
						beadCount: state.beads.length,
						totalTokensUsed: state.totalTokensUsed,
						success: state.status === "completed",
						status: convertStatusToProto(state.status),
						completedAt: Date.now(),
					}),
				})
			}
		}

		// Load from storage
		const beadStorage = getBeadStorage()
		const beads = await beadStorage.loadAllBeads(taskId)
		const summary = await beadStorage.loadTaskSummary(taskId)

		return BeadHistoryResponse.create({
			beads: beads.map(convertBeadToProto),
			summary: summary
				? convertSummaryToProto(summary)
				: ProtoBeadTaskSummary.create({
						beadCount: beads.length,
						totalTokensUsed: beads.reduce((sum, b) => sum + b.tokensUsed, 0),
						success: false,
						status: BeadTaskStatus.BEAD_TASK_STATUS_IDLE,
						completedAt: 0,
					}),
		})
	} catch (error) {
		Logger.error("[getBeadHistory] Failed to get bead history:", error)
		return BeadHistoryResponse.create({
			beads: [],
			summary: ProtoBeadTaskSummary.create({
				beadCount: 0,
				totalTokensUsed: 0,
				success: false,
				status: BeadTaskStatus.BEAD_TASK_STATUS_FAILED,
				completedAt: 0,
				errorMessage: error instanceof Error ? error.message : String(error),
			}),
		})
	}
}
