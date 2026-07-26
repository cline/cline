import { describe, expect, it } from "vitest";
import type { DriveEvent } from "@cline/shared";
import { narrate } from "./narrationPolicy";

const base = {
	schemaVersion: 1 as const,
	id: "evt_1",
	roomId: "room_1",
	at: "2026-07-25T12:00:00.000Z",
};

describe("narrate", () => {
	it("emits at decision points by default density", () => {
		const plan: DriveEvent = {
			...base,
			type: "work.plan_step",
			track: "work",
			title: "Add schemas",
			status: "in_progress",
		};
		expect(narrate(plan, "decision-points")?.text).toContain("Add schemas");

		const edit: DriveEvent = {
			...base,
			type: "work.edit",
			track: "work",
			path: "a.ts",
		};
		expect(narrate(edit, "decision-points")).toBeNull();
	});

	it("emits routine tool events at every-tool density", () => {
		const edit: DriveEvent = {
			...base,
			type: "work.edit",
			track: "work",
			path: "a.ts",
		};
		expect(narrate(edit, "every-tool")?.relatedWorkEventId).toBe("evt_1");
	});

	it("treats failed tests as decision points", () => {
		const failed: DriveEvent = {
			...base,
			type: "work.test_result",
			track: "work",
			label: "unit",
			passed: false,
		};
		const passed: DriveEvent = { ...failed, passed: true, id: "evt_2" };
		expect(narrate(failed, "decision-points")).not.toBeNull();
		expect(narrate(passed, "decision-points")).toBeNull();
	});

	it("stays silent for conversation events", () => {
		const message: DriveEvent = {
			...base,
			type: "conversation.message",
			track: "conversation",
			text: "hi",
		};
		expect(narrate(message, "every-tool")).toBeNull();
	});
});
