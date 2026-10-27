import { describe, expect, it } from "vitest";
import { isAdaptiveThinkingRequest } from "./model-facts";

describe("isAdaptiveThinkingRequest", () => {
	it("is true for adaptive-era Claude ids with thinking requested", () => {
		for (const modelId of [
			"anthropic/claude-opus-5.5",
			"anthropic/claude-sonnet-5.5",
			"claude-opus-4-6",
			"claude-opus-9-preview",
		]) {
			expect(
				isAdaptiveThinkingRequest({ modelId, reasoning: { effort: "high" } }),
			).toBe(true);
			expect(
				isAdaptiveThinkingRequest({ modelId, reasoning: { enabled: true } }),
			).toBe(true);
		}
	});

	it("is false when thinking is off or not requested", () => {
		const modelId = "anthropic/claude-opus-5.5";
		expect(isAdaptiveThinkingRequest({ modelId })).toBe(false);
		expect(isAdaptiveThinkingRequest({ modelId, reasoning: {} })).toBe(false);
		expect(
			isAdaptiveThinkingRequest({ modelId, reasoning: { enabled: false } }),
		).toBe(false);
	});

	it("is false for legacy Claude and non-Claude models", () => {
		for (const modelId of [
			"anthropic/claude-3.7-sonnet",
			"claude-sonnet-4-5",
			"openai/gpt-6.1-sol",
			"moonshotai/kimi-k3",
		]) {
			expect(
				isAdaptiveThinkingRequest({ modelId, reasoning: { effort: "high" } }),
			).toBe(false);
		}
	});
});
