import { describe, expect, it } from "vitest";
import { cloudTaskBranch } from "./task-branch";

describe("prescribed Cloud task branch", () => {
	it("uses the assigned task identity before the distinct outer workspace identity", () => {
		expect(cloudTaskBranch("task-ABC12345", "workspace-87654321")).toBe(
			"cline/abc12345",
		);
	});
	it("falls back to the actual outer workspace identity when the task has none", () => {
		expect(cloudTaskBranch(undefined, "workspace-87654321")).toBe(
			"cline/87654321",
		);
		expect(cloudTaskBranch("  ", " workspace-ABC12345 ")).toBe(
			"cline/abc12345",
		);
	});
	it("provides no branch without an actual task or outer identity", () => {
		expect(cloudTaskBranch()).toBeUndefined();
		expect(cloudTaskBranch(" ", " ")).toBeUndefined();
	});
});
