import { describe, expect, it } from "vitest";
import {
	createDriveTaskBoundEvent,
	createDrivePlanStepEvent,
	resetDriveEventSeqForTests,
} from "@cline/drive";

describe("drive bank events", () => {
	it("emits task-bound plan step events", () => {
		resetDriveEventSeqForTests();
		const bound = createDriveTaskBoundEvent({
			roomId: "room-1",
			taskId: "t1",
			planId: "p1",
		});
		expect(bound.type).toBe("drive_task_bound");
		const step = createDrivePlanStepEvent({
			roomId: "room-1",
			planId: "p1",
			taskId: "t1",
			title: "Fix parser",
			position: 0,
		});
		expect(step.type).toBe("drive_plan_step");
		if (step.type === "drive_plan_step") {
			expect(step.taskId).toBe("t1");
		}
	});
});
