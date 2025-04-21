// This test directly tests the logic of the ContextWindowProgress component calculations
// without needing to render the full component
import { describe, test, expect } from "@jest/globals"
import { calculateTokenDistribution } from "@src/utils/model-utils"

export {} // This makes the file a proper TypeScript module

describe("ContextWindowProgress Logic", () => {
	// Using the shared utility function from model-utils.ts instead of reimplementing it

	test("calculates correct token distribution with default 20% reservation", () => {
		const contextWindow = 4000
		const contextTokens = 1000

		const result = calculateTokenDistribution(contextWindow, contextTokens)

		// Expected calculations:
		// reservedForOutput = 0.2 * 4000 = 800
		// availableSize = 4000 - 1000 - 800 = 2200
		// total = 1000 + 800 + 2200 = 4000
		expect(result.reservedForOutput).toBe(800)
		expect(result.availableSize).toBe(2200)

		// Check percentages
		expect(result.currentPercent).toBeCloseTo(25) // 1000/4000 * 100 = 25%
		expect(result.reservedPercent).toBeCloseTo(20) // 800/4000 * 100 = 20%
		expect(result.availablePercent).toBeCloseTo(55) // 2200/4000 * 100 = 55%

		// Verify percentages sum to 100%
		expect(result.currentPercent + result.reservedPercent + result.availablePercent).toBeCloseTo(100)
	})

	test("uses provided maxTokens when available instead of default calculation", () => {
		const contextWindow = 4000
		const contextTokens = 1000

		// First calculate with default 20% reservation (no maxTokens provided)
		const defaultResult = calculateTokenDistribution(contextWindow, contextTokens)

		// Then calculate with custom maxTokens value
		const customMaxTokens = 1500 // Custom maxTokens instead of default 20%
		const customResult = calculateTokenDistribution(contextWindow, contextTokens, customMaxTokens)

		// VERIFY MAXTOKEN PROP EFFECT: Custom maxTokens should be used directly instead of 20% calculation
		const defaultReserved = Math.ceil(contextWindow * 0.2) // 800 tokens (20% of 4000)
		expect(defaultResult.reservedForOutput).toBe(defaultReserved)
		expect(customResult.reservedForOutput).toBe(customMaxTokens) // Should use exact provided value

		// Explicitly confirm the tooltip content would be different
		const defaultTooltip = `Reserved for model response: ${defaultReserved} tokens`
		const customTooltip = `Reserved for model response: ${customMaxTokens} tokens`
		expect(defaultTooltip).not.toBe(customTooltip)

		// Verify the effect on available space
		expect(customResult.availableSize).toBe(4000 - 1000 - 1500) // 1500 tokens available
		expect(defaultResult.availableSize).toBe(4000 - 1000 - 800) // 2200 tokens available

		// Verify the effect on percentages
		// With custom maxTokens (1500), the reserved percentage should be higher
		expect(defaultResult.reservedPercent).toBeCloseTo(20) // 800/4000 * 100 = 20%
		expect(customResult.reservedPercent).toBeCloseTo(37.5) // 1500/4000 * 100 = 37.5%

		// Verify percentages still sum to 100%
		expect(customResult.currentPercent + customResult.reservedPercent + customResult.availablePercent).toBeCloseTo(
			100,
		)
	})

	test("handles negative input values", () => {
		const contextWindow = 4000
		const contextTokens = -500 // Negative tokens should be handled gracefully

		const result = calculateTokenDistribution(contextWindow, contextTokens)

		// Expected calculations:
		// safeContextTokens = Math.max(0, -500) = 0
		// reservedForOutput = 0.2 * 4000 = 800
		// availableSize = 4000 - 0 - 800 = 3200
		// total = 0 + 800 + 3200 = 4000
		expect(result.currentPercent).toBeCloseTo(0) // 0/4000 * 100 = 0%
		expect(result.reservedPercent).toBeCloseTo(20) // 800/4000 * 100 = 20%
		expect(result.availablePercent).toBeCloseTo(80) // 3200/4000 * 100 = 80%
	})

	test("handles zero context window gracefully", () => {
		const contextWindow = 0
		const contextTokens = 1000

		const result = calculateTokenDistribution(contextWindow, contextTokens)

		// With zero context window, everything should be zero
		expect(result.reservedForOutput).toBe(0)
		expect(result.availableSize).toBe(0)

		// The percentages maintain total of 100% even with zero context window
		// due to how the division handles this edge case
		const totalPercentage = result.currentPercent + result.reservedPercent + result.availablePercent
		expect(totalPercentage).toBeCloseTo(100)
	})

	test("handles case where tokens exceed context window", () => {
		const contextWindow = 4000
		const contextTokens = 5000 // More tokens than the window size

		const result = calculateTokenDistribution(contextWindow, contextTokens)

		// Expected calculations:
		// reservedForOutput = 0.2 * 4000 = 800
		// availableSize = Math.max(0, 4000 - 5000 - 800) = 0
		expect(result.reservedForOutput).toBe(800)
		expect(result.availableSize).toBe(0)

		// Percentages should be calculated based on total (5000 + 800 + 0 = 5800)
		expect(result.currentPercent).toBeCloseTo((5000 / 5800) * 100)
		expect(result.reservedPercent).toBeCloseTo((800 / 5800) * 100)
		expect(result.availablePercent).toBeCloseTo(0)

		// Verify percentages sum to 100%
		expect(result.currentPercent + result.reservedPercent + result.availablePercent).toBeCloseTo(100)
	})
})
