import {
	executionStatus,
	formatExecutionStatus,
	getScheduleExecutions,
} from "./schedule-executions";
import { classifyCronPattern, formatDateTime } from "./schedule-format";
import type {
	DateTimeValue,
	Schedule,
	ScheduleExecution,
} from "./schedule-types";

const PLACEHOLDER = "—";

/** Label the schedule frequency without including its run time. */
export function formatScheduleFrequency(schedule: Schedule): string {
	const timing = classifyCronPattern(schedule.cronPattern);
	if (timing.kind === "once") return "Once";
	if (timing.kind === "custom") return "Custom";
	return timing.kind === "daily" ? "Daily" : "Weekly";
}

function toDate(value?: DateTimeValue | null): Date | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date : undefined;
}

function isSameDay(left: Date, right: Date): boolean {
	return (
		left.getFullYear() === right.getFullYear() &&
		left.getMonth() === right.getMonth() &&
		left.getDate() === right.getDate()
	);
}

function shiftDays(date: Date, days: number): Date {
	const shifted = new Date(date);
	shifted.setDate(shifted.getDate() + days);
	return shifted;
}

/** Calendar days relative to today, falling back to a short local date. */
function formatRelativeDay(date: Date, now: Date): string {
	if (isSameDay(date, now)) return "Today";
	if (isSameDay(date, shiftDays(now, -1))) return "Yesterday";
	if (isSameDay(date, shiftDays(now, 1))) return "Tomorrow";
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
	});
}

export function formatScheduleLastRun(
	value?: DateTimeValue | null,
	now = new Date(),
): string {
	const date = toDate(value);
	return date ? formatRelativeDay(date, now) : PLACEHOLDER;
}

/** When the schedule fires next, or a placeholder when none is planned. */
export function formatScheduleNextRun(
	schedule: Pick<Schedule, "enabled" | "nextRunAt">,
	now = new Date(),
): string {
	if (!schedule.enabled) return PLACEHOLDER;
	const date = toDate(schedule.nextRunAt);
	if (!date) return PLACEHOLDER;
	const time = date.toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
	return `${formatRelativeDay(date, now)}, ${time}`;
}

function describeResult(execution: ScheduleExecution): string {
	const label = formatExecutionStatus(execution.status);
	const when = formatDateTime(
		execution.endedAt ?? execution.startedAt ?? execution.triggeredAt,
	);
	return when === "-" ? label : `${label} at ${when}`;
}

/** The overview contains a bounded history, not a lifetime execution count. */
export function summarizeScheduleRuns(
	schedule: Schedule,
	executions: ScheduleExecution[],
): { label: string; description: string; status?: string } {
	const runs = getScheduleExecutions(schedule.scheduleId, executions);
	const latest = runs[0];
	if (!latest) {
		return schedule.lastRunAt !== undefined && schedule.lastRunAt !== null
			? {
					label: PLACEHOLDER,
					description: "Earlier runs are outside the available recent history.",
				}
			: {
					label: "Not run yet",
					description: "This schedule has no recorded runs.",
				};
	}
	const statuses = runs.map(executionStatus);
	// An active run outranks the latest finished result.
	const status = statuses.includes("running")
		? "running"
		: statuses.some((status) => status === "pending" || status === "queued")
			? "pending"
			: executionStatus(latest);
	const description = [
		`${runs.length} recent ${runs.length === 1 ? "run" : "runs"} available; older runs may not be included.`,
		`Last result: ${describeResult(latest)}.`,
		latest.errorMessage ? `Last error: ${latest.errorMessage}` : "",
	]
		.filter(Boolean)
		.join(" ");
	return { label: formatExecutionStatus(status), description, status };
}
