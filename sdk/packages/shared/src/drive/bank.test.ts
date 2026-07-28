import { describe, expect, it } from "vitest";
import {
	parseBankSnapshot,
	parseDrivePlan,
	parseDriveTask,
} from "./bank";

describe("DriveTaskSchema", () => {
	it("parses a valid task", () => {
		const task = parseDriveTask({
			id: "t1",
			title: "Fix parser",
			body: "Acceptance: green tests",
			status: "open",
		});
		expect(task.id).toBe("t1");
		expect(task.status).toBe("open");
	});

	it("rejects unknown fields", () => {
		expect(() =>
			parseDriveTask({
				id: "t1",
				title: "x",
				body: "",
				status: "open",
				extra: true,
			}),
		).toThrow();
	});

	it("rejects invalid status", () => {
		expect(() =>
			parseDriveTask({
				id: "t1",
				title: "x",
				body: "",
				status: "pending",
			}),
		).toThrow();
	});
});

describe("DrivePlanSchema", () => {
	it("parses a refs-only plan", () => {
		const plan = parseDrivePlan({
			id: "p1",
			title: "Ship bank",
			taskIds: ["t1", "t2"],
			status: "active",
		});
		expect(plan.taskIds).toEqual(["t1", "t2"]);
	});

	it("rejects missing taskIds", () => {
		expect(() =>
			parseDrivePlan({
				id: "p1",
				title: "Ship bank",
				status: "active",
			}),
		).toThrow();
	});
});

describe("BankSnapshotSchema", () => {
	it("parses a cursor snapshot", () => {
		const snap = parseBankSnapshot({
			activePlanId: "p1",
			openTaskIds: ["t1", "t2"],
			nowTaskId: "t1",
			nextTaskId: "t2",
			nowTitle: "One",
			nextTitle: "Two",
		});
		expect(snap.nowTaskId).toBe("t1");
	});
});
