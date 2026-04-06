import { describe, expect, it } from "vitest";
import type { ModelInfo } from "../../models/types";
import {
	getModelPricing,
	hasModelCapability,
	supportsModelThinking,
} from "./model-info";

function createModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
	return {
		id: "test-model",
		...overrides,
	};
}

describe("model-info helpers", () => {
	it("checks capabilities safely when capabilities are absent", () => {
		const info = createModel();

		expect(hasModelCapability(info, "reasoning")).toBe(false);
	});

	it("detects capability membership when present", () => {
		const info = createModel({
			capabilities: ["tools", "reasoning"],
		});

		expect(hasModelCapability(info, "reasoning")).toBe(true);
		expect(hasModelCapability(info, "images")).toBe(false);
	});

	it("detects thinking support from either thinkingConfig or reasoning capability", () => {
		const byCapability = createModel({
			capabilities: ["reasoning"],
		});
		const byConfig = createModel({
			thinkingConfig: { maxBudget: 1024 },
		});
		const unsupported = createModel({
			capabilities: ["tools"],
		});

		expect(supportsModelThinking(byCapability)).toBe(true);
		expect(supportsModelThinking(byConfig)).toBe(true);
		expect(supportsModelThinking(unsupported)).toBe(false);
	});

	it("returns pricing if set, otherwise empty pricing object", () => {
		const priced = createModel({
			pricing: { input: 1.2, output: 2.4 },
		});
		const unpriced = createModel();

		expect(getModelPricing(priced)).toEqual({ input: 1.2, output: 2.4 });
		expect(getModelPricing(unpriced)).toEqual({});
	});
});
