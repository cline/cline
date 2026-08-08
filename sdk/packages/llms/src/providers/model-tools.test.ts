import { describe, expect, it } from "vitest";
import { supportsModelTool } from "./model-tools";

describe("supportsModelTool", () => {
	it.each([
		"cline",
		"cline-pass",
		"anthropic",
		"openai",
		"gemini",
		"vertex",
	])("supports native web search for %s", (providerId) => {
		expect(supportsModelTool({ providerId }, "web_search")).toBe(true);
	});

	it("does not claim support for generic compatible providers", () => {
		expect(
			supportsModelTool(
				{ providerId: "openai-compatible", modelId: "custom" },
				"web_search",
			),
		).toBe(false);
	});

	it("excludes Claude routes from Vertex until that adapter exposes tools", () => {
		expect(
			supportsModelTool(
				{ providerId: "vertex", modelId: "claude-sonnet-4-6" },
				"web_search",
			),
		).toBe(false);
	});
});
