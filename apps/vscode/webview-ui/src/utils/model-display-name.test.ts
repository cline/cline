import { describe, expect, it } from "vitest"
import { resolveProviderModelDisplayName } from "./model-display-name"

describe("resolveProviderModelDisplayName", () => {
	it("prefers the catalog name and removes redundant free markers", () => {
		expect(
			resolveProviderModelDisplayName(
				"deepseek/deepseek-v4-flash",
				{
					"deepseek/deepseek-v4-flash": {
						name: "DeepSeek V4 Flash (free)",
						supportsPromptCache: true,
					},
				},
				"deepseek-v4-flash",
			),
		).toBe("DeepSeek V4 Flash")
	})

	it("falls back from endpoint names to the model id tail", () => {
		expect(resolveProviderModelDisplayName("zai/glm-5.2", undefined, "GLM 5.2")).toBe("GLM 5.2")
		expect(resolveProviderModelDisplayName("cline-pass/glm-5.2", undefined, "cline-pass/glm-5.2")).toBe("glm-5.2")
		expect(resolveProviderModelDisplayName("poolside/laguna-s-2.1:free")).toBe("laguna-s-2.1")
	})
})
