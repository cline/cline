import * as sdkCore from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ClineEnv } from "@/config"
import { getFeatureFlagsService } from "@/services/feature-flags"
import { CLINE_RECOMMENDED_MODELS_FALLBACK } from "@/shared/cline/recommended-models"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import { refreshClineRecommendedModels, resetClineRecommendedModelsCacheForTests } from "../refreshClineRecommendedModels"

// The HTTP fetch + normalization + offline fallback now lives in the SDK
// (`@cline/core` `fetchClineRecommendedModels`). These tests cover the
// extension-side wrapper: the feature-flag gate, delegation to the SDK, and the
// in-memory cache / flag re-check. This suite is vitest-native (not mocha)
// because it imports the ESM-only `@cline/core`; vitest aliases it to
// src/test/cline-core-vitest-stub.ts, which we spy on here.

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

	it("returns the hardcoded fallback list and skips the SDK fetch when the rollout flag is off", async () => {
		vi.spyOn(getFeatureFlagsService(), "getBooleanFlagEnabled").mockReturnValue(false)
		const sdkSpy = vi.spyOn(sdkCore, "fetchClineRecommendedModels")

		const result = await refreshClineRecommendedModels()

		expect(result).toEqual(CLINE_RECOMMENDED_MODELS_FALLBACK)
		expect(sdkSpy).not.toHaveBeenCalled()
	})

	it("delegates to the SDK fetch when the rollout flag is on", async () => {
		vi.spyOn(getFeatureFlagsService(), "getBooleanFlagEnabled").mockImplementation(
			(flag) => flag === FeatureFlag.CLINE_RECOMMENDED_MODELS_UPSTREAM,
		)
		const sdkResult = {
			recommended: [{ id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6", description: "Remote", tags: ["NEW"] }],
			free: [{ id: "z-ai/glm-5", name: "GLM 5", description: "Remote free", tags: [] }],
		}
		const sdkSpy = vi.spyOn(sdkCore, "fetchClineRecommendedModels").mockResolvedValue(sdkResult)

		const result = await refreshClineRecommendedModels()

		expect(sdkSpy).toHaveBeenCalledTimes(1)
		expect(result).toEqual(sdkResult)
	})

	it("re-checks the rollout flag on each call (off after on returns the fallback)", async () => {
		const flagSpy = vi.spyOn(getFeatureFlagsService(), "getBooleanFlagEnabled")
		flagSpy.mockReturnValueOnce(true).mockReturnValueOnce(false)
		vi.spyOn(sdkCore, "fetchClineRecommendedModels").mockResolvedValue({
			recommended: [{ id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", description: "Remote", tags: ["NEW"] }],
			free: [],
		})

		const firstResult = await refreshClineRecommendedModels()
		const secondResult = await refreshClineRecommendedModels()

		expect(firstResult).not.toEqual(CLINE_RECOMMENDED_MODELS_FALLBACK)
		expect(secondResult).toEqual(CLINE_RECOMMENDED_MODELS_FALLBACK)
	})
})
