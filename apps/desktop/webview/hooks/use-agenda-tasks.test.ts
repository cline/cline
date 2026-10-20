import type { AgendaTaskRecord } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { isAgendaTaskExpired, sortAgendaTasks } from "./use-agenda-tasks";

describe("Agenda task presentation", () => {
	it("groups actionable status before ordering by priority", () => {
		const tasks = [
			task({ taskId: "approved-p0", status: "approved", priority: 0 }),
			task({ taskId: "pending-p3", status: "pending_approval", priority: 3 }),
			task({ taskId: "running-p5", status: "in_progress", priority: 5 }),
			task({ taskId: "pending-p1", status: "pending_approval", priority: 1 }),
		];

		expect(sortAgendaTasks(tasks).map((item) => item.taskId)).toEqual([
			"running-p5",
			"pending-p1",
			"pending-p3",
			"approved-p0",
		]);
	});

	it("treats both an expired status and a past deadline as expired", () => {
		const now = Date.parse("2026-08-13T12:00:00.000Z");
		expect(
			isAgendaTaskExpired(
				task({ status: "expired", expiresAt: "2099-01-01T00:00:00.000Z" }),
				now,
			),
		).toBe(true);
		expect(
			isAgendaTaskExpired(task({ expiresAt: "2026-08-13T11:59:59.000Z" }), now),
		).toBe(true);
		expect(
			isAgendaTaskExpired(task({ expiresAt: "2026-08-13T12:00:01.000Z" }), now),
		).toBe(false);
	});
});

function task(overrides: Partial<AgendaTaskRecord> = {}): AgendaTaskRecord {
	return {
		taskId: "task-1",
		type: "todo",
		status: "pending_approval",
		title: "Task",
		instructions: "Do the task.",
		scope: "global",
		resourcePaths: [],
		priority: 3,
		availableAt: "2026-08-13T00:00:00.000Z",
		expiresAt: "2099-08-20T00:00:00.000Z",
		automationEligible: true,
		revision: 1,
		createdBy: { kind: "user" },
		updatedBy: { kind: "user" },
		createdAt: "2026-08-13T00:00:00.000Z",
		updatedAt: "2026-08-13T00:00:00.000Z",
		...overrides,
	};
}
