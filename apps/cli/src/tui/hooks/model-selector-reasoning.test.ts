import { describe, expect, it } from "vitest";
import { resolveDefaultThinkingLevel } from "./model-selector-reasoning";

describe("resolveDefaultThinkingLevel", () => {
	it("uses the active reasoning effort", () => {
		expect(
			resolveDefaultThinkingLevel(
				{
					modelId: "model-a",
					thinking: true,
					reasoningEffort: "high",
				},
				"model-a",
			),
		).toBe("high");
	});

	it("preserves off when re-selecting the current model", () => {
		expect(
			resolveDefaultThinkingLevel(
				{
					modelId: "model-a",
					thinking: false,
					reasoningEffort: undefined,
				},
				"model-a",
			),
		).toBe("none");
	});

	it("defaults new reasoning-capable selections to medium", () => {
		expect(
			resolveDefaultThinkingLevel(
				{
					modelId: "model-a",
					thinking: false,
					reasoningEffort: undefined,
				},
				"model-b",
			),
		).toBe("medium");
	});
});
