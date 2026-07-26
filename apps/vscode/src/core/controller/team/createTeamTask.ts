import { CreateTeamTaskRequest, TeamTask } from "@shared/proto/bedrock_coder/team"
import { Controller } from ".."
import { toTeamTaskProto } from "./team-conversions"
import { validateTeamWorktreeAssignment } from "./validateTeamWorktreeAssignment"

export async function createTeamTask(controller: Controller, request: CreateTeamTaskRequest): Promise<TeamTask> {
	await validateTeamWorktreeAssignment(request.worktreePath)
	return toTeamTaskProto(
		controller.createActiveTeamTask({
			title: request.title,
			description: request.description,
			parentTaskId: request.parentTaskId,
			assignedAgentId: request.assignedAgentId,
			sessionId: request.sessionId,
			worktreePath: request.worktreePath,
			branch: request.branch,
		}),
	)
}
