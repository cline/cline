import type { HubCommandName, HubRuntimeStatus } from "@cline/shared";
import {
	SEED_EXECUTION_LIMIT,
	SEED_SESSION_LIMIT,
	SEED_TASK_LIMIT,
	SEED_UPCOMING_LIMIT,
} from "../config";
import { isoMillis, isRecord, listOf, num, text } from "../values";
import {
	type HubFold,
	type RunState,
	type ScheduleFold,
	type SessionFold,
	taskFromRecord,
} from "./fold";

/**
 * The seed. A new `NodeHubClient` cannot subscribe from a past sequence, so
 * each time the link comes up the engine subscribes first and then reads the
 * hub's current state through the commands in `HUB_SEEDS`. Pending approvals
 * need no command: the hub re-issues them on every subscribe.
 *
 * The seed fills entries the fold does not have: the subscription opened
 * before the commands were sent, so an entry folded since is at least as new
 * as the command's answer. After a reconnect, `stale` is the fold as it stood
 * when the link dropped: a session, task or execution still identical to its
 * `stale` entry has folded no event since, so it may have missed the outage's
 * events and the hub's record replaces it. An approval still identical to its
 * `stale` entry was not re-issued on subscribe, so it was resolved during the
 * outage.
 */

/** The hub's `SessionRecord.status` as a fold run state. */
const SESSION_RUN: Readonly<Record<HubRuntimeStatus, RunState>> = {
	idle: "idle",
	pending: "idle",
	running: "running",
	completed: "completed",
	aborted: "aborted",
	failed: "failed",
};

function sessionFromRecord(
	record: Record<string, unknown>,
): SessionFold | undefined {
	const sessionId = text(record.sessionId);
	if (!sessionId) return undefined;
	const status = text(record.status);
	const usage = isRecord(record.aggregateUsage)
		? record.aggregateUsage
		: isRecord(record.usage)
			? record.usage
			: {};
	return {
		sessionId,
		workspaceRoot: text(record.workspaceRoot),
		run:
			status && Object.hasOwn(SESSION_RUN, status)
				? SESSION_RUN[status as HubRuntimeStatus]
				: "idle",
		updatedAt: num(record.updatedAt),
		pendingApprovals: {},
		pendingQuestions: {},
		failedToolCalls: [],
		totalCost: num(usage.totalCost),
	};
}

/** A map copied on its first change, so seeding n entries copies it once. */
function copyOnWrite<T>(base: Record<string, T>) {
	let copy: Record<string, T> | undefined;
	return {
		get: (id: string): T | undefined => (copy ?? base)[id],
		set(id: string, value: T): void {
			copy ??= { ...base };
			copy[id] = value;
		},
		remove(id: string): void {
			copy ??= { ...base };
			Reflect.deleteProperty(copy, id);
		},
		result: (): Record<string, T> => copy ?? base,
	};
}

/**
 * A stale session replaced by the hub's record. The record carries no tool
 * failures and, from `session.list`, no usage; the hub re-issues pending
 * approvals on subscribe but never questions, so open questions stay while
 * the run is still running.
 */
function refreshed(stale: SessionFold, seeded: SessionFold): SessionFold {
	return {
		...seeded,
		totalCost: seeded.totalCost ?? stale.totalCost,
		failedToolCalls: stale.failedToolCalls,
		pendingQuestions: seeded.run === "running" ? stale.pendingQuestions : {},
	};
}

function withoutResolvedApprovals(
	current: SessionFold,
	stale: SessionFold | undefined,
): SessionFold {
	const before = stale?.pendingApprovals ?? {};
	const live = Object.entries(current.pendingApprovals).filter(
		([approvalId, item]) => item !== before[approvalId],
	);
	return live.length === Object.keys(current.pendingApprovals).length
		? current
		: { ...current, pendingApprovals: Object.fromEntries(live) };
}

/** Fold a `session.list` reply payload (`{ sessions: SessionRecord[] }`). */
export function seedSessions(
	fold: HubFold,
	payload: unknown,
	stale?: HubFold,
): HubFold {
	const sessions = copyOnWrite(fold.sessions);
	for (const record of listOf(payload, "sessions")) {
		const seeded = sessionFromRecord(record);
		if (!seeded) continue;
		const current = sessions.get(seeded.sessionId);
		if (current && current !== stale?.sessions[seeded.sessionId]) continue;
		sessions.set(
			seeded.sessionId,
			current ? refreshed(current, seeded) : seeded,
		);
	}
	if (stale) {
		for (const [sessionId, current] of Object.entries(sessions.result())) {
			const live = withoutResolvedApprovals(current, stale.sessions[sessionId]);
			if (live !== current) sessions.set(sessionId, live);
		}
	}
	const next = sessions.result();
	return next === fold.sessions ? fold : { ...fold, sessions: next };
}

/** Fold a `task.list` reply payload (`{ tasks: AgendaTaskRecord[] }`); instructions are never read. */
export function seedTasks(
	fold: HubFold,
	payload: unknown,
	stale?: HubFold,
): HubFold {
	const tasks = copyOnWrite(fold.tasks);
	const records = listOf(payload, "tasks");
	const listed = new Set<string>();
	for (const record of records) {
		const seeded = taskFromRecord(record, isoMillis(record.updatedAt));
		if (!seeded) continue;
		listed.add(seeded.taskId);
		const current = tasks.get(seeded.taskId);
		if (current && current !== stale?.tasks[seeded.taskId]) continue;
		tasks.set(seeded.taskId, seeded);
	}
	if (stale && records.length < SEED_TASK_LIMIT) {
		for (const [taskId, current] of Object.entries(tasks.result())) {
			if (!listed.has(taskId) && current === stale.tasks[taskId])
				tasks.remove(taskId);
		}
	}
	const next = tasks.result();
	return next === fold.tasks ? fold : { ...fold, tasks: next };
}

/** Fold a `schedule.upcoming` reply payload (`{ runs: { scheduleId, name, nextRunAt }[] }`). Names and next runs always refresh. */
export function seedUpcoming(fold: HubFold, payload: unknown): HubFold {
	const schedules = copyOnWrite(fold.schedules);
	for (const run of listOf(payload, "runs")) {
		const scheduleId = text(run.scheduleId);
		if (!scheduleId) continue;
		const current: ScheduleFold = schedules.get(scheduleId) ?? { scheduleId };
		schedules.set(scheduleId, {
			...current,
			name: text(run.name) ?? current.name,
			nextRunAt: text(run.nextRunAt),
		});
	}
	const next = schedules.result();
	return next === fold.schedules ? fold : { ...fold, schedules: next };
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
 * supplied since the drop. Error messages are never read.
 */
export function seedExecutions(
	fold: HubFold,
	payload: unknown,
	stale?: HubFold,
): HubFold {
	const latest = new Map<string, Record<string, unknown>>();
	for (const record of listOf(payload, "executions")) {
		const scheduleId = text(record.scheduleId);
		if (!scheduleId || !text(record.status)) continue;
		const seen = latest.get(scheduleId);
		if (!seen || executionTime(record) > executionTime(seen))
			latest.set(scheduleId, record);
	}
	const schedules = copyOnWrite(fold.schedules);
	for (const [scheduleId, record] of latest) {
		const current: ScheduleFold = schedules.get(scheduleId) ?? { scheduleId };
		if (
			current.executionId &&
			current.executionId !== stale?.schedules[scheduleId]?.executionId
		)
			continue;
		schedules.set(scheduleId, {
			...current,
			status: text(record.status),
			executionId: text(record.executionId),
			sessionId: text(record.sessionId),
			endedAt: num(record.endedAt),
		});
	}
	const next = schedules.result();
	return next === fold.schedules ? fold : { ...fold, schedules: next };
}

export const HUB_SEEDS = [
	{
		command: "session.list",
		payload: { rootOnly: true, limit: SEED_SESSION_LIMIT },
		seed: seedSessions,
	},
	{
		// `task.list` scopes workspace tasks from the connection's registered
		// authority and ignores a payload `workspaceRoot`.
		command: "task.list",
		payload: { limit: SEED_TASK_LIMIT },
		seed: seedTasks,
	},
	{
		command: "schedule.upcoming",
		payload: { allWorkspaces: true, limit: SEED_UPCOMING_LIMIT },
		seed: seedUpcoming,
	},
	{
		command: "schedule.list_executions",
		payload: { allWorkspaces: true, limit: SEED_EXECUTION_LIMIT },
		seed: seedExecutions,
	},
] as const satisfies ReadonlyArray<{
	command: HubCommandName;
	payload: Record<string, unknown>;
	seed: (fold: HubFold, payload: unknown, stale?: HubFold) => HubFold;
}>;
