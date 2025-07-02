import { expect } from "chai"
import { anthropicModels, bedrockModels, vertexModels, geminiModels, ApiConfiguration } from "../../shared/api"

describe("ThinkingBudgetSlider - Slider max value tests", () => {
	// Reproduce the logic of maxTokens function from ThinkingBudgetSlider.tsx
	const maxTokensLogic = (apiConfiguration: ApiConfiguration | undefined): number => {
		if (!apiConfiguration || !apiConfiguration.apiProvider || !apiConfiguration.apiModelId) {
			return 0
		}

		try {
			if (apiConfiguration.apiProvider === "gemini") {
				const modelId = apiConfiguration.apiModelId as keyof typeof geminiModels
				if (modelId === "gemini-2.5-flash-preview-04-17" && "thinkingConfig" in geminiModels[modelId]) {
					return geminiModels[modelId].thinkingConfig?.maxBudget || 0
				}
				return geminiModels[modelId]?.maxTokens || 0
			}

			if (apiConfiguration.apiProvider === "vertex") {
				const modelId = apiConfiguration.apiModelId as keyof typeof vertexModels
				if (
					(modelId === "claude-3-7-sonnet@20250219" || modelId === "gemini-2.5-flash-preview-04-17") &&
					"thinkingConfig" in vertexModels[modelId]
				) {
					return vertexModels[modelId].thinkingConfig?.maxBudget || 0
				}
				return vertexModels[modelId]?.maxTokens || 0
			}

			if (apiConfiguration.apiProvider === "anthropic") {
				const modelId = apiConfiguration.apiModelId as keyof typeof anthropicModels
				if (modelId === "claude-3-7-sonnet-20250219" && "thinkingConfig" in anthropicModels[modelId]) {
					return anthropicModels[modelId].thinkingConfig?.maxBudget || 0
				}
				return anthropicModels[modelId]?.maxTokens || 0
			}

			if (apiConfiguration.apiProvider === "bedrock") {
				const modelId = apiConfiguration.apiModelId as keyof typeof bedrockModels
				if (modelId === "anthropic.claude-3-7-sonnet-20250219-v1:0" && "thinkingConfig" in bedrockModels[modelId]) {
					return bedrockModels[modelId].thinkingConfig?.maxBudget || 0
				}
				return bedrockModels[modelId]?.maxTokens || 0
			}
		} catch (error) {
			console.error("Error retrieving model info:", error)
		}
		return 0
	}

	// Reproduce the logic of getThinkingBudgetPercentage from ThinkingBudgetSlider.tsx
	const getThinkingBudgetPercentageLogic = (apiConfiguration: ApiConfiguration | undefined): number => {
		if (apiConfiguration?.apiModelId === "gemini-2.5-flash-preview-04-17") {
			return 1.0
		} else if (
			(apiConfiguration?.apiProvider === "anthropic" && apiConfiguration.apiModelId === "claude-3-7-sonnet-20250219") ||
			(apiConfiguration?.apiProvider === "bedrock" &&
				apiConfiguration.apiModelId === "anthropic.claude-3-7-sonnet-20250219-v1:0") ||
			(apiConfiguration?.apiProvider === "vertex" && apiConfiguration.apiModelId === "claude-3-7-sonnet@20250219")
		) {
			return 0.5
		}
		return 0.8
	}

	// Reproduce the logic of calculateMaxBudget
	const calculateMaxBudget = (apiConfiguration: ApiConfiguration | undefined): number => {
		const tokens = maxTokensLogic(apiConfiguration)
		const percentage = getThinkingBudgetPercentageLogic(apiConfiguration)
		console.log(`Provider: ${apiConfiguration?.apiProvider}, Model: ${apiConfiguration?.apiModelId}`)
		console.log(`maxTokens: ${tokens}, percentage: ${percentage}`)
		console.log(`Calculated maxSliderValue: ${Math.floor(tokens * percentage)}`)
		return Math.floor(tokens * percentage)
	}

	describe("Model definitions validation", () => {
		it("should have thinkingConfig.maxBudget set correctly for all Claude 3.7 Sonnet models", () => {
			expect(anthropicModels["claude-3-7-sonnet-20250219"].thinkingConfig?.maxBudget).to.equal(64000)
			expect(bedrockModels["anthropic.claude-3-7-sonnet-20250219-v1:0"].thinkingConfig?.maxBudget).to.equal(64000)
			expect(vertexModels["claude-3-7-sonnet@20250219"].thinkingConfig?.maxBudget).to.equal(64000)
		})

		it("should have maxTokens set correctly for all Claude 3.7 Sonnet models", () => {
			expect(anthropicModels["claude-3-7-sonnet-20250219"].maxTokens).to.equal(8192)
			expect(bedrockModels["anthropic.claude-3-7-sonnet-20250219-v1:0"].maxTokens).to.equal(8192)
			expect(vertexModels["claude-3-7-sonnet@20250219"].maxTokens).to.equal(8192)
		})
	})

	describe("maxTokens function tests", () => {
		it("should retrieve the Thinking Budget for Anthropic Claude 3.7 correctly", () => {
			const config: ApiConfiguration = { apiProvider: "anthropic", apiModelId: "claude-3-7-sonnet-20250219" }
			const result = maxTokensLogic(config)
			expect(result).to.equal(64000)
			expect(result).to.not.equal(8192)
		})

		it("should retrieve the Thinking Budget for Bedrock Claude 3.7 correctly", () => {
			const config: ApiConfiguration = { apiProvider: "bedrock", apiModelId: "anthropic.claude-3-7-sonnet-20250219-v1:0" }
			const result = maxTokensLogic(config)
			expect(result).to.equal(64000)
			expect(result).to.not.equal(8192)
		})

		it("should retrieve the Thinking Budget for Vertex Claude 3.7 correctly", () => {
			const config: ApiConfiguration = { apiProvider: "vertex", apiModelId: "claude-3-7-sonnet@20250219" }
			const result = maxTokensLogic(config)
			expect(result).to.equal(64000)
			expect(result).to.not.equal(8192)
		})

		it("should use maxTokens for models without thinkingConfig.maxBudget", () => {
			const config: ApiConfiguration = { apiProvider: "anthropic", apiModelId: "claude-3-5-sonnet-20241022" }
			const result = maxTokensLogic(config)
			expect(result).to.equal(anthropicModels["claude-3-5-sonnet-20241022"].maxTokens)
		})
	})

	describe("getThinkingBudgetPercentage function tests", () => {
		it("should return 0.5 for Claude 3.7 models", () => {
			const anthropicConfig: ApiConfiguration = { apiProvider: "anthropic", apiModelId: "claude-3-7-sonnet-20250219" }
			expect(getThinkingBudgetPercentageLogic(anthropicConfig)).to.equal(0.5)

			const bedrockConfig: ApiConfiguration = {
				apiProvider: "bedrock",
				apiModelId: "anthropic.claude-3-7-sonnet-20250219-v1:0",
			}
			expect(getThinkingBudgetPercentageLogic(bedrockConfig)).to.equal(0.5)

			const vertexConfig: ApiConfiguration = { apiProvider: "vertex", apiModelId: "claude-3-7-sonnet@20250219" }
			expect(getThinkingBudgetPercentageLogic(vertexConfig)).to.equal(0.5)
		})

		it("should return 1.0 for Gemini 2.5 Flash", () => {
			const config: ApiConfiguration = { apiProvider: "gemini", apiModelId: "gemini-2.5-flash-preview-04-17" }
			expect(getThinkingBudgetPercentageLogic(config)).to.equal(1.0)
		})

		it("should return 0.8 for other models", () => {
			const config: ApiConfiguration = { apiProvider: "anthropic", apiModelId: "claude-3-5-sonnet-20241022" }
			expect(getThinkingBudgetPercentageLogic(config)).to.equal(0.8)
		})
	})

	describe("Final slider max value calculation tests", () => {
		it("should calculate 32000 for Anthropic Claude 3.7 (64000 * 0.5)", () => {
			const config: ApiConfiguration = { apiProvider: "anthropic", apiModelId: "claude-3-7-sonnet-20250219" }
			const result = calculateMaxBudget(config)
			expect(result).to.equal(32000)
			expect(result).to.not.equal(6553)
		})

		it("should calculate 32000 for Bedrock Claude 3.7 (64000 * 0.5)", () => {
			const config: ApiConfiguration = { apiProvider: "bedrock", apiModelId: "anthropic.claude-3-7-sonnet-20250219-v1:0" }
			const result = calculateMaxBudget(config)
			expect(result).to.equal(32000)
			expect(result).to.not.equal(6553)
		})

		it("should calculate 32000 for Vertex Claude 3.7 (64000 * 0.5)", () => {
			const config: ApiConfiguration = { apiProvider: "vertex", apiModelId: "claude-3-7-sonnet@20250219" }
			const result = calculateMaxBudget(config)
			expect(result).to.equal(32000)
			expect(result).to.not.equal(6553)
		})

		it("should calculate correct value for other models (maxTokens * 0.8)", () => {
			const config: ApiConfiguration = { apiProvider: "anthropic", apiModelId: "claude-3-5-sonnet-20241022" }
			const result = calculateMaxBudget(config)
			expect(result).to.equal(Math.floor(8192 * 0.8))
			expect(result).to.equal(6553)
		})
	})

	describe("Bug reproduction test", () => {
		it("should detail the calculation for Anthropic case", () => {
			const config: ApiConfiguration = { apiProvider: "anthropic", apiModelId: "claude-3-7-sonnet-20250219" }

			// Log intermediate values
			const tokens = maxTokensLogic(config)
			console.log(`Anthropic Claude 3.7 maxTokens() result: ${tokens}`)
			expect(tokens).to.equal(64000)

			const percentage = getThinkingBudgetPercentageLogic(config)
			console.log(`Anthropic Claude 3.7 getThinkingBudgetPercentage() result: ${percentage}`)
			expect(percentage).to.equal(0.5)

			const result = Math.floor(tokens * percentage)
			console.log(`Anthropic Claude 3.7 calculation result: ${result}`)
			expect(result).to.equal(32000)

			// Simulate buggy calculation
			const bugResult = Math.floor(8192 * 0.8)
			console.log(`Bug calculation result (8192 * 0.8): ${bugResult}`)
			expect(bugResult).to.equal(6553)
		})
	})
})
