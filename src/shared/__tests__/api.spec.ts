import { describe, test, expect } from "vitest"
import { getModelMaxOutputTokens, shouldUseReasoningBudget, shouldUseReasoningEffort } from "../api"
import type { ModelInfo, ProviderSettings } from "@roo-code/types"
import { CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS, ANTHROPIC_DEFAULT_MAX_TOKENS } from "@roo-code/types"

describe("getModelMaxOutputTokens", () => {
	const mockModel: ModelInfo = {
		maxTokens: 8192,
		contextWindow: 200000,
		supportsPromptCache: true,
	}

	test("should return claudeCodeMaxOutputTokens when using claude-code provider", () => {
		const settings: ProviderSettings = {
			apiProvider: "claude-code",
			claudeCodeMaxOutputTokens: 16384,
		}

		const result = getModelMaxOutputTokens({
			modelId: "claude-3-5-sonnet-20241022",
			model: mockModel,
			settings,
		})

		expect(result).toBe(16384)
	})

	test("should return model maxTokens when not using claude-code provider", () => {
		const settings: ProviderSettings = {
			apiProvider: "anthropic",
		}

		const result = getModelMaxOutputTokens({
			modelId: "claude-3-5-sonnet-20241022",
			model: mockModel,
			settings,
		})

		expect(result).toBe(8192)
	})

	test("should return default CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS when claude-code provider has no custom max tokens", () => {
		const settings: ProviderSettings = {
			apiProvider: "claude-code",
			// No claudeCodeMaxOutputTokens set
		}

		const result = getModelMaxOutputTokens({
			modelId: "claude-3-5-sonnet-20241022",
			model: mockModel,
			settings,
		})

		expect(result).toBe(CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS)
	})

	test("should handle reasoning budget models correctly", () => {
		const reasoningModel: ModelInfo = {
			...mockModel,
			supportsReasoningBudget: true,
			requiredReasoningBudget: true,
		}

		const settings: ProviderSettings = {
			apiProvider: "anthropic",
			enableReasoningEffort: true,
			modelMaxTokens: 32000,
		}

		const result = getModelMaxOutputTokens({
			modelId: "claude-3-7-sonnet-20250219",
			model: reasoningModel,
			settings,
		})

		expect(result).toBe(32000)
	})

	test("should return 20% of context window when maxTokens is undefined", () => {
		const modelWithoutMaxTokens: ModelInfo = {
			contextWindow: 100000,
			supportsPromptCache: true,
		}

		const result = getModelMaxOutputTokens({
			modelId: "some-model",
			model: modelWithoutMaxTokens,
			settings: {},
		})

		expect(result).toBe(20000) // 20% of 100000
	})

	test("should return ANTHROPIC_DEFAULT_MAX_TOKENS for Anthropic models that support reasoning budget but aren't using it", () => {
		const anthropicModelId = "claude-sonnet-4-20250514"
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			supportsReasoningBudget: true,
			maxTokens: 64_000, // This should be ignored
		}

		const settings: ProviderSettings = {
			apiProvider: "anthropic",
			enableReasoningEffort: false, // Not using reasoning
		}

		const result = getModelMaxOutputTokens({ modelId: anthropicModelId, model, settings })
		expect(result).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS) // Should be 8192, not 64_000
	})

	test("should return model.maxTokens for non-Anthropic models that support reasoning budget but aren't using it", () => {
		const geminiModelId = "gemini-2.5-flash-preview-04-17"
		const model: ModelInfo = {
			contextWindow: 1_048_576,
			supportsPromptCache: false,
			supportsReasoningBudget: true,
			maxTokens: 65_535,
		}

		const settings: ProviderSettings = {
			apiProvider: "gemini",
			enableReasoningEffort: false, // Not using reasoning
		}

		const result = getModelMaxOutputTokens({ modelId: geminiModelId, model, settings })
		expect(result).toBe(65_535) // Should use model.maxTokens, not ANTHROPIC_DEFAULT_MAX_TOKENS
	})

	test("should return modelMaxTokens from settings when reasoning budget is required", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			requiredReasoningBudget: true,
			maxTokens: 8000,
		}

		const settings: ProviderSettings = {
			modelMaxTokens: 4000,
		}

		expect(getModelMaxOutputTokens({ modelId: "test", model, settings })).toBe(4000)
	})

	test("should return default 16_384 for reasoning budget models when modelMaxTokens not provided", () => {
		const model: ModelInfo = {
			contextWindow: 200_000,
			supportsPromptCache: true,
			requiredReasoningBudget: true,
			maxTokens: 8000,
		}

		const settings = {}

		expect(getModelMaxOutputTokens({ modelId: "test", model, settings })).toBe(16_384)
	})
})

describe("shouldUseReasoningBudget", () => {
	test("should return true when model has requiredReasoningBudget", () => {
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

	test("should return true when model supports reasoning budget and settings enable reasoning effort", () => {
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

	test("should return false when model supports reasoning budget but settings don't enable reasoning effort", () => {
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

	test("should return false when model doesn't support reasoning budget", () => {
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
})

describe("shouldUseReasoningEffort", () => {
	test("should return true when model has reasoningEffort property", () => {
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

	test("should return true when model supports reasoning effort and settings provide reasoning effort", () => {
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

	test("should return false when model supports reasoning effort but settings don't provide reasoning effort", () => {
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

	test("should return false when model doesn't support reasoning effort", () => {
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

	test("should handle different reasoning effort values", () => {
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
})
