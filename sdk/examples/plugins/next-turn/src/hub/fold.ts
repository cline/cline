import type { HubEvent } from "./link";

/**
 * The hub events Next Turn folds. Never `assistant.delta` or
 * `reasoning.delta`: the fold keeps ids, states, counts and sequences, never
 * what an agent or a person wrote (ADR-0008).
 */
export const FOLDED_EVENTS: ReadonlySet<string> = new Set([
	"run.started",
	"run.completed",
	"run.failed",
	"run.aborted",
	"run.interrupted",
	"tool.finished",
	"approval.requested",
	"approval.resolved",
	"capability.requested",
	"capability.resolved",
	"task.created",
	"task.updated",
	"task.deleted",
	"task.run.started",
	"task.run.completed",
	"task.run.failed",
	"schedule.deleted",
	"schedule.execution_completed",
	"schedule.execution_failed",
	"team.progress",
	"usage.updated",
	"session.created",
	"session.updated",
]);

/** The capability request that is an agent asking the person a question. */
export const ASK_QUESTION_CAPABILITY = "tool_executor.askQuestion";

export type RunState =
	| "idle"
	| "running"
	| "completed"
	| "failed"
	| "aborted"
	| "interrupted";

export type PendingItem = { at?: number; toolName?: string };

export type SessionFold = {
	sessionId: string;
	workspaceRoot?: string;
	run: RunState;
	updatedAt?: number;
	pendingApprovals: Record<string, PendingItem>;
	pendingQuestions: Record<string, PendingItem>;
	/** Distinct tool calls that finished with an error in the current run. */
	failedToolCalls: string[];
	totalCost?: number;
};

export type TaskFold = {
	taskId: string;
	status: string;
	title: string;
	priority?: number;
	revision?: number;
	workspaceRoot?: string;
	lastSessionId?: string;
	updatedAt?: number;
};

export type ScheduleFold = {
	scheduleId: string;
	/** The latest execution's status, when one is known. */
	status?: string;
	executionId?: string;
	sessionId?: string;
	endedAt?: number;
	/** From `schedule.upcoming`: the schedule's title and its next run (ISO-8601). */
	name?: string;
	nextRunAt?: string;
};

export type TeamFold = {
	sessionId: string;
	teamName?: string;
	blockedTasks: number;
	readyTasks: number;
	completionPct?: number;
	updatedAt?: number;
};

export type HubFold = {
	/** The highest durable-log sequence folded; 0 before any. */
	sequence: number;
	sessions: Record<string, SessionFold>;
	tasks: Record<string, TaskFold>;
	schedules: Record<string, ScheduleFold>;
	teams: Record<string, TeamFold>;
	/** Which session an open approval or question belongs to; resolutions carry only the id. */
	pendingIndex: Record<string, string>;
};

export function emptyFold(): HubFold {
	return {
		sequence: 0,
		sessions: {},
		tasks: {},
		schedules: {},
		teams: {},
		pendingIndex: {},
	};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function isoMillis(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : undefined;
}

function payloadOf(event: HubEvent): Record<string, unknown> {
	return isRecord(event.payload) ? event.payload : {};
}

function session(fold: HubFold, sessionId: string): SessionFold {
	return (
		fold.sessions[sessionId] ?? {
			sessionId,
			run: "idle",
			pendingApprovals: {},
			pendingQuestions: {},
			failedToolCalls: [],
		}
	);
}

function withSession(
	fold: HubFold,
	sessionId: string,
	next: SessionFold,
): HubFold {
	return { ...fold, sessions: { ...fold.sessions, [sessionId]: next } };
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
	if (!(key in record)) return record;
	const { [key]: _removed, ...rest } = record;
	return rest;
}

const TERMINAL_RUN: Readonly<Record<string, RunState>> = {
	"run.completed": "completed",
	"run.failed": "failed",
	"run.aborted": "aborted",
	"run.interrupted": "interrupted",
};

function foldRun(fold: HubFold, event: HubEvent, sessionId: string): HubFold {
	const current = session(fold, sessionId);
	if (event.event === "run.started") {
		return withSession(fold, sessionId, {
			...current,
			run: "running",
			failedToolCalls: [],
			updatedAt: event.timestamp,
		});
	}
	const terminal = TERMINAL_RUN[event.event];
	if (!terminal) return fold;
	const snapshot = payloadOf(event).snapshot;
	const workspace =
		isRecord(snapshot) && isRecord(snapshot.workspace)
			? text(snapshot.workspace.root)
			: undefined;
	return withSession(fold, sessionId, {
		...current,
		run: terminal,
		workspaceRoot: workspace ?? current.workspaceRoot,
		updatedAt: event.timestamp,
	});
}

function foldToolFinished(
	fold: HubFold,
	event: HubEvent,
	sessionId: string,
): HubFold {
	const payload = payloadOf(event);
	const toolCallId = text(payload.toolCallId);
	if (!toolCallId || !payload.error) return fold;
	const current = session(fold, sessionId);
	if (current.failedToolCalls.includes(toolCallId)) return fold;
	return withSession(fold, sessionId, {
		...current,
		failedToolCalls: [...current.failedToolCalls, toolCallId],
	});
}

function foldApproval(fold: HubFold, event: HubEvent): HubFold {
	const payload = payloadOf(event);
	const approvalId = text(payload.approvalId);
	if (!approvalId) return fold;
	if (event.event === "approval.requested") {
		const sessionId = text(payload.sessionId) ?? event.sessionId;
		if (!sessionId) return fold;
		const current = session(fold, sessionId);
		const item: PendingItem = {
			at: event.timestamp,
			toolName: text(payload.toolName),
		};
		return {
			...withSession(fold, sessionId, {
				...current,
				pendingApprovals: { ...current.pendingApprovals, [approvalId]: item },
			}),
			pendingIndex: { ...fold.pendingIndex, [approvalId]: sessionId },
		};
	}
	return resolvePending(fold, approvalId, "pendingApprovals");
}

function foldCapability(fold: HubFold, event: HubEvent): HubFold {
	const payload = payloadOf(event);
	const requestId = text(payload.requestId);
	if (!requestId || payload.capabilityName !== ASK_QUESTION_CAPABILITY)
		return fold;
	if (event.event === "capability.requested") {
		const sessionId = event.sessionId;
		if (!sessionId) return fold;
		const current = session(fold, sessionId);
		return {
			...withSession(fold, sessionId, {
				...current,
				pendingQuestions: {
					...current.pendingQuestions,
					[requestId]: { at: event.timestamp },
				},
			}),
			pendingIndex: { ...fold.pendingIndex, [requestId]: sessionId },
		};
	}
	return resolvePending(fold, requestId, "pendingQuestions");
}

function resolvePending(
	fold: HubFold,
	id: string,
	field: "pendingApprovals" | "pendingQuestions",
): HubFold {
	const sessionId = fold.pendingIndex[id];
	if (!sessionId) return fold;
	const current = session(fold, sessionId);
	return {
		...withSession(fold, sessionId, {
			...current,
			[field]: without(current[field], id),
		}),
		pendingIndex: without(fold.pendingIndex, id),
	};
}

function foldTask(fold: HubFold, event: HubEvent): HubFold {
	const task = payloadOf(event).task;
	if (!isRecord(task)) return fold;
	const taskId = text(task.taskId);
	if (!taskId) return fold;
	if (event.event === "task.deleted")
		return { ...fold, tasks: without(fold.tasks, taskId) };
	const status = text(task.status);
	if (!status) return fold;
	return {
		...fold,
		tasks: {
			...fold.tasks,
			[taskId]: {
				taskId,
				status,
				title: text(task.title) ?? "",
				priority: num(task.priority),
				revision: num(task.revision),
				workspaceRoot: text(task.workspaceRoot),
				lastSessionId: text(task.lastSessionId),
				updatedAt: event.timestamp,
			},
		},
	};
}

function foldSchedule(fold: HubFold, event: HubEvent): HubFold {
	const payload = payloadOf(event);
	const scheduleId = text(payload.scheduleId);
	if (!scheduleId) return fold;
	if (event.event === "schedule.deleted") {
		return scheduleId in fold.schedules
			? { ...fold, schedules: without(fold.schedules, scheduleId) }
			: fold;
	}
	const status =
		text(payload.status) ??
		(event.event === "schedule.execution_failed" ? "failed" : "completed");
	return {
		...fold,
		schedules: {
			...fold.schedules,
			[scheduleId]: {
				...fold.schedules[scheduleId],
				scheduleId,
				status,
				executionId: text(payload.executionId),
				sessionId: text(payload.sessionId),
				endedAt: num(payload.endedAt),
			},
		},
	};
}

function idCount(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function foldTeam(fold: HubFold, event: HubEvent): HubFold {
	const payload = payloadOf(event);
	const sessionId = text(payload.sessionId) ?? event.sessionId;
	const summary = payload.summary;
	if (!sessionId || !isRecord(summary)) return fold;
	const tasks = isRecord(summary.tasks) ? summary.tasks : {};
	return {
		...fold,
		teams: {
			...fold.teams,
			[sessionId]: {
				sessionId,
				teamName: text(summary.teamName),
				blockedTasks: idCount(tasks.blockedTaskIds),
				readyTasks: idCount(tasks.readyTaskIds),
				completionPct: num(tasks.completionPct),
				updatedAt: num(summary.updatedAt) ?? event.timestamp,
			},
		},
	};
}

function foldUsage(fold: HubFold, event: HubEvent): HubFold {
	const payload = payloadOf(event);
	const sessionId = text(payload.sessionId) ?? event.sessionId;
	const totals = payload.totals;
	if (!sessionId || !isRecord(totals)) return fold;
	const totalCost = num(totals.totalCost);
	if (totalCost === undefined) return fold;
	return withSession(fold, sessionId, {
		...session(fold, sessionId),
		totalCost,
	});
}

function foldSessionRecord(fold: HubFold, event: HubEvent): HubFold {
	const payload = payloadOf(event);
	const record = isRecord(payload.session)
		? payload.session
		: isRecord(payload.snapshot)
			? payload.snapshot
			: undefined;
	if (!record) return fold;
	const sessionId =
		text(record.sessionId) ?? text(payload.sessionId) ?? event.sessionId;
	if (!sessionId) return fold;
	const current = session(fold, sessionId);
	return withSession(fold, sessionId, {
		...current,
		workspaceRoot: text(record.workspaceRoot) ?? current.workspaceRoot,
		updatedAt: isoMillis(record.updatedAt) ?? current.updatedAt,
	});
}

function foldBody(fold: HubFold, event: HubEvent): HubFold {
	const name = event.event;
	if (name.startsWith("run."))
		return event.sessionId ? foldRun(fold, event, event.sessionId) : fold;
	if (name === "tool.finished")
		return event.sessionId
			? foldToolFinished(fold, event, event.sessionId)
			: fold;
	if (name.startsWith("approval.")) return foldApproval(fold, event);
	if (name.startsWith("capability.")) return foldCapability(fold, event);
	if (name.startsWith("task.")) return foldTask(fold, event);
	if (name.startsWith("schedule.")) return foldSchedule(fold, event);
	if (name === "team.progress") return foldTeam(fold, event);
	if (name === "usage.updated") return foldUsage(fold, event);
	if (name.startsWith("session.")) return foldSessionRecord(fold, event);
	return fold;
}

/**
 * Fold one event. Events outside `FOLDED_EVENTS` and events already folded
 * (a sequence at or below the fold's) leave the fold unchanged, so replaying
 * a log over a live fold is safe. Events without a sequence (re-issued
 * pending approvals) fold idempotently by their id.
 */
export function foldEvent(fold: HubFold, event: HubEvent): HubFold {
	if (!FOLDED_EVENTS.has(event.event)) return fold;
	if (event.sequence !== undefined && event.sequence <= fold.sequence)
		return fold;
	const next = foldBody(fold, event);
	return event.sequence !== undefined
		? { ...next, sequence: event.sequence }
		: next;
}

export function foldEvents(fold: HubFold, events: Iterable<HubEvent>): HubFold {
	let current = fold;
	for (const event of events) current = foldEvent(current, event);
	return current;
}
