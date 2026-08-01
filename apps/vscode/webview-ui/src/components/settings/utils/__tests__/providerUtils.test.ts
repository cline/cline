import type { ApiConfiguration } from "@shared/api"
import { describe, expect, it } from "vitest"
import { getModeSpecificFields, resolveProviderModelDisplayName } from "../providerUtils"

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

describe("getModeSpecificFields", () => {
	it("returns undefined provider-specific fields when apiConfiguration is undefined", () => {
		const fields = getModeSpecificFields(undefined, "plan")
		expect(fields.apiProvider).toBeUndefined()
		expect(fields.openRouterModelId).toBeUndefined()
		expect(fields.clineModelId).toBeUndefined()
	})

	it("isolates each provider's saved fields so cross-provider state does not leak", () => {
		// Reproduces the original cline/openrouter conflation guard: even when
		// the user has stale OpenRouter selection state and is now configured
		// for Cline, Cline-specific fields stay undefined until the user
		// commits a Cline selection.
		const apiConfiguration: ApiConfiguration = {
			planModeApiProvider: "cline",
			planModeOpenRouterModelId: "openrouter/some-model",
			planModeOpenRouterModelInfo: { description: "stale OpenRouter model" },
		} as ApiConfiguration

		const fields = getModeSpecificFields(apiConfiguration, "plan")

		expect(fields.apiProvider).toBe("cline")
		expect(fields.openRouterModelId).toBe("openrouter/some-model")
		expect(fields.clineModelId).toBeUndefined()
		expect(fields.clineModelInfo).toBeUndefined()
	})
})
