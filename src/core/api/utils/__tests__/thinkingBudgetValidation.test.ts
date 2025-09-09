import { ModelInfo } from "@shared/api"
import { expect } from "chai"
import { describe, it } from "mocha"
import { clampThinkingBudget, getMaxThinkingBudgetForModel } from "../thinkingBudgetValidation"

describe("thinkingBudgetValidation", () => {
	describe("getMaxThinkingBudgetForModel", () => {
		it("should return thinkingConfig.maxBudget when available", () => {
			const modelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				thinkingConfig: {
					maxBudget: 32767,
				},
			}

			expect(getMaxThinkingBudgetForModel(modelInfo)).to.equal(32767)
		})

		it("should return maxTokens - 1 when thinkingConfig.maxBudget is not available", () => {
			const modelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
			}

			expect(getMaxThinkingBudgetForModel(modelInfo)).to.equal(8191)
		})

		it("should prefer thinkingConfig.maxBudget over maxTokens when both are available", () => {
			const modelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				thinkingConfig: {
					maxBudget: 5000,
				},
			}

			expect(getMaxThinkingBudgetForModel(modelInfo)).to.equal(5000)
		})

		it("should return undefined when neither thinkingConfig.maxBudget nor maxTokens are available", () => {
			const modelInfo: ModelInfo = {
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
			}

			expect(getMaxThinkingBudgetForModel(modelInfo)).to.be.undefined
		})

		it("should return undefined when maxTokens is 0", () => {
			const modelInfo: ModelInfo = {
				maxTokens: 0,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
			}

			expect(getMaxThinkingBudgetForModel(modelInfo)).to.be.undefined
		})
	})

	describe("clampThinkingBudget", () => {
		it("should return original value when it is below the limit", () => {
			const modelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
			}

			expect(clampThinkingBudget(5000, modelInfo)).to.equal(5000)
		})

		it("should return original value when it equals the limit", () => {
			const modelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
			}

			expect(clampThinkingBudget(8191, modelInfo)).to.equal(8191)
		})

		it("should return clamped value when it exceeds the limit", () => {
			const modelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
			}

			expect(clampThinkingBudget(10000, modelInfo)).to.equal(4095)
		})

		it("should use thinkingConfig.maxBudget for clamping when available", () => {
			const modelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				thinkingConfig: {
					maxBudget: 5000,
				},
			}

			expect(clampThinkingBudget(7000, modelInfo)).to.equal(5000)
		})

		it("should return original value when model has no limits", () => {
			const modelInfo: ModelInfo = {
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
			}

			expect(clampThinkingBudget(10000, modelInfo)).to.equal(10000)
		})

		it("should handle edge case with very small maxTokens", () => {
			const modelInfo: ModelInfo = {
				maxTokens: 1,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
			}

			expect(clampThinkingBudget(1000, modelInfo)).to.equal(0)
		})

		it("should handle zero thinking budget value", () => {
			const modelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
			}

			expect(clampThinkingBudget(0, modelInfo)).to.equal(0)
		})

		it("should handle negative thinking budget value", () => {
			const modelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
			}

			expect(clampThinkingBudget(-100, modelInfo)).to.equal(-100)
		})
	})

	describe("real-world model scenarios", () => {
		it("should handle Anthropic Claude model (uses maxTokens)", () => {
			const claudeModel: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3.0,
				outputPrice: 15.0,
			}

			expect(getMaxThinkingBudgetForModel(claudeModel)).to.equal(8191)
			expect(clampThinkingBudget(10000, claudeModel)).to.equal(8191)
			expect(clampThinkingBudget(5000, claudeModel)).to.equal(5000)
		})

		it("should handle Gemini model (uses thinkingConfig.maxBudget)", () => {
			const geminiModel: ModelInfo = {
				maxTokens: 65536,
				contextWindow: 1048576,
				supportsImages: true,
				supportsPromptCache: true,
				thinkingConfig: {
					maxBudget: 32767,
				},
				inputPrice: 2.5,
				outputPrice: 15,
			}

			expect(getMaxThinkingBudgetForModel(geminiModel)).to.equal(32767)
			expect(clampThinkingBudget(50000, geminiModel)).to.equal(32767)
			expect(clampThinkingBudget(20000, geminiModel)).to.equal(20000)
		})

		it("should handle model switching scenario (high to low limit)", () => {
			const highLimitModel: ModelInfo = {
				maxTokens: 65536,
				contextWindow: 1048576,
				supportsImages: true,
				supportsPromptCache: true,
				thinkingConfig: {
					maxBudget: 32767,
				},
			}

			const lowLimitModel: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
			}

			const originalBudget = 25000

			// Original budget is valid for high limit model
			expect(clampThinkingBudget(originalBudget, highLimitModel)).to.equal(25000)

			// Same budget gets clamped for low limit model
			expect(clampThinkingBudget(originalBudget, lowLimitModel)).to.equal(4095)
		})
	})
})
