import { DEFAULT_THINKING_MODEL_MAX_TOKENS, getMaxTokensForModel } from "@/utils/model-utils"

describe("getMaxTokensForModel utility from model-utils", () => {
	test("should return maxTokens from modelInfo when thinking is false", () => {
		const modelInfo = {
			maxTokens: 2048,
			thinking: false,
		}

		const apiConfig = {
			modelMaxTokens: 4096,
		}

		const result = getMaxTokensForModel(modelInfo, apiConfig)
		expect(result).toBe(2048)
	})

	test("should return modelMaxTokens from apiConfig when thinking is true", () => {
		const modelInfo = {
			maxTokens: 2048,
			thinking: true,
		}

		const apiConfig = {
			modelMaxTokens: 4096,
		}

		const result = getMaxTokensForModel(modelInfo, apiConfig)
		expect(result).toBe(4096)
	})

	test("should fallback to DEFAULT_THINKING_MODEL_MAX_TOKENS when thinking is true but apiConfig.modelMaxTokens is not defined", () => {
		const modelInfo = {
			maxTokens: 2048,
			thinking: true,
		}

		const apiConfig = {}

		const result = getMaxTokensForModel(modelInfo, apiConfig)
		expect(result).toBe(DEFAULT_THINKING_MODEL_MAX_TOKENS)
	})

	test("should handle undefined inputs gracefully", () => {
		// Both undefined
		expect(getMaxTokensForModel(undefined, undefined)).toBeUndefined()

		// Only modelInfo defined
		const modelInfoOnly = {
			maxTokens: 2048,
			thinking: false,
		}
		expect(getMaxTokensForModel(modelInfoOnly, undefined)).toBe(2048)

		// Only apiConfig defined
		const apiConfigOnly = {
			modelMaxTokens: 4096,
		}
		expect(getMaxTokensForModel(undefined, apiConfigOnly)).toBeUndefined()
	})

	test("should handle missing properties gracefully", () => {
		// modelInfo without maxTokens
		const modelInfoWithoutMaxTokens = {
			thinking: true,
		}

		const apiConfig = {
			modelMaxTokens: 4096,
		}

		expect(getMaxTokensForModel(modelInfoWithoutMaxTokens, apiConfig)).toBe(4096)

		// modelInfo without thinking flag
		const modelInfoWithoutThinking = {
			maxTokens: 2048,
		}

		expect(getMaxTokensForModel(modelInfoWithoutThinking, apiConfig)).toBe(2048)
	})
})
