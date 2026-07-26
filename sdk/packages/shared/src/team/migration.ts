import type {
	TeamMemberSnapshot,
	TeamRuntimeState,
	TeamTask,
	TeamTaskStatus,
} from "./types";

function asDate(value: unknown, fallback = new Date()): Date {
	const date = value instanceof Date ? value : new Date(String(value ?? ""));
	return Number.isNaN(date.getTime()) ? fallback : date;
}

function migrateTaskStatus(value: unknown): TeamTaskStatus {
	switch (value) {
		case "backlog":
		case "ready":
		case "in-progress":
		case "blocked":
		case "review":
		case "done":
			return value;
		case "in_progress":
			return "in-progress";
		case "completed":
			return "done";
		default:
			return "backlog";
	}
}

function migrateTask(value: unknown): TeamTask | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string" || typeof record.title !== "string") {
		return undefined;
	}
	const createdAt = asDate(record.createdAt);
	const assignedAgentId =
		typeof record.assignedAgentId === "string"
			? record.assignedAgentId
			: typeof record.assignee === "string"
				? record.assignee
				: undefined;
	return {
		...record,
		id: record.id,
		title: record.title,
		status: migrateTaskStatus(record.status),
		description:
			typeof record.description === "string" ? record.description : undefined,
		parentTaskId:
			typeof record.parentTaskId === "string" ? record.parentTaskId : undefined,
		assignedAgentId,
		sessionId:
			typeof record.sessionId === "string" ? record.sessionId : undefined,
		worktreePath:
			typeof record.worktreePath === "string" ? record.worktreePath : undefined,
		branch: typeof record.branch === "string" ? record.branch : undefined,
		summary: typeof record.summary === "string" ? record.summary : undefined,
		blocker:
			typeof record.blocker === "string"
				? record.blocker
				: record.status === "blocked" && typeof record.summary === "string"
					? record.summary
					: undefined,
		createdAt,
		updatedAt: asDate(record.updatedAt, createdAt),
		revision:
			typeof record.revision === "number" && record.revision > 0
				? Math.floor(record.revision)
				: 1,
		createdBy: typeof record.createdBy === "string" ? record.createdBy : "user",
		dependsOn: Array.isArray(record.dependsOn)
			? record.dependsOn.filter(
					(item): item is string => typeof item === "string",
				)
			: [],
	} as TeamTask;
}

function migrateMember(value: unknown): TeamMemberSnapshot | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (typeof record.agentId !== "string") return undefined;
	return {
		...record,
		agentId: record.agentId,
		displayLabel:
			typeof record.displayLabel === "string"
				? record.displayLabel
				: record.agentId,
		role: record.role === "teammate" ? "teammate" : "lead",
		status:
			record.status === "running" || record.status === "stopped"
				? record.status
				: "idle",
		lastActivityAt: asDate(record.lastActivityAt),
	} as TeamMemberSnapshot;
}

/** Upgrade persisted v1 team snapshots to the local Kanban v2 contract. */
export function migrateTeamRuntimeState(
	value: unknown,
): TeamRuntimeState | undefined {
	if (!value || typeof value !== "object") return undefined;
	const state = value as Record<string, unknown>;
	if (typeof state.teamId !== "string" || typeof state.teamName !== "string") {
		return undefined;
	}
	const tasks = Array.isArray(state.tasks)
		? state.tasks.flatMap((task) => {
				const migrated = migrateTask(task);
				return migrated ? [migrated] : [];
			})
		: [];
	const members = Array.isArray(state.members)
		? state.members.flatMap((member) => {
				const migrated = migrateMember(member);
				return migrated ? [migrated] : [];
			})
		: [];
	return {
		...state,
		teamId: state.teamId,
		teamName: state.teamName,
		members,
		tasks,
		mailbox: Array.isArray(state.mailbox) ? state.mailbox : [],
		missionLog: Array.isArray(state.missionLog) ? state.missionLog : [],
		runs: Array.isArray(state.runs) ? state.runs : [],
		outcomes: Array.isArray(state.outcomes) ? state.outcomes : [],
		outcomeFragments: Array.isArray(state.outcomeFragments)
			? state.outcomeFragments
			: [],
	} as TeamRuntimeState;
}
