import { describe, it } from "mocha"
import "should"
import { ModelInfo } from "@shared/api"
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "@utils/cost"

describe("Cost Utilities", () => {
	describe("calculateApiCostAnthropic", () => {
		it("should calculate basic input/output costs", () => {
			const modelInfo: ModelInfo = {
				supportsPromptCache: false,
				inputPrice: 3.0, // $3 per million tokens
				outputPrice: 15.0, // $15 per million tokens
			}

			const cost = calculateApiCostAnthropic(modelInfo, 1000, 500)
			// Input: (3.0 / 1_000_000) * 1000 = 0.003
			// Output: (15.0 / 1_000_000) * 500 = 0.0075
			// Total: 0.003 + 0.0075 = 0.0105
			cost.should.equal(0.0105)
		})

		it("should handle missing prices", () => {
			const modelInfo: ModelInfo = {
				supportsPromptCache: true,
				// No prices specified
			}

			const cost = calculateApiCostAnthropic(modelInfo, 1000, 500)
			cost.should.equal(0)
		})

		it("should use real model configuration (Claude 3.5 Sonnet)", () => {
			const modelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3.0,
				outputPrice: 15.0,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
			}

			const cost = calculateApiCostAnthropic(modelInfo, 2000, 1000, 1500, 500)
			// Cache writes: (3.75 / 1_000_000) * 1500 = 0.005625
			// Cache reads: (0.3 / 1_000_000) * 500 = 0.00015
			// Input: (3.0 / 1_000_000) * 2000 = 0.006
			// Output: (15.0 / 1_000_000) * 1000 = 0.015
			// Total: 0.005625 + 0.00015 + 0.006 + 0.015 = 0.026775
			cost.should.equal(0.026775)
		})

		it("should handle zero token counts", () => {
			const modelInfo: ModelInfo = {
				supportsPromptCache: true,
				inputPrice: 3.0,
				outputPrice: 15.0,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
			}

			const cost = calculateApiCostAnthropic(modelInfo, 0, 0, 0, 0)
			cost.should.equal(0)
		})
	})

	describe("calculateApiCostOpenAI", () => {
		it("should calculate basic input/output costs", () => {
			const modelInfo: ModelInfo = {
				supportsPromptCache: false,
				inputPrice: 3.0, // $3 per million tokens
				outputPrice: 15.0, // $15 per million tokens
			}

			const cost = calculateApiCostOpenAI(modelInfo, 1000, 500)
			// Input: (3.0 / 1_000_000) * 1000 = 0.003
			// Output: (15.0 / 1_000_000) * 500 = 0.0075
			// Total: 0.003 + 0.0075 = 0.0105
			cost.should.equal(0.0105)
		})

		it("should handle missing prices", () => {
			const modelInfo: ModelInfo = {
				supportsPromptCache: true,
				// No prices specified
			}

			const cost = calculateApiCostOpenAI(modelInfo, 1000, 500)
			cost.should.equal(0)
		})

		it("should use real model configuration (Claude 3.5 Sonnet)", () => {
			const modelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3.0,
				outputPrice: 15.0,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
			}

			const cost = calculateApiCostOpenAI(modelInfo, 2100, 1000, 1500, 500)
			// Cache writes: (3.75 / 1_000_000) * 1500 = 0.005625
			// Cache reads: (0.3 / 1_000_000) * 500 = 0.00015
			// Input: (3.0 / 1_000_000) * (2100 - 1500 - 500) = 0.0003
			// Output: (15.0 / 1_000_000) * 1000 = 0.015
			// Total: 0.005625 + 0.00015 + 0.0003 + 0.015 = 0.021075
			cost.should.equal(0.021075)
		})

		it("should handle zero token counts", () => {
			const modelInfo: ModelInfo = {
				supportsPromptCache: true,
				inputPrice: 3.0,
				outputPrice: 15.0,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
			}

			const cost = calculateApiCostOpenAI(modelInfo, 0, 0, 0, 0)
			cost.should.equal(0)
		})
	})
})
