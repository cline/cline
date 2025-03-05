// npx jest src/api/__tests__/index.test.ts

import { BetaThinkingConfigParam } from "@anthropic-ai/sdk/resources/beta/messages/index.mjs"

import { getModelParams } from "../index"
import { ANTHROPIC_DEFAULT_MAX_TOKENS } from "../providers/constants"

describe("getModelParams", () => {
	it("should return default values when no custom values are provided", () => {
		const options = {}
		const model = {
			id: "test-model",
			contextWindow: 16000,
			supportsPromptCache: true,
		}

		const result = getModelParams({
			options,
			model,
			defaultMaxTokens: 1000,
			defaultTemperature: 0.5,
		})

		expect(result).toEqual({
			maxTokens: 1000,
			thinking: undefined,
			temperature: 0.5,
		})
	})

	it("should use custom temperature from options when provided", () => {
		const options = { modelTemperature: 0.7 }
		const model = {
			id: "test-model",
			contextWindow: 16000,
			supportsPromptCache: true,
		}

		const result = getModelParams({
			options,
			model,
			defaultMaxTokens: 1000,
			defaultTemperature: 0.5,
		})

		expect(result).toEqual({
			maxTokens: 1000,
			thinking: undefined,
			temperature: 0.7,
		})
	})

	it("should use model maxTokens when available", () => {
		const options = {}
		const model = {
			id: "test-model",
			maxTokens: 2000,
			contextWindow: 16000,
			supportsPromptCache: true,
		}

		const result = getModelParams({
			options,
			model,
			defaultMaxTokens: 1000,
		})

		expect(result).toEqual({
			maxTokens: 2000,
			thinking: undefined,
			temperature: 0,
		})
	})

	it("should handle thinking models correctly", () => {
		const options = {}
		const model = {
			id: "test-model",
			thinking: true,
			maxTokens: 2000,
			contextWindow: 16000,
			supportsPromptCache: true,
		}

		const result = getModelParams({
			options,
			model,
		})

		const expectedThinking: BetaThinkingConfigParam = {
			type: "enabled",
			budget_tokens: 1600, // 80% of 2000
		}

		expect(result).toEqual({
			maxTokens: 2000,
			thinking: expectedThinking,
			temperature: 1.0, // Thinking models require temperature 1.0.
		})
	})

	it("should honor customMaxTokens for thinking models", () => {
		const options = { modelMaxTokens: 3000 }
		const model = {
			id: "test-model",
			thinking: true,
			contextWindow: 16000,
			supportsPromptCache: true,
		}

		const result = getModelParams({
			options,
			model,
			defaultMaxTokens: 2000,
		})

		const expectedThinking: BetaThinkingConfigParam = {
			type: "enabled",
			budget_tokens: 2400, // 80% of 3000
		}

		expect(result).toEqual({
			maxTokens: 3000,
			thinking: expectedThinking,
			temperature: 1.0,
		})
	})

	it("should honor customMaxThinkingTokens for thinking models", () => {
		const options = { modelMaxThinkingTokens: 1500 }
		const model = {
			id: "test-model",
			thinking: true,
			maxTokens: 4000,
			contextWindow: 16000,
			supportsPromptCache: true,
		}

		const result = getModelParams({
			options,
			model,
		})

		const expectedThinking: BetaThinkingConfigParam = {
			type: "enabled",
			budget_tokens: 1500, // Using the custom value
		}

		expect(result).toEqual({
			maxTokens: 4000,
			thinking: expectedThinking,
			temperature: 1.0,
		})
	})

	it("should not honor customMaxThinkingTokens for non-thinking models", () => {
		const options = { modelMaxThinkingTokens: 1500 }
		const model = {
			id: "test-model",
			maxTokens: 4000,
			contextWindow: 16000,
			supportsPromptCache: true,
			// Note: model.thinking is not set (so it's falsey).
		}

		const result = getModelParams({
			options,
			model,
		})

		expect(result).toEqual({
			maxTokens: 4000,
			thinking: undefined, // Should remain undefined despite customMaxThinkingTokens being set.
			temperature: 0, // Using default temperature.
		})
	})

	it("should clamp thinking budget to at least 1024 tokens", () => {
		const options = { modelMaxThinkingTokens: 500 }
		const model = {
			id: "test-model",
			thinking: true,
			maxTokens: 2000,
			contextWindow: 16000,
			supportsPromptCache: true,
		}

		const result = getModelParams({
			options,
			model,
		})

		const expectedThinking: BetaThinkingConfigParam = {
			type: "enabled",
			budget_tokens: 1024, // Minimum is 1024
		}

		expect(result).toEqual({
			maxTokens: 2000,
			thinking: expectedThinking,
			temperature: 1.0,
		})
	})

	it("should clamp thinking budget to at most 80% of max tokens", () => {
		const options = { modelMaxThinkingTokens: 5000 }
		const model = {
			id: "test-model",
			thinking: true,
			maxTokens: 4000,
			contextWindow: 16000,
			supportsPromptCache: true,
		}

		const result = getModelParams({
			options,
			model,
		})

		const expectedThinking: BetaThinkingConfigParam = {
			type: "enabled",
			budget_tokens: 3200, // 80% of 4000
		}

		expect(result).toEqual({
			maxTokens: 4000,
			thinking: expectedThinking,
			temperature: 1.0,
		})
	})

	it("should use ANTHROPIC_DEFAULT_MAX_TOKENS when no maxTokens is provided for thinking models", () => {
		const options = {}
		const model = {
			id: "test-model",
			thinking: true,
			contextWindow: 16000,
			supportsPromptCache: true,
		}

		const result = getModelParams({
			options,
			model,
		})

		const expectedThinking: BetaThinkingConfigParam = {
			type: "enabled",
			budget_tokens: Math.floor(ANTHROPIC_DEFAULT_MAX_TOKENS * 0.8),
		}

		expect(result).toEqual({
			maxTokens: undefined,
			thinking: expectedThinking,
			temperature: 1.0,
		})
	})
})
