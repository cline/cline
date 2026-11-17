import type { ScheduleExecution } from "./schedule-types";

export const SUCCESS_STATUSES: ReadonlySet<string> = new Set([
	"success",
	"completed",
]);
export const FAILURE_STATUSES: ReadonlySet<string> = new Set([
	"failed",
	"timeout",
	"aborted",
]);

const STATUS_LABELS: Readonly<Record<string, string>> = {
	pending: "Pending",
	queued: "Pending",
	running: "Running",
	success: "Completed",
	completed: "Completed",
	failed: "Failed",
	timeout: "Timed out",
	aborted: "Aborted",
	cancelled: "Cancelled",
	canceled: "Cancelled",
};

export function executionStatus(execution: ScheduleExecution): string {
	return execution.status?.trim().toLowerCase() ?? "";
}

/** One vocabulary for run results, wherever they appear. */
export function formatExecutionStatus(status: string | undefined): string {
	const normalized = status?.trim().toLowerCase() ?? "";
	if (!normalized) return "Unknown result";
	return (
		STATUS_LABELS[normalized] ??
		`${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`
	);
}

function executionTime(execution: ScheduleExecution): number {
	const timestamp = new Date(
		execution.endedAt ?? execution.startedAt ?? execution.triggeredAt ?? 0,
	).getTime();
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function isFinished(execution: ScheduleExecution): boolean {
	const status = executionStatus(execution);
	return SUCCESS_STATUSES.has(status) || FAILURE_STATUSES.has(status);
}

export function hasExecutionError(execution: ScheduleExecution): boolean {
	return (
		FAILURE_STATUSES.has(executionStatus(execution)) ||
		Boolean(execution.errorMessage?.trim())
	);
}

/** Select the same recent snapshots for run history and its status indicators. */
export function getScheduleExecutions(
	scheduleId: string | undefined,
	executions: ScheduleExecution[],
): ScheduleExecution[] {
	if (!scheduleId) return [];
	const matching = executions
		.filter((execution) => execution.scheduleId === scheduleId)
		.sort(
			(left, right) =>
				executionTime(right) - executionTime(left) ||
				Number(isFinished(right)) - Number(isFinished(left)),
		);
	// A run can appear in both active and recent snapshots. Keep the newest
	// record, preferring its final result when timestamps are tied.
	const unique = new Map<string, ScheduleExecution>();
	for (const execution of matching) {
		if (!unique.has(execution.executionId))
			unique.set(execution.executionId, execution);
	}
	return [...unique.values()];
}
