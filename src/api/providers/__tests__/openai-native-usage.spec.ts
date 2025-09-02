import { describe, it, expect, beforeEach } from "vitest"
import { OpenAiNativeHandler } from "../openai-native"
import { openAiNativeModels } from "@roo-code/types"

describe("OpenAiNativeHandler - normalizeUsage", () => {
	let handler: OpenAiNativeHandler
	const mockModel = {
		id: "gpt-4o",
		info: openAiNativeModels["gpt-4o"],
	}

	beforeEach(() => {
		handler = new OpenAiNativeHandler({
			openAiNativeApiKey: "test-key",
		})
	})

	describe("detailed token shapes (Responses API)", () => {
		it("should handle detailed shapes with cached and miss tokens", () => {
			const usage = {
				input_tokens: 100,
				output_tokens: 50,
				input_tokens_details: {
					cached_tokens: 30,
					cache_miss_tokens: 70,
				},
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 30,
				cacheWriteTokens: 0, // miss tokens are NOT cache writes
			})
		})

		it("should derive total input tokens from details when totals are missing", () => {
			const usage = {
				// No input_tokens or prompt_tokens
				output_tokens: 50,
				input_tokens_details: {
					cached_tokens: 30,
					cache_miss_tokens: 70,
				},
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100, // Derived from 30 + 70
				outputTokens: 50,
				cacheReadTokens: 30,
				cacheWriteTokens: 0, // miss tokens are NOT cache writes
			})
		})

		it("should handle prompt_tokens_details variant", () => {
			const usage = {
				prompt_tokens: 100,
				completion_tokens: 50,
				prompt_tokens_details: {
					cached_tokens: 30,
					cache_miss_tokens: 70,
				},
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 30,
				cacheWriteTokens: 0, // miss tokens are NOT cache writes
			})
		})

		it("should handle cache_creation_input_tokens for actual cache writes", () => {
			const usage = {
				input_tokens: 100,
				output_tokens: 50,
				cache_creation_input_tokens: 20,
				input_tokens_details: {
					cached_tokens: 30,
					cache_miss_tokens: 50, // 50 miss + 30 cached + 20 creation = 100 total
				},
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 30,
				cacheWriteTokens: 20, // Actual cache writes from cache_creation_input_tokens
			})
		})

		it("should handle reasoning tokens in output details", () => {
			const usage = {
				input_tokens: 100,
				output_tokens: 150,
				output_tokens_details: {
					reasoning_tokens: 50,
				},
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 150,
				reasoningTokens: 50,
			})
		})
	})

	describe("legacy field names", () => {
		it("should handle cache_creation_input_tokens and cache_read_input_tokens", () => {
			const usage = {
				input_tokens: 100,
				output_tokens: 50,
				cache_creation_input_tokens: 20,
				cache_read_input_tokens: 30,
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 30,
				cacheWriteTokens: 20,
			})
		})

		it("should handle cache_write_tokens and cache_read_tokens", () => {
			const usage = {
				input_tokens: 100,
				output_tokens: 50,
				cache_write_tokens: 20,
				cache_read_tokens: 30,
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 30,
				cacheWriteTokens: 20,
			})
		})

		it("should handle cached_tokens field", () => {
			const usage = {
				input_tokens: 100,
				output_tokens: 50,
				cached_tokens: 30,
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 30,
			})
		})

		it("should handle prompt_tokens and completion_tokens", () => {
			const usage = {
				prompt_tokens: 100,
				completion_tokens: 50,
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			})
		})
	})

	describe("SSE-only events", () => {
		it("should handle SSE events with minimal usage data", () => {
			const usage = {
				input_tokens: 100,
				output_tokens: 50,
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			})
		})

		it("should handle SSE events with no cache information", () => {
			const usage = {
				prompt_tokens: 100,
				completion_tokens: 50,
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			})
		})
	})

	describe("edge cases", () => {
		it("should handle undefined usage", () => {
			const result = (handler as any).normalizeUsage(undefined, mockModel)
			expect(result).toBeUndefined()
		})

		it("should handle null usage", () => {
			const result = (handler as any).normalizeUsage(null, mockModel)
			expect(result).toBeUndefined()
		})

		it("should handle empty usage object", () => {
			const usage = {}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			})
		})

		it("should handle missing details but with cache fields", () => {
			const usage = {
				input_tokens: 100,
				output_tokens: 50,
				cache_read_input_tokens: 30,
				// No input_tokens_details
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 30,
				cacheWriteTokens: 0,
			})
		})

		it("should use all available cache information with proper fallbacks", () => {
			const usage = {
				input_tokens: 100,
				output_tokens: 50,
				cached_tokens: 20, // Legacy field (will be used as fallback)
				input_tokens_details: {
					cached_tokens: 30, // Detailed shape
					cache_miss_tokens: 70,
				},
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			// The implementation uses nullish coalescing, so it will use the first non-nullish value:
			// cache_read_input_tokens ?? cache_read_tokens ?? cached_tokens ?? cachedFromDetails
			// Since none of the first two exist, it falls back to cached_tokens (20) before cachedFromDetails
			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 20, // From cached_tokens (legacy field comes before details in fallback chain)
				cacheWriteTokens: 0, // miss tokens are NOT cache writes
			})
		})

		it("should use detailed shapes when legacy fields are not present", () => {
			const usage = {
				input_tokens: 100,
				output_tokens: 50,
				// No cached_tokens legacy field
				input_tokens_details: {
					cached_tokens: 30,
					cache_miss_tokens: 70,
				},
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: 30, // From details since no legacy field exists
				cacheWriteTokens: 0, // miss tokens are NOT cache writes
			})
		})

		it("should handle totals missing with only partial details", () => {
			const usage = {
				// No input_tokens or prompt_tokens
				output_tokens: 50,
				input_tokens_details: {
					cached_tokens: 30,
					// No cache_miss_tokens
				},
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toMatchObject({
				type: "usage",
				inputTokens: 30, // Derived from cached_tokens only
				outputTokens: 50,
				cacheReadTokens: 30,
				cacheWriteTokens: 0,
			})
		})
	})

	describe("cost calculation", () => {
		it("should pass total input tokens to calculateApiCostOpenAI", () => {
			const usage = {
				input_tokens: 100,
				output_tokens: 50,
				cache_read_input_tokens: 30,
				cache_creation_input_tokens: 20,
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toHaveProperty("totalCost")
			expect(result.totalCost).toBeGreaterThan(0)
			// calculateApiCostOpenAI handles subtracting cache tokens internally
			// It will compute: 100 - 30 - 20 = 50 uncached input tokens
		})

		it("should handle cost calculation with no cache reads", () => {
			const usage = {
				input_tokens: 100,
				output_tokens: 50,
			}

			const result = (handler as any).normalizeUsage(usage, mockModel)

			expect(result).toHaveProperty("totalCost")
			expect(result.totalCost).toBeGreaterThan(0)
			// Cost should be calculated with full input tokens since no cache reads
		})
	})
})
