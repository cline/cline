interface RoutineExecutionLike {
	executionId: string;
	status?: string;
	triggeredAt?: number | string;
}

/** The hub polls every 15s; a pending run older than this is not just waiting for the next poll. */
const OVERDUE_GRACE_MS = 2 * 60_000;

function toTimestamp(value?: number | string): number | undefined {
	if (value === undefined) return undefined;
	const parsed = typeof value === "number" ? value : new Date(value).getTime();
	return Number.isFinite(parsed) ? parsed : undefined;
}

function formatDuration(ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 60) return `${Math.max(minutes, 1)} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours} h`;
	return `${Math.floor(hours / 24)} days`;
}

/**
 * Explains why a run is still pending. A pending run has no error of its
 * own: it is either waiting for the schedule's in-progress run (schedules
 * run one at a time), not yet due, or overdue because the scheduler never
 * picked it up.
 */
export function describePendingExecution(
	execution: RoutineExecutionLike,
	scheduleExecutions: readonly RoutineExecutionLike[],
	now = Date.now(),
): string | undefined {
	if (execution.status?.toLowerCase() !== "pending") return undefined;
	const blocked = scheduleExecutions.some(
		(other) =>
			other.executionId !== execution.executionId &&
			other.status?.toLowerCase() === "running",
	);
	if (blocked) {
		return "Waiting for this schedule's current run to finish.";
	}
	const dueAt = toTimestamp(execution.triggeredAt);
	if (dueAt === undefined || now - dueAt < OVERDUE_GRACE_MS) {
		return "Queued; the scheduler starts it at the scheduled time.";
	}
	return `Overdue by ${formatDuration(now - dueAt)}; the scheduler has not picked it up. Restart the app if this persists.`;
}
