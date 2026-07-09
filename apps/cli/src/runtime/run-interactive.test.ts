import { describe, expect, it } from "vitest";
import { resolveReasoningForModelChange } from "./run-interactive";

describe("resolveReasoningForModelChange", () => {
	it("persists disabled reasoning only when thinking is explicitly false", () => {
		expect(
			resolveReasoningForModelChange(
				{ thinking: false, reasoningEffort: undefined },
				{ reasoning: { enabled: true, effort: "high" } },
			),
		).toEqual({ enabled: false });
	});

	it("persists enabled reasoning with the selected effort", () => {
		expect(
			resolveReasoningForModelChange(
				{ thinking: true, reasoningEffort: "low" },
				{ reasoning: { enabled: false } },
			),
		).toEqual({ enabled: true, effort: "low" });
	});

	it("persists enabled reasoning when thinking is explicitly true without effort", () => {
		expect(
			resolveReasoningForModelChange(
				{ thinking: true, reasoningEffort: undefined },
				{ reasoning: { enabled: false } },
			),
		).toEqual({ enabled: true });
	});

	it("preserves existing reasoning when thinking is unset", () => {
		expect(
			resolveReasoningForModelChange(
				{ thinking: undefined, reasoningEffort: undefined },
				{ reasoning: { enabled: true, effort: "medium" } },
			),
		).toEqual({ enabled: true, effort: "medium" });
	});
});
