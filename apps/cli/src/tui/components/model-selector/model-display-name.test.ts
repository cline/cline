import { describe, expect, it } from "vitest";
import { resolveModelDisplayName } from "./model-display-name";

describe("resolveModelDisplayName", () => {
	it("resolves display names by exact model id", () => {
		expect(
			resolveModelDisplayName("claude-sonnet", {
				"claude-sonnet": { name: "Claude Sonnet" },
			}),
		).toBe("Claude Sonnet");
	});

	it("resolves display names by model slug when provider prefixes differ", () => {
		expect(
			resolveModelDisplayName("zai/glm-5.2", {
				"z-ai/glm-5.2": { id: "z-ai/glm-5.2", name: "GLM-5.2" },
			}),
		).toBe("GLM-5.2");
	});

	it("prefers exact model id matches over slug matches", () => {
		expect(
			resolveModelDisplayName("zai/glm-5.2", {
				"z-ai/glm-5.2": { id: "z-ai/glm-5.2", name: "OpenRouter GLM" },
				"zai/glm-5.2": { id: "zai/glm-5.2", name: "Vercel GLM" },
			}),
		).toBe("Vercel GLM");
	});

	it("uses the fallback name when no catalog entry matches", () => {
		expect(resolveModelDisplayName("zai/glm-5.2", {}, "GLM 5.2")).toBe(
			"GLM 5.2",
		);
	});

	it("falls back to the model slug without known models", () => {
		expect(resolveModelDisplayName("zai/glm-5.2")).toBe("glm-5.2");
	});
});
