// npx vitest src/utils/__tests__/model-utils.spec.ts

import { calculateTokenDistribution } from "../model-utils"

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
