// This test directly tests the logic of the ContextWindowProgress component calculations
// without needing to render the full component
import { calculateTokenDistribution } from "@src/utils/model-utils"

export {} // This makes the file a proper TypeScript module

describe("ContextWindowProgress Logic", () => {
	// Using the shared utility function from model-utils.ts instead of reimplementing it

	test("calculates correct token distribution with default 8192 reservation", () => {
		const contextWindow = 10000
		const contextTokens = 1000

		const result = calculateTokenDistribution(contextWindow, contextTokens)

		// Expected calculations:
		// reservedForOutput = 8192 (ANTHROPIC_DEFAULT_MAX_TOKENS)
		// availableSize = 10000 - 1000 - 8192 = 808
		// total = 1000 + 8192 + 808 = 10000
		expect(result.reservedForOutput).toBe(8192)
		expect(result.availableSize).toBe(808)

		// Check percentages
		expect(result.currentPercent).toBeCloseTo(10) // 1000/10000 * 100 = 10%
		expect(result.reservedPercent).toBeCloseTo(81.92) // 8192/10000 * 100 = 81.92%
		expect(result.availablePercent).toBeCloseTo(8.08) // 808/10000 * 100 = 8.08%

		// Verify percentages sum to 100%
		expect(result.currentPercent + result.reservedPercent + result.availablePercent).toBeCloseTo(100)
	})

	test("uses provided maxTokens when available instead of default calculation", () => {
		const contextWindow = 10000
		const contextTokens = 1000

		// First calculate with default 8192 reservation (no maxTokens provided)
		const defaultResult = calculateTokenDistribution(contextWindow, contextTokens)

		// Then calculate with custom maxTokens value
		const customMaxTokens = 1500 // Custom maxTokens instead of default 8192
		const customResult = calculateTokenDistribution(contextWindow, contextTokens, customMaxTokens)

		// VERIFY MAXTOKEN PROP EFFECT: Custom maxTokens should be used directly instead of 8192 calculation
		const defaultReserved = 8192 // ANTHROPIC_DEFAULT_MAX_TOKENS
		expect(defaultResult.reservedForOutput).toBe(defaultReserved)
		expect(customResult.reservedForOutput).toBe(customMaxTokens) // Should use exact provided value

		// Explicitly confirm the tooltip content would be different
		const defaultTooltip = `Reserved for model response: ${defaultReserved} tokens`
		const customTooltip = `Reserved for model response: ${customMaxTokens} tokens`
		expect(defaultTooltip).not.toBe(customTooltip)

		// Verify the effect on available space
		expect(customResult.availableSize).toBe(10000 - 1000 - 1500) // 7500 tokens available
		expect(defaultResult.availableSize).toBe(10000 - 1000 - 8192) // 808 tokens available

		// Verify the effect on percentages
		// With custom maxTokens (1500), the reserved percentage should be lower than default
		expect(defaultResult.reservedPercent).toBeCloseTo(81.92) // 8192/10000 * 100 = 81.92%
		expect(customResult.reservedPercent).toBeCloseTo(15) // 1500/10000 * 100 = 15%

		// Verify percentages still sum to 100%
		expect(customResult.currentPercent + customResult.reservedPercent + customResult.availablePercent).toBeCloseTo(
			100,
		)
	})

	test("handles negative input values", () => {
		const contextWindow = 10000
		const contextTokens = -500 // Negative tokens should be handled gracefully

		const result = calculateTokenDistribution(contextWindow, contextTokens)

		// Expected calculations:
		// safeContextTokens = Math.max(0, -500) = 0
		// reservedForOutput = 8192 (ANTHROPIC_DEFAULT_MAX_TOKENS)
		// availableSize = 10000 - 0 - 8192 = 1808
		// total = 0 + 8192 + 1808 = 10000
		expect(result.currentPercent).toBeCloseTo(0) // 0/10000 * 100 = 0%
		expect(result.reservedPercent).toBeCloseTo(81.92) // 8192/10000 * 100 = 81.92%
		expect(result.availablePercent).toBeCloseTo(18.08) // 1808/10000 * 100 = 18.08%
	})

	test("handles zero context window gracefully", () => {
		const contextWindow = 0
		const contextTokens = 1000

		const result = calculateTokenDistribution(contextWindow, contextTokens)

		// With zero context window, the function uses ANTHROPIC_DEFAULT_MAX_TOKENS but available size becomes 0
		expect(result.reservedForOutput).toBe(8192) // ANTHROPIC_DEFAULT_MAX_TOKENS
		expect(result.availableSize).toBe(0) // max(0, 0 - 1000 - 8192) = 0

		// The percentages maintain total of 100% even with zero context window
		// due to how the division handles this edge case
		const totalPercentage = result.currentPercent + result.reservedPercent + result.availablePercent
		expect(totalPercentage).toBeCloseTo(100)
	})

	test("handles case where tokens exceed context window", () => {
		const contextWindow = 10000
		const contextTokens = 12000 // More tokens than the window size

		const result = calculateTokenDistribution(contextWindow, contextTokens)

		// Expected calculations:
		// reservedForOutput = 8192 (ANTHROPIC_DEFAULT_MAX_TOKENS)
		// availableSize = Math.max(0, 10000 - 12000 - 8192) = 0
		expect(result.reservedForOutput).toBe(8192)
		expect(result.availableSize).toBe(0)

		// Percentages should be calculated based on total (12000 + 8192 + 0 = 20192)
		expect(result.currentPercent).toBeCloseTo((12000 / 20192) * 100)
		expect(result.reservedPercent).toBeCloseTo((8192 / 20192) * 100)
		expect(result.availablePercent).toBeCloseTo(0)

		// Verify percentages sum to 100%
		expect(result.currentPercent + result.reservedPercent + result.availablePercent).toBeCloseTo(100)
	})
})
