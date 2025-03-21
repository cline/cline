/**
 * @fileoverview Tests for token and model utility functions
 */

import {
	getMaxTokensForModel,
	calculateTokenDistribution,
	ModelInfo,
	ApiConfig,
	DEFAULT_THINKING_MODEL_MAX_TOKENS,
} from "../model-utils"

describe("Model utility functions", () => {
	describe("getMaxTokensForModel", () => {
		/**
		 * Testing the specific fix in commit cc79178f:
		 * For thinking models, use apiConfig.modelMaxTokens if available,
		 * otherwise fall back to 8192 (not modelInfo.maxTokens)
		 */

		it("should return apiConfig.modelMaxTokens for thinking models when provided", () => {
			const modelInfo: ModelInfo = {
				thinking: true,
				maxTokens: 8000,
			}

			const apiConfig: ApiConfig = {
				modelMaxTokens: 4000,
			}

			expect(getMaxTokensForModel(modelInfo, apiConfig)).toBe(4000)
		})

		it("should return 16_384 for thinking models when modelMaxTokens not provided", () => {
			const modelInfo: ModelInfo = {
				thinking: true,
				maxTokens: 8000,
			}

			const apiConfig: ApiConfig = {}

			// This tests the specific fix: now using DEFAULT_THINKING_MODEL_MAX_TOKENS instead of falling back to modelInfo.maxTokens
			expect(getMaxTokensForModel(modelInfo, apiConfig)).toBe(DEFAULT_THINKING_MODEL_MAX_TOKENS)
		})

		it("should return 16_384 for thinking models when apiConfig is undefined", () => {
			const modelInfo: ModelInfo = {
				thinking: true,
				maxTokens: 8000,
			}

			expect(getMaxTokensForModel(modelInfo, undefined)).toBe(DEFAULT_THINKING_MODEL_MAX_TOKENS)
		})

		it("should return modelInfo.maxTokens for non-thinking models", () => {
			const modelInfo: ModelInfo = {
				thinking: false,
				maxTokens: 8000,
			}

			const apiConfig: ApiConfig = {
				modelMaxTokens: 4000,
			}

			expect(getMaxTokensForModel(modelInfo, apiConfig)).toBe(8000)
		})

		it("should return undefined for non-thinking models with undefined maxTokens", () => {
			const modelInfo: ModelInfo = {
				thinking: false,
			}

			const apiConfig: ApiConfig = {
				modelMaxTokens: 4000,
			}

			expect(getMaxTokensForModel(modelInfo, apiConfig)).toBeUndefined()
		})

		it("should return undefined when modelInfo is undefined", () => {
			const apiConfig: ApiConfig = {
				modelMaxTokens: 4000,
			}

			expect(getMaxTokensForModel(undefined, apiConfig)).toBeUndefined()
		})
	})

	describe("calculateTokenDistribution", () => {
		it("should calculate token distribution correctly", () => {
			const contextWindow = 10000
			const contextTokens = 5000
			const maxTokens = 2000

			const result = calculateTokenDistribution(contextWindow, contextTokens, maxTokens)

			expect(result.reservedForOutput).toBe(maxTokens)
			expect(result.availableSize).toBe(3000) // 10000 - 5000 - 2000

			// Percentages should sum to 100%
			expect(Math.round(result.currentPercent + result.reservedPercent + result.availablePercent)).toBe(100)
		})

		it("should default to 20% of context window when maxTokens not provided", () => {
			const contextWindow = 10000
			const contextTokens = 5000

			const result = calculateTokenDistribution(contextWindow, contextTokens)

			expect(result.reservedForOutput).toBe(2000) // 20% of 10000
			expect(result.availableSize).toBe(3000) // 10000 - 5000 - 2000
		})

		it("should handle negative or zero inputs by using positive fallbacks", () => {
			const result = calculateTokenDistribution(-1000, -500)

			expect(result.currentPercent).toBe(0)
			expect(result.reservedPercent).toBe(0)
			expect(result.availablePercent).toBe(0)
			expect(result.reservedForOutput).toBe(0) // With negative inputs, both context window and tokens become 0, so 20% of 0 is 0
			expect(result.availableSize).toBe(0)
		})

		it("should handle zero total tokens without division by zero errors", () => {
			const result = calculateTokenDistribution(0, 0, 0)

			expect(result.currentPercent).toBe(0)
			expect(result.reservedPercent).toBe(0)
			expect(result.availablePercent).toBe(0)
			expect(result.reservedForOutput).toBe(0)
			expect(result.availableSize).toBe(0)
		})
	})
})
