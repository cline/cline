import { describe, expect, it } from "vitest";
import {
	applyInteractiveAutoApproveOverride,
	cloneToolPolicies,
} from "./tool-policies";

describe("tool policy helpers", () => {
	it("keeps safe tools auto-approved when toggled off", () => {
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
			ask_followup_question: { autoApprove: true },
			ask_question: { autoApprove: true },
			fetch_web_content: { autoApprove: true },
			run_commands: { autoApprove: false, enabled: true },
			read_files: { autoApprove: true, enabled: true },
			search_codebase: { autoApprove: true },
			skills: { autoApprove: true },
			submit_and_exit: { autoApprove: true },
		});
	});

	it("keeps explicit per-tool approval requirements when toggled off", () => {
		const baseline = {
			"*": { autoApprove: true },
			ask_question: { autoApprove: false, enabled: true },
			editor: { autoApprove: true, enabled: true },
		};
		const target = cloneToolPolicies(baseline);

		applyInteractiveAutoApproveOverride({
			targetPolicies: target,
			baselinePolicies: baseline,
			enabled: false,
		});

		expect(target).toMatchObject({
			"*": { autoApprove: false },
			ask_question: { autoApprove: false, enabled: true },
			editor: { autoApprove: false, enabled: true },
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
