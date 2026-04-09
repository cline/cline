import { describe, expect, it } from "vitest";
import {
	applyInteractiveAutoApproveOverride,
	cloneToolPolicies,
} from "./tool-policies";

describe("tool policy helpers", () => {
	it("disables auto-approval for every live tool policy when toggled off", () => {
		const baseline = {
			"*": { autoApprove: true },
			run_commands: { autoApprove: true, enabled: true },
			read_files: { enabled: true },
		};
		const target = cloneToolPolicies(baseline);

		applyInteractiveAutoApproveOverride({
			targetPolicies: target,
			baselinePolicies: baseline,
			enabled: false,
		});

		expect(target).toEqual({
			"*": { autoApprove: false },
			run_commands: { autoApprove: false, enabled: true },
			read_files: { autoApprove: false, enabled: true },
		});
	});

	it("restores the baseline policies when toggled back on", () => {
		const baseline = {
			"*": { autoApprove: true },
			run_commands: { autoApprove: true, enabled: true },
			editor: { autoApprove: false, enabled: true },
		};
		const target = cloneToolPolicies(baseline);

		applyInteractiveAutoApproveOverride({
			targetPolicies: target,
			baselinePolicies: baseline,
			enabled: false,
		});
		applyInteractiveAutoApproveOverride({
			targetPolicies: target,
			baselinePolicies: baseline,
			enabled: true,
		});

		expect(target).toEqual(baseline);
	});
});
