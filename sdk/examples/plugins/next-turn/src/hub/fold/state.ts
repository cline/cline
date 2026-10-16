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
