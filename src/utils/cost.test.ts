import { describe, it, expect } from "vitest"
import { calculateApiCost } from "../utils/cost"
import { ModelInfo } from "../shared/api"

describe("calculateApiCost", () => {
	it("should calculate cost with all parameters", () => {
		const modelInfo: ModelInfo = {
			inputPrice: 10,
			outputPrice: 20,
			cacheWritesPrice: 5,
			cacheReadsPrice: 3,
			supportsPromptCache: true, // or false, depending on the expected behavior
		}
		const inputTokens = 1000
		const outputTokens = 2000
		const cacheCreationInputTokens = 500
		const cacheReadInputTokens = 300

		const expectedCost =
			(5 / 1_000_000) * 500 + (3 / 1_000_000) * 300 + (10 / 1_000_000) * 1000 + (20 / 1_000_000) * 2000
		expect(
			calculateApiCost(modelInfo, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens),
		).toBe(expectedCost)
	})

	it("should calculate cost without cache creation tokens", () => {
		const modelInfo: ModelInfo = {
			inputPrice: 10,
			outputPrice: 20,
			cacheWritesPrice: 5,
			cacheReadsPrice: 3,
			supportsPromptCache: true, // or false, depending on the expected behavior
		}
		const inputTokens = 1000
		const outputTokens = 2000
		const cacheReadInputTokens = 300

		const expectedCost = (3 / 1_000_000) * 300 + (10 / 1_000_000) * 1000 + (20 / 1_000_000) * 2000
		expect(calculateApiCost(modelInfo, inputTokens, outputTokens, undefined, cacheReadInputTokens)).toBe(
			expectedCost,
		)
	})

	it("should calculate cost without cache read tokens", () => {
		const modelInfo: ModelInfo = {
			inputPrice: 10,
			outputPrice: 20,
			cacheWritesPrice: 5,
			cacheReadsPrice: 3,
			supportsPromptCache: true, // or false, depending on the expected behavior
		}
		const inputTokens = 1000
		const outputTokens = 2000
		const cacheCreationInputTokens = 500

		const expectedCost = (5 / 1_000_000) * 500 + (10 / 1_000_000) * 1000 + (20 / 1_000_000) * 2000
		expect(calculateApiCost(modelInfo, inputTokens, outputTokens, cacheCreationInputTokens, undefined)).toBe(
			expectedCost,
		)
	})

	it("should calculate cost with zero input and output tokens", () => {
		const modelInfo: ModelInfo = {
			inputPrice: 10,
			outputPrice: 20,
			cacheWritesPrice: 5,
			cacheReadsPrice: 3,
			supportsPromptCache: true, // or false, depending on the expected behavior
		}
		const inputTokens = 0
		const outputTokens = 0
		const cacheCreationInputTokens = 500
		const cacheReadInputTokens = 300

		const expectedCost = (5 / 1_000_000) * 500 + (3 / 1_000_000) * 300
		expect(
			calculateApiCost(modelInfo, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens),
		).toBe(expectedCost)
	})

	it("should calculate cost with zero cache tokens", () => {
		const modelInfo: ModelInfo = {
			inputPrice: 10,
			outputPrice: 20,
			cacheWritesPrice: 5,
			cacheReadsPrice: 3,
			supportsPromptCache: true, // or false, depending on the expected behavior
		}
		const inputTokens = 1000
		const outputTokens = 2000

		const expectedCost = (10 / 1_000_000) * 1000 + (20 / 1_000_000) * 2000
		expect(calculateApiCost(modelInfo, inputTokens, outputTokens)).toBe(expectedCost)
	})

	it("should calculate cost with undefined model prices", () => {
		const modelInfo: ModelInfo = {
			inputPrice: undefined,
			outputPrice: undefined,
			cacheWritesPrice: undefined,
			cacheReadsPrice: undefined,
			supportsPromptCache: false, // or true, depending on the expected behavior
		}
		const inputTokens = 1000
		const outputTokens = 2000
		const cacheCreationInputTokens = 500
		const cacheReadInputTokens = 300

		const expectedCost = 0
		expect(
			calculateApiCost(modelInfo, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens),
		).toBe(expectedCost)
	})
})
