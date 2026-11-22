import { Empty } from "@shared/proto/cline/common"
import { PlanActMode } from "@shared/proto/cline/state"
import { type ScheduledTask as ScheduledTaskProto, UpdateScheduledTasksRequest } from "@shared/proto/cline/task"
import { createScheduledTaskId, normalizeScheduledTasks, type ScheduledTask } from "@shared/scheduled-next-task"
import type { Mode } from "@shared/storage/types"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * "Scheduled Tasks" view (see sdk-auto-next-task-coordinator.ts).
 *
 * Replaces the whole queue: the array order is the order the chats run in, so a
 * reorder, a delete and an edit are all the same call — the view sends the list
 * it now shows. `paused` gates the queue without discarding it, and is sent only
 * when the caller touched the pause toggle.
 *
 * Nothing is started here. Each row is started by the next task completion that
 * follows it in the queue.
 *
 * @param controller The controller instance
 * @param request The queue in run order, plus an optional pause flag
 * @returns Empty response
 */
export async function updateScheduledTasks(controller: Controller, request: UpdateScheduledTasksRequest): Promise<Empty> {
	try {
		const tasks = normalizeScheduledTasks((request.tasks ?? []).map((row) => toScheduledTask(row, controller)))
		await controller.updateScheduledTasks(tasks, request.paused)
		return Empty.create({})
	} catch (error) {
		Logger.error("Failed to update the scheduled task queue:", error)
		throw error
	}
}

/**
 * Maps one wire row to the shared shape. A row with no id would collide with the
 * dedupe in `normalizeScheduledTasks` (and could never be edited or deleted from
 * the view), so it is given one; an unset mode inherits the mode the user is in.
 */
function toScheduledTask(row: ScheduledTaskProto, controller: Controller): ScheduledTask {
	const providerId = row.providerId?.trim()
	const modelId = row.modelId?.trim()
	return {
		id: row.id?.trim() || createScheduledTaskId(),
		message: row.message ?? "",
		mode: resolveScheduledMode(row.mode, controller),
		includeSummary: row.includeSummary ?? true,
		...(providerId ? { providerId } : {}),
		...(providerId && modelId ? { modelId } : {}),
		createdAt: Number.isFinite(Number(row.createdAt)) && Number(row.createdAt) > 0 ? Number(row.createdAt) : Date.now(),
	}
}

/**
 * Maps the requested plan/act choice. When the view sent no explicit mode, the
 * scheduled chat inherits the mode the user is in right now rather than silently
 * falling back to Act.
 */
function resolveScheduledMode(mode: PlanActMode | undefined, controller: Controller): Mode {
	if (mode === PlanActMode.PLAN) {
		return "plan"
	}
	if (mode === PlanActMode.ACT) {
		return "act"
	}
	return controller.stateManager.getGlobalSettingsKey("mode") === "plan" ? "plan" : "act"
}
