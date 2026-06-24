import * as sdkCore from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ClineEnv } from "@/config"
import { refreshClineRecommendedModels, resetClineRecommendedModelsCacheForTests } from "../refreshClineRecommendedModels"

// The HTTP fetch + normalization + offline fallback lives in the SDK
// (`@cline/core` `fetchClineRecommendedModels`). These tests cover the
// extension-side wrapper: delegation to the SDK and in-memory caching. There is
// intentionally no feature-flag gate here; onboarding must not race against the
// remote-config cache and accidentally keep the hardcoded fallback list.

describe("refreshClineRecommendedModels", () => {
	beforeEach(() => {
		resetClineRecommendedModelsCacheForTests()
		// ClineEnv is not initialized in the unit-test environment; the wrapper
		// passes its apiBaseUrl to the SDK, so provide a stable stub.
		vi.spyOn(ClineEnv, "config").mockReturnValue({ apiBaseUrl: "https://api.cline-test.bot" } as ReturnType<
			typeof ClineEnv.config
		>)
	})

	afterEach(() => {
		resetClineRecommendedModelsCacheForTests()
		vi.restoreAllMocks()
	})

	it("delegates to the SDK fetch", async () => {
		const sdkResult = {
			recommended: [{ id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", description: "Remote", tags: ["NEW"] }],
			free: [{ id: "z-ai/glm-5", name: "GLM 5", description: "Remote free", tags: [] }],
		}
		const sdkSpy = vi.spyOn(sdkCore, "fetchClineRecommendedModels").mockResolvedValue(sdkResult)

		const result = await refreshClineRecommendedModels()

		expect(sdkSpy).toHaveBeenCalledTimes(1)
		expect(result).toEqual(sdkResult)
	})

	it("uses the in-memory cache after a populated upstream result", async () => {
		const sdkResult = {
			recommended: [{ id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", description: "Remote", tags: ["NEW"] }],
			free: [],
		}
		const sdkSpy = vi.spyOn(sdkCore, "fetchClineRecommendedModels").mockResolvedValue(sdkResult)

		const firstResult = await refreshClineRecommendedModels()
		const secondResult = await refreshClineRecommendedModels()

		expect(sdkSpy).toHaveBeenCalledTimes(1)
		expect(secondResult).toEqual(firstResult)
	})

	it("does not cache the SDK fallback result", async () => {
		const sdkFallbackClone = structuredClone(sdkCore.FALLBACK_CLINE_RECOMMENDED_MODELS)
		const sdkSpy = vi
			.spyOn(sdkCore, "fetchClineRecommendedModels")
			.mockResolvedValueOnce(sdkFallbackClone)
			.mockResolvedValueOnce({
				recommended: [
					{ id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", description: "Remote", tags: ["NEW"] },
				],
				free: [],
			})

		const firstResult = await refreshClineRecommendedModels()
		const secondResult = await refreshClineRecommendedModels()

		expect(sdkSpy).toHaveBeenCalledTimes(2)
		expect(firstResult).toEqual(sdkCore.FALLBACK_CLINE_RECOMMENDED_MODELS)
		expect(secondResult).not.toEqual(sdkCore.FALLBACK_CLINE_RECOMMENDED_MODELS)
	})
})
