import type { HubEventName } from "@cline/shared";
import { isoMillis, isRecord, num, text } from "../values";
import type { HubEvent } from "./link";

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

type PendingField = "pendingApprovals" | "pendingQuestions";

export type TaskFold = {
	taskId: string;
	status: string;
	title: string;
	priority?: number;
	workspaceRoot?: string;
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
};

export function emptyFold(): HubFold {
	return {
		sequence: 0,
		sessions: {},
		tasks: {},
		schedules: {},
		teams: {},
	};
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

type FoldStep = (fold: HubFold, event: HubEvent) => HubFold;

function forSession(
	step: (fold: HubFold, event: HubEvent, sessionId: string) => HubFold,
): FoldStep {
	return (fold, event) =>
		event.sessionId ? step(fold, event, event.sessionId) : fold;
}

function runStarted(
	fold: HubFold,
	event: HubEvent,
	sessionId: string,
): HubFold {
	return withSession(fold, sessionId, {
		...session(fold, sessionId),
		run: "running",
		failedToolCalls: [],
		updatedAt: event.timestamp,
	});
}

function runEnded(run: RunState): FoldStep {
	return forSession((fold, event, sessionId) => {
		const current = session(fold, sessionId);
		const snapshot = payloadOf(event).snapshot;
		const workspace =
			isRecord(snapshot) && isRecord(snapshot.workspace)
				? text(snapshot.workspace.root)
				: undefined;
		return withSession(fold, sessionId, {
			...current,
			run,
			workspaceRoot: workspace ?? current.workspaceRoot,
			updatedAt: event.timestamp,
			// A question is asked inside a run, so it cannot outlive it.
			pendingQuestions: {},
		});
	});
}

function toolFinished(
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

function approvalRequested(fold: HubFold, event: HubEvent): HubFold {
	const payload = payloadOf(event);
	const approvalId = text(payload.approvalId);
	const sessionId = text(payload.sessionId) ?? event.sessionId;
	if (!approvalId || !sessionId) return fold;
	const current = session(fold, sessionId);
	const item: PendingItem = {
		at: event.timestamp,
		toolName: text(payload.toolName),
	};
	return withSession(fold, sessionId, {
		...current,
		pendingApprovals: { ...current.pendingApprovals, [approvalId]: item },
	});
}

function approvalResolved(fold: HubFold, event: HubEvent): HubFold {
	const approvalId = text(payloadOf(event).approvalId);
	return approvalId
		? resolvePending(fold, event, approvalId, "pendingApprovals")
		: fold;
}

function questionId(event: HubEvent): string | undefined {
	const payload = payloadOf(event);
	return payload.capabilityName === ASK_QUESTION_CAPABILITY
		? text(payload.requestId)
		: undefined;
}

function questionAsked(
	fold: HubFold,
	event: HubEvent,
	sessionId: string,
): HubFold {
	const requestId = questionId(event);
	if (!requestId) return fold;
	const current = session(fold, sessionId);
	return withSession(fold, sessionId, {
		...current,
		pendingQuestions: {
			...current.pendingQuestions,
			[requestId]: { at: event.timestamp },
		},
	});
}

function questionResolved(fold: HubFold, event: HubEvent): HubFold {
	const requestId = questionId(event);
	return requestId
		? resolvePending(fold, event, requestId, "pendingQuestions")
		: fold;
}

/** Hub resolutions name their session; one without it resolves wherever the id is pending. */
function resolvePending(
	fold: HubFold,
	event: HubEvent,
	id: string,
	field: PendingField,
): HubFold {
	const named = event.sessionId ? fold.sessions[event.sessionId] : undefined;
	const owner =
		named && Object.hasOwn(named[field], id)
			? named
			: Object.values(fold.sessions).find((candidate) =>
					Object.hasOwn(candidate[field], id),
				);
	if (!owner) return fold;
	return withSession(fold, owner.sessionId, {
		...owner,
		[field]: without(owner[field], id),
	});
}

function taskChanged(fold: HubFold, event: HubEvent): HubFold {
	const task = payloadOf(event).task;
	const folded = isRecord(task)
		? taskFromRecord(task, event.timestamp)
		: undefined;
	return folded
		? { ...fold, tasks: { ...fold.tasks, [folded.taskId]: folded } }
		: fold;
}

function taskDeleted(fold: HubFold, event: HubEvent): HubFold {
	const task = payloadOf(event).task;
	const taskId = isRecord(task) ? text(task.taskId) : undefined;
	return taskId ? { ...fold, tasks: without(fold.tasks, taskId) } : fold;
}

/** A hub `AgendaTaskRecord` as the fold keeps it; instructions are never read. */
export function taskFromRecord(
	record: Record<string, unknown>,
	updatedAt: number | undefined,
): TaskFold | undefined {
	const taskId = text(record.taskId);
	const status = text(record.status);
	if (!taskId || !status) return undefined;
	return {
		taskId,
		status,
		title: text(record.title) ?? "",
		priority: num(record.priority),
		workspaceRoot: text(record.workspaceRoot),
		updatedAt,
	};
}

function scheduleDeleted(fold: HubFold, event: HubEvent): HubFold {
	const scheduleId = text(payloadOf(event).scheduleId);
	return scheduleId && scheduleId in fold.schedules
		? { ...fold, schedules: without(fold.schedules, scheduleId) }
		: fold;
}

/** A disabled schedule has no next run; its other changes arrive with `schedule.upcoming`. */
function scheduleDisabled(fold: HubFold, event: HubEvent): HubFold {
	const schedule = payloadOf(event).schedule;
	if (!isRecord(schedule) || schedule.enabled !== false) return fold;
	const scheduleId = text(schedule.scheduleId);
	const current = scheduleId ? fold.schedules[scheduleId] : undefined;
	if (current?.nextRunAt === undefined) return fold;
	const { nextRunAt: _disabled, ...rest } = current;
	return {
		...fold,
		schedules: { ...fold.schedules, [current.scheduleId]: rest },
	};
}

function scheduleExecution(defaultStatus: "completed" | "failed"): FoldStep {
	return (fold, event) => {
		const payload = payloadOf(event);
		const scheduleId = text(payload.scheduleId);
		if (!scheduleId) return fold;
		return {
			...fold,
			schedules: {
				...fold.schedules,
				[scheduleId]: {
					...fold.schedules[scheduleId],
					scheduleId,
					status: text(payload.status) ?? defaultStatus,
					executionId: text(payload.executionId),
					sessionId: text(payload.sessionId),
					endedAt: num(payload.endedAt),
				},
			},
		};
	};
}

function idCount(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

function teamProgress(fold: HubFold, event: HubEvent): HubFold {
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

function usageUpdated(fold: HubFold, event: HubEvent): HubFold {
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

function sessionRecord(fold: HubFold, event: HubEvent): HubFold {
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

/**
 * The hub events Next Turn folds, and how. Never `assistant.delta` or
 * `reasoning.delta`: the fold keeps ids, states, counts and sequences, never
 * what an agent or a person wrote.
 */
const FOLD_STEPS = new Map<HubEventName, FoldStep>([
	["run.started", forSession(runStarted)],
	["run.completed", runEnded("completed")],
	["run.failed", runEnded("failed")],
	["run.aborted", runEnded("aborted")],
	["run.interrupted", runEnded("interrupted")],
	["tool.finished", forSession(toolFinished)],
	["approval.requested", approvalRequested],
	["approval.resolved", approvalResolved],
	["capability.requested", forSession(questionAsked)],
	["capability.resolved", questionResolved],
	["task.created", taskChanged],
	["task.updated", taskChanged],
	["task.run.started", taskChanged],
	["task.run.completed", taskChanged],
	["task.run.failed", taskChanged],
	["task.deleted", taskDeleted],
	["schedule.updated", scheduleDisabled],
	["schedule.deleted", scheduleDeleted],
	["schedule.execution_completed", scheduleExecution("completed")],
	["schedule.execution_failed", scheduleExecution("failed")],
	["team.progress", teamProgress],
	["usage.updated", usageUpdated],
	["session.created", sessionRecord],
	["session.updated", sessionRecord],
]);

export const FOLDED_EVENTS: ReadonlySet<HubEventName> = new Set(
	FOLD_STEPS.keys(),
);

/**
 * Fold one event. Events outside `FOLDED_EVENTS` and events already folded
 * (a sequence at or below the fold's) leave the fold unchanged, so replaying
 * a log over a live fold is safe. Events without a sequence (re-issued
 * pending approvals) fold idempotently by their id.
 */
export function foldEvent(fold: HubFold, event: HubEvent): HubFold {
	const step = FOLD_STEPS.get(event.event);
	if (!step) return fold;
	if (event.sequence !== undefined && event.sequence <= fold.sequence)
		return fold;
	const next = step(fold, event);
	return event.sequence !== undefined
		? { ...next, sequence: event.sequence }
		: next;
}
