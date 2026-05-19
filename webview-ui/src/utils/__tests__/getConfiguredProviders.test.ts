import { describe, expect, it } from "vitest"
import { getConfiguredProviders } from "../getConfiguredProviders"

describe("getConfiguredProviders", () => {
	it("returns Poolside without also marking OpenAI Compatible as configured", () => {
		const configuredProviders = getConfiguredProviders(undefined, {
			planModeApiProvider: "poolside",
			actModeApiProvider: "poolside",
			openAiBaseUrl: "https://inference.poolside.ai/v1",
			openAiApiKey: "test-key",
		})

		expect(configuredProviders).toContain("poolside")
		expect(configuredProviders).not.toContain("openai")
	})

	it("still returns OpenAI Compatible for non-Poolside OpenAI-compatible settings", () => {
		const configuredProviders = getConfiguredProviders(undefined, {
			planModeApiProvider: "openai",
			actModeApiProvider: "openai",
			openAiBaseUrl: "http://localhost:1234/v1",
			openAiApiKey: "test-key",
		})

		expect(configuredProviders).toContain("openai")
		expect(configuredProviders).not.toContain("poolside")
	})
})
