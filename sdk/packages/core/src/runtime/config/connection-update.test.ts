import { describe, expect, it } from "vitest";
import { buildConnectionUpdate } from "./connection-update";

describe("buildConnectionUpdate", () => {
	const base = {
		modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
		providerConfig: {
			providerId: "bedrock" as const,
			modelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
			connection: { region: "us-east-1" },
		},
	};

	it("includes only the Bedrock connection fields that are defined", () => {
		expect(buildConnectionUpdate(base)).toEqual(base);
	});

	it("clears reasoning when thinking is explicitly false", () => {
		expect(
			buildConnectionUpdate({
				...base,
				thinking: false,
				reasoningEffort: "high",
				thinkingBudgetTokens: 1024,
			}),
		).toEqual({
			...base,
			thinking: false,
			reasoningEffort: null,
			thinkingBudgetTokens: null,
		});
	});

	it("enables reasoning with the selected effort", () => {
		expect(
			buildConnectionUpdate({
				...base,
				thinking: true,
				reasoningEffort: "low",
			}),
		).toEqual({
			...base,
			thinking: true,
			reasoningEffort: "low",
			thinkingBudgetTokens: null,
		});
	});

	it("enables thinking and truncates a fractional budget", () => {
		expect(
			buildConnectionUpdate({ ...base, thinkingBudgetTokens: 2048.7 }),
		).toEqual({ ...base, thinking: true, thinkingBudgetTokens: 2048 });
	});

	it("leaves reasoning untouched when thinking is unset", () => {
		expect(buildConnectionUpdate(base)).toEqual(base);
	});
});
