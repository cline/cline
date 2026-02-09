import {
	Bead as ProtoBead,
	BeadManagerState as ProtoBeadManagerState,
	BeadStatus as ProtoBeadStatus,
	BeadTaskDefinition as ProtoBeadTaskDefinition,
	BeadTaskStateResponse,
	BeadTaskStatus,
} from "@shared/proto/beadsmith/bead"
import { EmptyRequest } from "@shared/proto/beadsmith/common"
import type { Bead, BeadManagerState } from "@shared/beads"
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
 * Convert domain state to proto state
 */
function convertStateToProto(state: BeadManagerState): ProtoBeadManagerState {
	return ProtoBeadManagerState.create({
		currentTask: state.currentTask
			? ProtoBeadTaskDefinition.create({
					id: state.currentTask.id,
					description: state.currentTask.description,
					workspaceRoot: state.currentTask.workspaceRoot ?? "",
				})
			: undefined,
		status: convertStatusToProto(state.status),
		currentBeadNumber: state.currentBeadNumber,
		beads: state.beads.map(convertBeadToProto),
		totalTokensUsed: state.totalTokensUsed,
		totalIterationCount: state.totalIterationCount,
	})
}

/**
 * Gets the current bead task state
 * @param controller The controller instance
 * @param _request Empty request
 * @returns BeadTaskStateResponse with current state
 */
export async function getBeadTaskState(controller: Controller, _request: EmptyRequest): Promise<BeadTaskStateResponse> {
	const beadManager = controller.getBeadManager()

	if (!beadManager) {
		// Return idle state if no BeadManager is initialized
		return BeadTaskStateResponse.create({
			state: ProtoBeadManagerState.create({
				status: BeadTaskStatus.BEAD_TASK_STATUS_IDLE,
				currentBeadNumber: 0,
				beads: [],
				totalTokensUsed: 0,
				totalIterationCount: 0,
			}),
		})
	}

	const state = beadManager.getState()
	return BeadTaskStateResponse.create({
		state: convertStateToProto(state),
	})
}
