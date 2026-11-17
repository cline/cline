import { describe, expect, it } from "vitest";
import {
	getScheduleExecutions,
	hasExecutionError,
} from "./schedule-executions";
import type { ScheduleExecution } from "./schedule-types";

const execution: ScheduleExecution = {
	executionId: "run-1",
	scheduleId: "schedule-1",
	triggeredAt: 1,
};

describe("schedule execution errors", () => {
	it.each([
		"failed",
		"timeout",
		"aborted",
		" FAILED ",
	])("recognizes %s even when no error message is available", (status) => {
		expect(hasExecutionError({ ...execution, status })).toBe(true);
	});

	it("recognizes explicit errors without a failed status, but ignores blank messages", () => {
		expect(
			hasExecutionError({ ...execution, errorMessage: "Unable to start" }),
		).toBe(true);
		for (const status of [
			undefined,
			"pending",
			"running",
			"success",
			"completed",
		])
			expect(
				hasExecutionError({ ...execution, status, errorMessage: " \n " }),
			).toBe(false);
	});

	it("uses the newest matching snapshot so stale or unrelated errors do not mark history", () => {
		const runs = getScheduleExecutions("schedule-1", [
			{ ...execution, status: "failed", endedAt: 2 },
			{ ...execution, status: "success", endedAt: 3 },
			{
				...execution,
				executionId: "other-run",
				scheduleId: "other-schedule",
				status: "failed",
				endedAt: 4,
			},
		]);
		expect(runs).toHaveLength(1);
		expect(runs.some(hasExecutionError)).toBe(false);
	});
});
