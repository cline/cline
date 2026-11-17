import { ONE_TIME_SCHEDULE_CRON_PATTERN } from "@cline/shared/browser";
import { describe, expect, it } from "vitest";
import {
	formatScheduleFrequency,
	formatScheduleLastRun,
	formatScheduleNextRun,
	summarizeScheduleRuns,
} from "./schedule-list-format";
import type { Schedule, ScheduleExecution } from "./schedule-types";

const schedule: Schedule = {
	scheduleId: "schedule-1",
	name: "Review changes",
	cronPattern: "0 9 * * *",
	prompt: "Review changes",
	mode: "yolo",
	maxParallel: 1,
	enabled: true,
	createdAt: 1,
	updatedAt: 1,
};

describe("schedule list frequency", () => {
	it.each([
		["0 9 * * *", "Daily"],
		["0 9 * * MON,WED,FRI", "Weekly"],
		[ONE_TIME_SCHEDULE_CRON_PATTERN, "Once"],
		["*/15 * * * *", "Custom"],
	])("formats %s as %s", (cronPattern, expected) => {
		expect(formatScheduleFrequency({ ...schedule, cronPattern })).toBe(
			expected,
		);
	});

	it("omits the time and time zone from the frequency", () => {
		expect(
			formatScheduleFrequency({ ...schedule, timezone: "Asia/Tokyo" }),
		).toBe("Daily");
	});
});

describe("schedule list next run", () => {
	const now = new Date(2026, 5, 15, 8, 0);

	it("describes upcoming runs relative to today in local time", () => {
		const at = (day: number, hour: number, minute = 0) => ({
			enabled: true,
			nextRunAt: new Date(2026, 5, day, hour, minute).getTime(),
		});
		expect(formatScheduleNextRun(at(15, 9), now)).toBe("Today, 9:00 AM");
		expect(formatScheduleNextRun(at(16, 14, 30), now)).toBe(
			"Tomorrow, 2:30 PM",
		);
		expect(formatScheduleNextRun(at(20, 9), now)).toBe("Jun 20, 9:00 AM");
		expect(
			formatScheduleNextRun(
				{ enabled: true, nextRunAt: new Date(2027, 0, 2, 9).getTime() },
				now,
			),
		).toBe("Jan 2, 2027, 9:00 AM");
	});

	it("uses a placeholder for a paused schedule instead of a stale time", () => {
		expect(
			formatScheduleNextRun(
				{ enabled: false, nextRunAt: new Date(2026, 5, 16, 9).getTime() },
				now,
			),
		).toBe("—");
	});

	it.each([
		undefined,
		"",
		"invalid",
		Number.NaN,
	])("uses a placeholder when no run is planned (%s)", (nextRunAt) => {
		expect(formatScheduleNextRun({ enabled: true, nextRunAt }, now)).toBe("—");
	});
});

describe("schedule list last run", () => {
	it("uses local calendar dates across midnight and year boundaries", () => {
		const now = new Date(2026, 0, 1, 0, 5);
		expect(
			formatScheduleLastRun(new Date(2026, 0, 1, 0, 1).getTime(), now),
		).toBe("Today");
		expect(
			formatScheduleLastRun(new Date(2025, 11, 31, 0, 1).getTime(), now),
		).toBe("Yesterday");
		expect(
			formatScheduleLastRun(new Date(2025, 11, 30).getTime(), now),
		).toContain("2025");
	});

	it("handles the day before a daylight-saving transition using calendar arithmetic", () => {
		const now = new Date(2026, 2, 9, 0, 5);
		const yesterday = new Date(2026, 2, 8, 0, 1);
		expect(formatScheduleLastRun(yesterday.toISOString(), now)).toBe(
			"Yesterday",
		);
	});

	it.each([
		undefined,
		null,
		"",
		"invalid",
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("uses a placeholder for unavailable timestamp %s", (value) => {
		expect(formatScheduleLastRun(value)).toBe("—");
	});
});

function execution(
	overrides: Partial<ScheduleExecution> = {},
): ScheduleExecution {
	return {
		executionId: "run-1",
		scheduleId: schedule.scheduleId,
		status: "success",
		endedAt: 100,
		...overrides,
	};
}

describe("schedule list run summary", () => {
	it("deduplicates active and recent snapshots and does not claim a lifetime count", () => {
		const summary = summarizeScheduleRuns(schedule, [
			execution({ status: "running" }),
			execution(),
			execution({ executionId: "run-2", endedAt: 200 }),
			execution({ executionId: "other-run", scheduleId: "other-schedule" }),
		]);
		expect(summary.label).toBe("Completed");
		expect(summary.description).toContain("2 recent runs available");
		expect(summary.description).toContain("older runs may not be included");
		expect(summary.description).toContain("Last result: Completed");
	});

	it("distinguishes missing recent history from a never-run schedule", () => {
		expect(summarizeScheduleRuns(schedule, []).label).toBe("Not run yet");
		expect(summarizeScheduleRuns({ ...schedule, lastRunAt: 0 }, []).label).toBe(
			"—",
		);
	});

	it("surfaces a latest failure and its full error, including without a session", () => {
		const errorMessage = "Unauthorized\nRequest ID: example";
		const summary = summarizeScheduleRuns(schedule, [
			execution(),
			execution({
				executionId: "run-2",
				status: "failed",
				endedAt: 200,
				errorMessage,
			}),
		]);
		expect(summary.label).toBe("Failed");
		expect(summary.description).toContain(errorMessage);
	});

	it.each([
		["timeout", "Timed out"],
		["aborted", "Aborted"],
		["success", "Completed"],
		["skipped", "Skipped"],
		["", "Unknown result"],
	])("labels a latest %s run as %s, matching the run history", (status, expected) => {
		expect(summarizeScheduleRuns(schedule, [execution({ status })]).label).toBe(
			expected,
		);
	});

	it.each([
		["running", "Running"],
		["pending", "Pending"],
		["queued", "Pending"],
	])("shows %s when a run is still active", (status, expected) => {
		const summary = summarizeScheduleRuns(schedule, [
			execution({ executionId: "failed-run", status: "failed", endedAt: 200 }),
			execution({ status, startedAt: 100, endedAt: undefined }),
		]);
		expect(summary.label).toBe(expected);
	});
});
