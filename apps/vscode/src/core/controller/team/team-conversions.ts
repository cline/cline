import type { TeamTask as SharedTeamTask, TeamBoardSnapshot, TeamRunRecord } from "@cline/shared"
import { TeamAgent, TeamBoard, TeamRun, TeamTask } from "@shared/proto/cline/team"

export function toTeamTaskProto(task: SharedTeamTask): TeamTask {
	return TeamTask.create({
		...task,
		createdAt: task.createdAt.toISOString(),
		updatedAt: task.updatedAt.toISOString(),
		dependsOn: task.dependsOn,
	})
}

export function toTeamRunProto(run: TeamRunRecord): TeamRun {
	return TeamRun.create({
		id: run.id,
		agentId: run.agentId,
		taskId: run.taskId,
		status: run.status,
		startedAt: run.startedAt.toISOString(),
		endedAt: run.endedAt?.toISOString(),
		currentActivity: run.currentActivity,
		error: run.error,
	})
}

export function toTeamBoardProto(board: TeamBoardSnapshot | undefined, error?: string): TeamBoard {
	if (!board) {
		return TeamBoard.create({
			version: 2,
			tasks: [],
			agents: [],
			runs: [],
			error: error ?? "No active local team session",
		})
	}
	return TeamBoard.create({
		version: board.version,
		teamId: board.teamId,
		teamName: board.teamName,
		revision: board.revision,
		updatedAt: board.updatedAt,
		tasks: board.tasks.map(toTeamTaskProto),
		agents: board.agents.map((agent) =>
			TeamAgent.create({
				...agent,
				lastActivityAt: agent.lastActivityAt.toISOString(),
			}),
		),
		runs: board.runs.map(toTeamRunProto),
	})
}
