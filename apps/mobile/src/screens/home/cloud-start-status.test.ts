import { describe, expect, it } from "vitest";
import { cloudStartStatus } from "@/cloud/progress";

describe("cloudStartStatus", () => {
	it.each([
		[undefined, "Starting your workspace…"],
		["provisioning", "Starting your workspace…"],
		["resuming", "Resuming your workspace…"],
		["cloning_repo", "Cloning your repository…"],
		["agent_starting", "Starting the agent…"],
		["ready", "Opening your conversation…"],
		["new_internal_phase", "Starting your workspace…"],
	])("describes %s without exposing backend labels", (phase, expected) => {
		expect(cloudStartStatus(phase)).toBe(expected);
	});
	it("keeps resume wording when provisioning returns a generic or unknown phase", () => {
		for (const phase of [undefined, "provisioning", "unknown_phase"]) {
			expect(cloudStartStatus(phase, true)).toBe("Resuming your workspace…");
		}
	});
});
