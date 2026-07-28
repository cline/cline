import { describe, expect, it } from "vitest";
import { moveTask, removeTask } from "./planEditorLogic";

describe("PlanEditor helpers", () => {
	it("reorders tasks", () => {
		expect(moveTask(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
		expect(moveTask(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
		expect(moveTask(["a", "b"], "a", "up")).toEqual(["a", "b"]);
	});

	it("removes a task ref", () => {
		expect(removeTask(["a", "b", "c"], "b")).toEqual(["a", "c"]);
	});
});
