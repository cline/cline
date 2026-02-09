import type { SuccessCriterion } from "@shared/beads"
import {
	BeadTaskResponse,
	BeadTaskStatus,
	BeadUpdateEvent,
	BeadUpdateType,
	SuccessCriterion as ProtoSuccessCriterion,
	SuccessCriterionType as ProtoSuccessCriterionType,
	StartBeadTaskRequest,
} from "@shared/proto/beadsmith/bead"
import { Logger } from "@shared/services/Logger"
import { Controller } from ".."
import { sendBeadUpdateEvent } from "./subscribeToBeadUpdates"

/**
 * Convert proto success criterion type to domain type
 */
function convertProtoToCriterionType(protoType: ProtoSuccessCriterionType): SuccessCriterion["type"] {
	switch (protoType) {
		case ProtoSuccessCriterionType.SUCCESS_CRITERION_TESTS_PASS:
			return "tests_pass"
		case ProtoSuccessCriterionType.SUCCESS_CRITERION_DONE_TAG:
			return "done_tag"
		case ProtoSuccessCriterionType.SUCCESS_CRITERION_NO_ERRORS:
			return "no_errors"
		case ProtoSuccessCriterionType.SUCCESS_CRITERION_CUSTOM:
			return "custom"
		default:
			return "done_tag"
	}
}

/**
 * Convert proto success criteria to domain types
 */
function convertProtoCriteria(protoCriteria: ProtoSuccessCriterion[]): SuccessCriterion[] {
	return protoCriteria.map((pc) => ({
		type: convertProtoToCriterionType(pc.type),
		config: pc.configJson ? JSON.parse(pc.configJson) : undefined,
	}))
}

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
 * Starts a new bead task with defined success criteria
 * @param controller The controller instance
 * @param request The start bead task request
 * @returns BeadTaskResponse with task ID and status
 */
export async function startBeadTask(controller: Controller, request: StartBeadTaskRequest): Promise<BeadTaskResponse> {
	try {
		const beadManager = await controller.ensureBeadManager()

		// Convert proto success criteria to domain types
		const successCriteria: SuccessCriterion[] =
			request.successCriteria.length > 0 ? convertProtoCriteria(request.successCriteria) : [{ type: "done_tag" }]

		// Configure the bead manager with request settings
		if (request.maxIterations) {
			beadManager.configure({ maxIterations: request.maxIterations })
		}
		if (request.tokenBudget) {
			beadManager.configure({ tokenBudget: request.tokenBudget })
		}
		if (request.testCommand) {
			beadManager.configure({ testCommand: request.testCommand })
		}

		// Start the bead tracking (sets up internal state, creates first bead)
		const bead = await beadManager.startTask(request.description, successCriteria)
		const state = beadManager.getState()

		Logger.info(`[startBeadTask] Started bead task ${state.currentTask?.id} with bead ${bead.id}`)

		// Notify subscribers about the task start
		await sendBeadUpdateEvent(
			BeadUpdateEvent.create({
				type: BeadUpdateType.BEAD_UPDATE_STARTED,
				taskStatus: convertStatusToProto(state.status),
			}),
		)

		// Create the actual LLM task with the description.
		// The Task's system prompt builder will detect beadModeActive and include
		// the bead mode instructions (completion signal, iteration rules, etc.)
		await controller.initTask(request.description)

		return BeadTaskResponse.create({
			taskId: state.currentTask?.id ?? "",
			status: convertStatusToProto(state.status),
		})
	} catch (error) {
		Logger.error("[startBeadTask] Failed to start bead task:", error)
		return BeadTaskResponse.create({
			taskId: "",
			status: BeadTaskStatus.BEAD_TASK_STATUS_FAILED,
		})
	}
}
