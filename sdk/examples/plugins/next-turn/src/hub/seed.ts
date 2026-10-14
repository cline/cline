import {
	type HubFold,
	isoMillis,
	isRecord,
	type RunState,
	type ScheduleFold,
	type SessionFold,
	type TaskFold,
} from "./fold";

/**
 * The cold-start seed. `NodeHubClient.subscribe` cannot resume from
 * a sequence yet (upstream ask U1), so a new engine subscribes first and then
 * reads the hub's current state through commands: `session.list`,
 * `task.list`, `schedule.upcoming` and `schedule.list_executions`. Pending
 * approvals need no command: the hub re-issues them on every subscribe.
 *
 * The seed only fills entries the fold does not have. The subscription opened
 * before the commands were sent, so anything already folded is newer than
 * the command's answer.
 */

/** The hub's `SessionRecord.status` (`HubRuntimeStatus`) as a fold run state. */
const SESSION_RUN: Readonly<Record<string, RunState>> = {
	idle: "idle",
	pending: "idle",
	running: "running",
	completed: "completed",
	aborted: "aborted",
	failed: "failed",
};

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function sessionFromRecord(
	record: Record<string, unknown>,
): SessionFold | undefined {
	const sessionId = text(record.sessionId);
	if (!sessionId) return undefined;
	const usage = isRecord(record.aggregateUsage)
		? record.aggregateUsage
		: isRecord(record.usage)
			? record.usage
			: {};
	return {
		sessionId,
		workspaceRoot: text(record.workspaceRoot),
		run: SESSION_RUN[text(record.status) ?? ""] ?? "idle",
		updatedAt: num(record.updatedAt),
		pendingApprovals: {},
		pendingQuestions: {},
		failedToolCalls: [],
		totalCost: num(usage.totalCost),
	};
}

function taskFromRecord(record: Record<string, unknown>): TaskFold | undefined {
	const taskId = text(record.taskId);
	const status = text(record.status);
	if (!taskId || !status) return undefined;
	return {
		taskId,
		status,
		title: text(record.title) ?? "",
		priority: num(record.priority),
		revision: num(record.revision),
		workspaceRoot: text(record.workspaceRoot),
		lastSessionId: text(record.lastSessionId),
		updatedAt: isoMillis(record.updatedAt),
	};
}

function listOf(payload: unknown, key: string): Record<string, unknown>[] {
	const list = isRecord(payload) ? payload[key] : undefined;
	return Array.isArray(list) ? list.filter(isRecord) : [];
}

/** Fold a `session.list` reply payload (`{ sessions: SessionRecord[] }`). */
export function seedSessions(fold: HubFold, payload: unknown): HubFold {
	let sessions = fold.sessions;
	for (const record of listOf(payload, "sessions")) {
		const seeded = sessionFromRecord(record);
		if (!seeded || sessions[seeded.sessionId]) continue;
		sessions = { ...sessions, [seeded.sessionId]: seeded };
	}
	return sessions === fold.sessions ? fold : { ...fold, sessions };
}

/** Fold a `task.list` reply payload (`{ tasks: AgendaTaskRecord[] }`); instructions are never read. */
export function seedTasks(fold: HubFold, payload: unknown): HubFold {
	let tasks = fold.tasks;
	for (const record of listOf(payload, "tasks")) {
		const seeded = taskFromRecord(record);
		if (!seeded || tasks[seeded.taskId]) continue;
		tasks = { ...tasks, [seeded.taskId]: seeded };
	}
	return tasks === fold.tasks ? fold : { ...fold, tasks };
}

/** Fold a `schedule.upcoming` reply payload (`{ runs: { scheduleId, name, nextRunAt }[] }`). Names and next runs always refresh. */
export function seedUpcoming(fold: HubFold, payload: unknown): HubFold {
	let schedules = fold.schedules;
	for (const run of listOf(payload, "runs")) {
		const scheduleId = text(run.scheduleId);
		if (!scheduleId) continue;
		const current: ScheduleFold = schedules[scheduleId] ?? { scheduleId };
		schedules = {
			...schedules,
			[scheduleId]: {
				...current,
				name: text(run.name) ?? current.name,
				nextRunAt: text(run.nextRunAt),
			},
		};
	}
	return schedules === fold.schedules ? fold : { ...fold, schedules };
}

function executionTime(record: Record<string, unknown>): number {
	return (
		num(record.endedAt) ?? num(record.startedAt) ?? num(record.triggeredAt) ?? 0
	);
}

/**
 * Fold a `schedule.list_executions` reply payload
 * (`{ executions: ScheduleExecutionRecord[] }`): the latest execution per
 * schedule, for schedules whose latest execution live events have not
 * supplied. Error messages are never read.
 */
export function seedExecutions(fold: HubFold, payload: unknown): HubFold {
	const latest = new Map<string, Record<string, unknown>>();
	for (const record of listOf(payload, "executions")) {
		const scheduleId = text(record.scheduleId);
		if (!scheduleId || !text(record.status)) continue;
		const seen = latest.get(scheduleId);
		if (!seen || executionTime(record) > executionTime(seen))
			latest.set(scheduleId, record);
	}
	let schedules = fold.schedules;
	for (const [scheduleId, record] of latest) {
		const current: ScheduleFold = schedules[scheduleId] ?? { scheduleId };
		if (current.executionId) continue;
		schedules = {
			...schedules,
			[scheduleId]: {
				...current,
				status: text(record.status),
				executionId: text(record.executionId),
				sessionId: text(record.sessionId),
				endedAt: num(record.endedAt),
			},
		};
	}
	return schedules === fold.schedules ? fold : { ...fold, schedules };
}
