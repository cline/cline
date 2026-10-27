import { describe, expect, it } from "vitest";
import { modelDisplayName } from "./model-display";

describe("model display names", () => {
	it("honors human catalog names without changing model identity", () => {
		expect(modelDisplayName("opaque-route-123", "Acme Private Model")).toBe(
			"Acme Private Model",
		);
		expect(
			modelDisplayName(
				"anthropic/claude-sonnet-4-6",
				"Anthropic: Claude Sonnet 4.6",
			),
		).toBe("Anthropic: Claude Sonnet 4.6");
	});
	it("turns raw catalog slugs into readable family names", () => {
		expect(modelDisplayName("anthropic/claude-sonnet-4-6")).toBe(
			"Claude Sonnet 4.6",
		);
		expect(
			modelDisplayName("cline-cloud/deepseek-v4-flash", "deepseek-v4-flash"),
		).toBe("DeepSeek V4 Flash");
		expect(modelDisplayName("z-ai/glm-5.2")).toBe("GLM 5.2");
	});
	it("keeps rollout dates and hosts out of the primary label without guessing unknown model versions", () => {
		expect(
			modelDisplayName("cline-new27-20261022-sonnet55-vertex-global-r1"),
		).toBe("Claude Sonnet 5.5");
		expect(modelDisplayName("cline-new27-20261022-gpt61sol-azure-r1")).toBe(
			"GPT-6.1 Sol",
		);
		expect(modelDisplayName("cline-mistral-k5-20261023-large4-zdr-r1")).toBe(
			"Custom model",
		);
		expect(modelDisplayName("cline-route-abc123")).toBe("Custom model");
	});
	it("distinguishes no selection from the explicit default model", () => {
		expect(modelDisplayName()).toBe("Choose model");
		expect(modelDisplayName("cline/default")).toBe("Cline default");
	});
});
