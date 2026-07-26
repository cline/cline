import type { TeamTaskStatus } from "@cline/shared"
import { TeamTask, UpdateTeamTaskRequest } from "@shared/proto/cline/team"
import { Controller } from ".."
import { toTeamTaskProto } from "./team-conversions"
import { validateTeamWorktreeAssignment } from "./validateTeamWorktreeAssignment"

const STATUSES = new Set<TeamTaskStatus>(["backlog", "ready", "in-progress", "blocked", "review", "done"])

export async function updateTeamTask(controller: Controller, request: UpdateTeamTaskRequest): Promise<TeamTask> {
	const status = request.status as TeamTaskStatus | undefined
	if (status && !STATUSES.has(status)) {
		throw new Error(`Unsupported team task status: ${request.status}`)
	}
	if (!request.clearWorktree) {
		await validateTeamWorktreeAssignment(request.worktreePath)
	}
	return toTeamTaskProto(
		controller.updateActiveTeamTask({
			taskId: request.taskId,
			expectedRevision: request.expectedRevision,
			title: request.title,
			description: request.clearDescription ? null : request.description,
			status,
			parentTaskId: request.clearParentTask ? null : request.parentTaskId,
			assignedAgentId: request.clearAssignedAgent ? null : request.assignedAgentId,
			sessionId: request.clearSession ? null : request.sessionId,
			worktreePath: request.clearWorktree ? null : request.worktreePath,
			branch: request.clearBranch ? null : request.branch,
			summary: request.clearSummary ? null : request.summary,
			blocker: request.clearBlocker ? null : request.blocker,
		}),
	)
}
