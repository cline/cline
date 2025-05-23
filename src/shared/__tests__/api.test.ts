// npx jest src/shared/__tests__/api.test.ts

import {
	type ModelInfo,
	ProviderSettings,
	getModelMaxOutputTokens,
	shouldUseReasoningBudget,
	shouldUseReasoningEffort,
} from "../api"

describe("getMaxTokensForModel", () => {
	/**
	 * Testing the specific fix in commit cc79178f:
	 * For thinking models, use apiConfig.modelMaxTokens if available,
	 * otherwise fall back to 8192 (not modelInfo.maxTokens)
	 */

	it("should return apiConfig.modelMaxTokens for thinking models when provided", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			requiredReasoningBudget: true,
			maxTokens: 8000,
		}

		const settings: ProviderSettings = {
			modelMaxTokens: 4000,
		}

		expect(getModelMaxOutputTokens({ model, settings })).toBe(4000)
	})

	it("should return 16_384 for thinking models when modelMaxTokens not provided", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			requiredReasoningBudget: true,
			maxTokens: 8000,
		}

		const settings = {}

		expect(getModelMaxOutputTokens({ model, settings })).toBe(16_384)
	})

	it("should return 16_384 for thinking models when apiConfig is undefined", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			requiredReasoningBudget: true,
			maxTokens: 8000,
		}

		expect(getModelMaxOutputTokens({ model, settings: undefined })).toBe(16_384)
	})

	it("should return modelInfo.maxTokens for non-thinking models", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			maxTokens: 8000,
		}

		const settings: ProviderSettings = {
			modelMaxTokens: 4000,
		}

		expect(getModelMaxOutputTokens({ model, settings })).toBe(8000)
	})

	it("should return undefined for non-thinking models with undefined maxTokens", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
		}

		const settings: ProviderSettings = {
			modelMaxTokens: 4000,
		}

		expect(getModelMaxOutputTokens({ model, settings })).toBeUndefined()
	})

	test("should return maxTokens from modelInfo when thinking is false", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			maxTokens: 2048,
		}

		const settings: ProviderSettings = {
			modelMaxTokens: 4096,
		}

		const result = getModelMaxOutputTokens({ model, settings })
		expect(result).toBe(2048)
	})

	test("should return modelMaxTokens from apiConfig when thinking is true", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			maxTokens: 2048,
			requiredReasoningBudget: true,
		}

		const settings: ProviderSettings = {
			modelMaxTokens: 4096,
		}

		const result = getModelMaxOutputTokens({ model, settings })
		expect(result).toBe(4096)
	})

	test("should fallback to DEFAULT_THINKING_MODEL_MAX_TOKENS when thinking is true but apiConfig.modelMaxTokens is not defined", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			maxTokens: 2048,
			requiredReasoningBudget: true,
		}

		const settings: ProviderSettings = {}

		const result = getModelMaxOutputTokens({ model, settings: undefined })
		expect(result).toBe(16_384)
	})

	test("should handle undefined inputs gracefully", () => {
		const modelInfoOnly: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			maxTokens: 2048,
		}

		expect(getModelMaxOutputTokens({ model: modelInfoOnly, settings: undefined })).toBe(2048)
	})

	test("should handle missing properties gracefully", () => {
		const modelInfoWithoutMaxTokens: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			requiredReasoningBudget: true,
		}

		const settings: ProviderSettings = {
			modelMaxTokens: 4096,
		}

		expect(getModelMaxOutputTokens({ model: modelInfoWithoutMaxTokens, settings })).toBe(4096)

		const modelInfoWithoutThinking: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			maxTokens: 2048,
		}

		expect(getModelMaxOutputTokens({ model: modelInfoWithoutThinking, settings: undefined })).toBe(2048)
	})
})

describe("shouldUseReasoningBudget", () => {
	it("should return true when model has requiredReasoningBudget", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			requiredReasoningBudget: true,
		}

		// Should return true regardless of settings
		expect(shouldUseReasoningBudget({ model })).toBe(true)
		expect(shouldUseReasoningBudget({ model, settings: {} })).toBe(true)
		expect(shouldUseReasoningBudget({ model, settings: { enableReasoningEffort: false } })).toBe(true)
	})

	it("should return true when model supports reasoning budget and settings enable reasoning effort", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			supportsReasoningBudget: true,
		}

		const settings: ProviderSettings = {
			enableReasoningEffort: true,
		}

		expect(shouldUseReasoningBudget({ model, settings })).toBe(true)
	})

	it("should return false when model supports reasoning budget but settings don't enable reasoning effort", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			supportsReasoningBudget: true,
		}

		const settings: ProviderSettings = {
			enableReasoningEffort: false,
		}

		expect(shouldUseReasoningBudget({ model, settings })).toBe(false)
		expect(shouldUseReasoningBudget({ model, settings: {} })).toBe(false)
		expect(shouldUseReasoningBudget({ model })).toBe(false)
	})

	it("should return false when model doesn't support reasoning budget", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
		}

		const settings: ProviderSettings = {
			enableReasoningEffort: true,
		}

		expect(shouldUseReasoningBudget({ model, settings })).toBe(false)
		expect(shouldUseReasoningBudget({ model })).toBe(false)
	})

	it("should handle undefined settings gracefully", () => {
		const modelWithRequired: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			requiredReasoningBudget: true,
		}

		const modelWithSupported: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			supportsReasoningBudget: true,
		}

		expect(shouldUseReasoningBudget({ model: modelWithRequired, settings: undefined })).toBe(true)
		expect(shouldUseReasoningBudget({ model: modelWithSupported, settings: undefined })).toBe(false)
	})
})

describe("shouldUseReasoningEffort", () => {
	it("should return true when model has reasoningEffort property", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			reasoningEffort: "medium",
		}

		// Should return true regardless of settings
		expect(shouldUseReasoningEffort({ model })).toBe(true)
		expect(shouldUseReasoningEffort({ model, settings: {} })).toBe(true)
		expect(shouldUseReasoningEffort({ model, settings: { reasoningEffort: undefined } })).toBe(true)
	})

	it("should return true when model supports reasoning effort and settings provide reasoning effort", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			supportsReasoningEffort: true,
		}

		const settings: ProviderSettings = {
			reasoningEffort: "high",
		}

		expect(shouldUseReasoningEffort({ model, settings })).toBe(true)
	})

	it("should return false when model supports reasoning effort but settings don't provide reasoning effort", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			supportsReasoningEffort: true,
		}

		const settings: ProviderSettings = {
			reasoningEffort: undefined,
		}

		expect(shouldUseReasoningEffort({ model, settings })).toBe(false)
		expect(shouldUseReasoningEffort({ model, settings: {} })).toBe(false)
		expect(shouldUseReasoningEffort({ model })).toBe(false)
	})

	it("should return false when model doesn't support reasoning effort", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
		}

		const settings: ProviderSettings = {
			reasoningEffort: "high",
		}

		expect(shouldUseReasoningEffort({ model, settings })).toBe(false)
		expect(shouldUseReasoningEffort({ model })).toBe(false)
	})

	it("should handle different reasoning effort values", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			supportsReasoningEffort: true,
		}

		const settingsLow: ProviderSettings = { reasoningEffort: "low" }
		const settingsMedium: ProviderSettings = { reasoningEffort: "medium" }
		const settingsHigh: ProviderSettings = { reasoningEffort: "high" }

		expect(shouldUseReasoningEffort({ model, settings: settingsLow })).toBe(true)
		expect(shouldUseReasoningEffort({ model, settings: settingsMedium })).toBe(true)
		expect(shouldUseReasoningEffort({ model, settings: settingsHigh })).toBe(true)
	})

	it("should handle undefined settings gracefully", () => {
		const modelWithReasoning: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			reasoningEffort: "medium",
		}

		const modelWithSupported: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			supportsReasoningEffort: true,
		}

		expect(shouldUseReasoningEffort({ model: modelWithReasoning, settings: undefined })).toBe(true)
		expect(shouldUseReasoningEffort({ model: modelWithSupported, settings: undefined })).toBe(false)
	})

	it("should prioritize model reasoningEffort over settings", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			supportsReasoningEffort: true,
			reasoningEffort: "low",
		}

		const settings: ProviderSettings = {
			reasoningEffort: "high",
		}

		// Should return true because model.reasoningEffort exists, regardless of settings
		expect(shouldUseReasoningEffort({ model, settings })).toBe(true)
	})
})
