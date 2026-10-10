import { describe, expect, it } from "vitest";
import { describePendingExecution } from "./routine-execution-status";

const NOW = Date.parse("2026-10-09T15:05:00.000Z");

describe("describePendingExecution", () => {
	it("only describes pending runs", () => {
		expect(
			describePendingExecution(
				{ executionId: "a", status: "failed", triggeredAt: NOW - 86_400_000 },
				[],
				NOW,
			),
		).toBeUndefined();
	});

	it("points at the schedule's in-progress run when one is blocking", () => {
		const pending = {
			executionId: "a",
			status: "pending",
			triggeredAt: NOW - 86_400_000,
		};
		expect(
			describePendingExecution(
				pending,
				[pending, { executionId: "b", status: "running" }],
				NOW,
			),
		).toBe("Waiting for this schedule's current run to finish.");
	});

	it("treats recently due or future runs as normally queued", () => {
		expect(
			describePendingExecution(
				{ executionId: "a", status: "pending", triggeredAt: NOW - 30_000 },
				[],
				NOW,
			),
		).toBe("Queued; the scheduler starts it at the scheduled time.");
		expect(
			describePendingExecution(
				{
					executionId: "a",
					status: "pending",
					triggeredAt: new Date(NOW + 3_600_000).toISOString(),
				},
				[],
				NOW,
			),
		).toBe("Queued; the scheduler starts it at the scheduled time.");
	});

	it("reports how overdue an unclaimed run is", () => {
		expect(
			describePendingExecution(
				{ executionId: "a", status: "pending", triggeredAt: NOW - 5 * 60_000 },
				[],
				NOW,
			),
		).toMatch(/^Overdue by 5 min;/);
		expect(
			describePendingExecution(
				{
					executionId: "a",
					status: "pending",
					triggeredAt: NOW - 3 * 3_600_000,
				},
				[],
				NOW,
			),
		).toMatch(/^Overdue by 3 h;/);
		expect(
			describePendingExecution(
				{
					executionId: "a",
					status: "pending",
					triggeredAt: NOW - 2 * 86_400_000,
				},
				[],
				NOW,
			),
		).toMatch(/^Overdue by 2 days;/);
	});
});
