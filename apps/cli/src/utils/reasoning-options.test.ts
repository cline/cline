import { describe, expect, it } from "vitest";
import {
	applyReasoningChoice,
	type CliReasoningSelection,
	getCurrentReasoningChoice,
	getReasoningChoices,
} from "./reasoning-options";

describe("model reasoning choices", () => {
	it("uses advertised efforts, including minimal and max, without inventing off", () => {
		expect(
			getReasoningChoices({
				reasoningOptions: [
					{
						type: "effort",
						values: [null, "default", "minimal", "high", "max"],
					},
				],
			}).map((option) => option.value),
		).toEqual(["default", "minimal", "high", "max"]);
	});

	it("offers on/off for toggle controls and effort presets for budget controls", () => {
		expect(
			getReasoningChoices({ reasoningOptions: [{ type: "toggle" }] }).map(
				(option) => option.value,
			),
		).toEqual(["default", "none", "enabled"]);
		expect(
			getReasoningChoices({
				reasoningOptions: [
					{ type: "toggle" },
					{ type: "budget_tokens", min: 1024, max: 32000 },
				],
			}).map((option) => option.value),
		).toEqual(["default", "none", "low", "medium", "high", "xhigh", "max"]);
	});

	it("offers manual choices for unknown models while respecting explicit no-control metadata", () => {
		expect(
			getReasoningChoices(undefined, { allowUnknown: true }).map(
				(option) => option.value,
			),
		).toEqual([
			"default",
			"none",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
		expect(
			getReasoningChoices(
				{ supportsReasoning: true, reasoningOptions: [] },
				{ allowUnknown: true },
			).map((option) => option.value),
		).toEqual(["default"]);
		expect(
			getReasoningChoices({ supportsReasoning: false }).map(
				(option) => option.value,
			),
		).toEqual(["default"]);
	});

	it("keeps provider default separate from off and clears a stale token budget", () => {
		const selection: CliReasoningSelection = {
			thinking: true,
			reasoningEffort: "high",
			thinkingBudgetTokens: 4096,
		};
		applyReasoningChoice(selection, "default");
		expect(selection).toEqual({
			thinking: undefined,
			reasoningEffort: undefined,
			thinkingBudgetTokens: undefined,
			reasoningDefault: true,
		});
		expect(getCurrentReasoningChoice(selection)).toBe("default");
		applyReasoningChoice(selection, "none");
		expect(getCurrentReasoningChoice(selection)).toBe("none");
		expect(selection.thinking).toBe(false);
		applyReasoningChoice(selection, "minimal");
		expect(getCurrentReasoningChoice(selection)).toBe("minimal");
		expect(selection.reasoningDefault).toBe(false);
	});
});
