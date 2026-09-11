import { describe, expect, it } from "vitest";
import {
	resolveEffectiveReasoningEffort,
	resolveReasoningBudgetFromRatio,
} from "./reasoning-effort";

describe("reasoning effort", () => {
	it("recognizes maximum effort", () => {
		expect(resolveEffectiveReasoningEffort("MAX", true)).toBe("max");
	});

	it("maps maximum effort to the full available budget", () => {
		expect(
			resolveReasoningBudgetFromRatio({ effort: "max", maxBudget: 32_000 }),
		).toBe(32_000);
	});
});
