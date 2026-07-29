import { describe, expect, it } from "vitest";
import { readSessionConnectionUpdate } from "./session-handlers";

describe("readSessionConnectionUpdate", () => {
	it("enables thinking when a positive budget is supplied without thinking", () => {
		expect(readSessionConnectionUpdate({ thinkingBudgetTokens: 2048 })).toEqual(
			{
				thinking: true,
				thinkingBudgetTokens: 2048,
			},
		);
	});

	it("lets explicit thinking disable override reasoning fields", () => {
		const updates = readSessionConnectionUpdate({
			thinking: false,
			reasoningEffort: "high",
			thinkingBudgetTokens: 2048,
		});

		expect(updates.thinking).toBe(false);
		expect(Object.hasOwn(updates, "reasoningEffort")).toBe(true);
		expect(updates.reasoningEffort).toBeUndefined();
		expect(Object.hasOwn(updates, "thinkingBudgetTokens")).toBe(true);
		expect(updates.thinkingBudgetTokens).toBeUndefined();
	});
});
