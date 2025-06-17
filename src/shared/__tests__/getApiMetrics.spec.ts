// npx vitest run src/shared/__tests__/getApiMetrics.spec.ts

import type { ClineMessage } from "@roo-code/types"

import { getApiMetrics } from "../getApiMetrics"

describe("getApiMetrics", () => {
	// Helper function to create a basic api_req_started message
	const createApiReqStartedMessage = (
		text: string = '{"tokensIn":10,"tokensOut":20}',
		ts: number = 1000,
	): ClineMessage => ({
		type: "say",
		say: "api_req_started",
		text,
		ts,
	})

	// Helper function to create a condense_context message
	const createCondenseContextMessage = (
		cost: number = 0.002,
		newContextTokens: number = 500,
		prevContextTokens: number = 1000,
		ts: number = 2000,
	): ClineMessage => ({
		type: "say",
		say: "condense_context",
		contextCondense: {
			cost,
			newContextTokens,
			prevContextTokens,
			summary: "Context was condensed",
		},
		ts,
	})

	// Helper function to create a non-API message
	const createOtherMessage = (
		say: "text" | "error" | "reasoning" | "completion_result" = "text",
		text: string = "Hello world",
		ts: number = 999,
	): ClineMessage => ({
		type: "say",
		say,
		text,
		ts,
	})

	describe("Basic functionality", () => {
		it("should calculate metrics from a single api_req_started message", () => {
			const messages: ClineMessage[] = [
				createApiReqStartedMessage(
					'{"tokensIn":100,"tokensOut":200,"cacheWrites":5,"cacheReads":10,"cost":0.005}',
				),
			]

			const result = getApiMetrics(messages)

			expect(result.totalTokensIn).toBe(100)
			expect(result.totalTokensOut).toBe(200)
			expect(result.totalCacheWrites).toBe(5)
			expect(result.totalCacheReads).toBe(10)
			expect(result.totalCost).toBe(0.005)
			expect(result.contextTokens).toBe(315) // 100 + 200 + 5 + 10
		})

		it("should calculate metrics from multiple api_req_started messages", () => {
			const messages: ClineMessage[] = [
				createApiReqStartedMessage(
					'{"tokensIn":100,"tokensOut":200,"cacheWrites":5,"cacheReads":10,"cost":0.005}',
					1000,
				),
				createApiReqStartedMessage(
					'{"tokensIn":50,"tokensOut":150,"cacheWrites":3,"cacheReads":7,"cost":0.003}',
					2000,
				),
			]

			const result = getApiMetrics(messages)

			expect(result.totalTokensIn).toBe(150) // 100 + 50
			expect(result.totalTokensOut).toBe(350) // 200 + 150
			expect(result.totalCacheWrites).toBe(8) // 5 + 3
			expect(result.totalCacheReads).toBe(17) // 10 + 7
			expect(result.totalCost).toBe(0.008) // 0.005 + 0.003
			expect(result.contextTokens).toBe(210) // 50 + 150 + 3 + 7 (from the last message)
		})

		it("should calculate metrics from condense_context messages", () => {
			const messages: ClineMessage[] = [
				createCondenseContextMessage(0.002, 500, 1000, 1000),
				createCondenseContextMessage(0.003, 400, 800, 2000),
			]

			const result = getApiMetrics(messages)

			expect(result.totalTokensIn).toBe(0)
			expect(result.totalTokensOut).toBe(0)
			expect(result.totalCacheWrites).toBeUndefined()
			expect(result.totalCacheReads).toBeUndefined()
			expect(result.totalCost).toBe(0.005) // 0.002 + 0.003
			expect(result.contextTokens).toBe(400) // newContextTokens from the last condense_context message
		})

		it("should calculate metrics from mixed message types", () => {
			const messages: ClineMessage[] = [
				createApiReqStartedMessage(
					'{"tokensIn":100,"tokensOut":200,"cacheWrites":5,"cacheReads":10,"cost":0.005}',
					1000,
				),
				createOtherMessage("text", "Some text", 1500),
				createCondenseContextMessage(0.002, 500, 1000, 2000),
				createApiReqStartedMessage(
					'{"tokensIn":50,"tokensOut":150,"cacheWrites":3,"cacheReads":7,"cost":0.003}',
					3000,
				),
			]

			const result = getApiMetrics(messages)

			expect(result.totalTokensIn).toBe(150) // 100 + 50
			expect(result.totalTokensOut).toBe(350) // 200 + 150
			expect(result.totalCacheWrites).toBe(8) // 5 + 3
			expect(result.totalCacheReads).toBe(17) // 10 + 7
			expect(result.totalCost).toBe(0.01) // 0.005 + 0.002 + 0.003
			expect(result.contextTokens).toBe(210) // 50 + 150 + 3 + 7 (from the last api_req_started message)
		})
	})

	describe("Edge cases", () => {
		it("should handle empty messages array", () => {
			const result = getApiMetrics([])

			expect(result.totalTokensIn).toBe(0)
			expect(result.totalTokensOut).toBe(0)
			expect(result.totalCacheWrites).toBeUndefined()
			expect(result.totalCacheReads).toBeUndefined()
			expect(result.totalCost).toBe(0)
			expect(result.contextTokens).toBe(0)
		})

		it("should handle messages with no API metrics", () => {
			const messages: ClineMessage[] = [
				createOtherMessage("text", "Message 1", 1000),
				createOtherMessage("error", "Error message", 2000),
			]

			const result = getApiMetrics(messages)

			expect(result.totalTokensIn).toBe(0)
			expect(result.totalTokensOut).toBe(0)
			expect(result.totalCacheWrites).toBeUndefined()
			expect(result.totalCacheReads).toBeUndefined()
			expect(result.totalCost).toBe(0)
			expect(result.contextTokens).toBe(0)
		})

		it("should handle invalid JSON in api_req_started message", () => {
			// We need to mock console.error to avoid polluting test output
			const originalConsoleError = console.error
			console.error = vi.fn()

			const messages: ClineMessage[] = [
				{
					type: "say",
					say: "api_req_started",
					text: "This is not valid JSON",
					ts: 1000,
				},
			]

			const result = getApiMetrics(messages)

			// Should not throw and should return default values
			expect(result.totalTokensIn).toBe(0)
			expect(result.totalTokensOut).toBe(0)
			expect(result.totalCacheWrites).toBeUndefined()
			expect(result.totalCacheReads).toBeUndefined()
			expect(result.totalCost).toBe(0)
			expect(result.contextTokens).toBe(0)

			// Restore console.error
			console.error = originalConsoleError
		})

		it("should handle missing text field in api_req_started message", () => {
			const messages: ClineMessage[] = [
				{
					type: "say",
					say: "api_req_started",
					ts: 1000,
					// text field is missing
				},
			]

			const result = getApiMetrics(messages)

			// Should not throw and should return default values
			expect(result.totalTokensIn).toBe(0)
			expect(result.totalTokensOut).toBe(0)
			expect(result.totalCacheWrites).toBeUndefined()
			expect(result.totalCacheReads).toBeUndefined()
			expect(result.totalCost).toBe(0)
			expect(result.contextTokens).toBe(0)
		})

		it("should handle missing contextCondense field in condense_context message", () => {
			const messages: ClineMessage[] = [
				{
					type: "say",
					say: "condense_context",
					ts: 1000,
					// contextCondense field is missing
				},
			]

			const result = getApiMetrics(messages)

			// Should not throw and should return default values
			expect(result.totalTokensIn).toBe(0)
			expect(result.totalTokensOut).toBe(0)
			expect(result.totalCacheWrites).toBeUndefined()
			expect(result.totalCacheReads).toBeUndefined()
			expect(result.totalCost).toBe(0)
			expect(result.contextTokens).toBe(0)
		})

		it("should handle partial metrics in api_req_started message", () => {
			const messages: ClineMessage[] = [
				createApiReqStartedMessage('{"tokensIn":100}', 1000), // Only tokensIn
				createApiReqStartedMessage('{"tokensOut":200}', 2000), // Only tokensOut
				createApiReqStartedMessage('{"cacheWrites":5}', 3000), // Only cacheWrites
				createApiReqStartedMessage('{"cacheReads":10}', 4000), // Only cacheReads
				createApiReqStartedMessage('{"cost":0.005}', 5000), // Only cost
			]

			const result = getApiMetrics(messages)

			expect(result.totalTokensIn).toBe(100)
			expect(result.totalTokensOut).toBe(200)
			expect(result.totalCacheWrites).toBe(5)
			expect(result.totalCacheReads).toBe(10)
			expect(result.totalCost).toBe(0.005)

			// The implementation will use the last message with tokens for contextTokens
			// In this case, it's the cacheReads message
			expect(result.contextTokens).toBe(10)
		})

		it("should handle non-number values in api_req_started message", () => {
			const messages: ClineMessage[] = [
				// Use string values that can be parsed as JSON but aren't valid numbers for the metrics
				createApiReqStartedMessage(
					'{"tokensIn":"not-a-number","tokensOut":"not-a-number","cacheWrites":"not-a-number","cacheReads":"not-a-number","cost":"not-a-number"}',
				),
			]

			const result = getApiMetrics(messages)

			// Non-number values should be ignored
			expect(result.totalTokensIn).toBe(0)
			expect(result.totalTokensOut).toBe(0)
			expect(result.totalCacheWrites).toBeUndefined()
			expect(result.totalCacheReads).toBeUndefined()
			expect(result.totalCost).toBe(0)

			// The implementation concatenates string values for contextTokens
			expect(result.contextTokens).toBe("not-a-numbernot-a-numbernot-a-numbernot-a-number")
		})
	})

	describe("Context tokens calculation", () => {
		it("should calculate contextTokens from the last api_req_started message", () => {
			const messages: ClineMessage[] = [
				createApiReqStartedMessage('{"tokensIn":100,"tokensOut":200,"cacheWrites":5,"cacheReads":10}', 1000),
				createApiReqStartedMessage('{"tokensIn":50,"tokensOut":150,"cacheWrites":3,"cacheReads":7}', 2000),
			]

			const result = getApiMetrics(messages)

			// Should use the values from the last api_req_started message
			expect(result.contextTokens).toBe(210) // 50 + 150 + 3 + 7
		})

		it("should calculate contextTokens from the last condense_context message", () => {
			const messages: ClineMessage[] = [
				createApiReqStartedMessage('{"tokensIn":100,"tokensOut":200,"cacheWrites":5,"cacheReads":10}', 1000),
				createCondenseContextMessage(0.002, 500, 1000, 2000),
			]

			const result = getApiMetrics(messages)

			// Should use newContextTokens from the last condense_context message
			expect(result.contextTokens).toBe(500)
		})

		it("should prioritize the last message for contextTokens calculation", () => {
			const messages: ClineMessage[] = [
				createCondenseContextMessage(0.002, 500, 1000, 1000),
				createApiReqStartedMessage('{"tokensIn":100,"tokensOut":200,"cacheWrites":5,"cacheReads":10}', 2000),
				createCondenseContextMessage(0.003, 400, 800, 3000),
				createApiReqStartedMessage('{"tokensIn":50,"tokensOut":150,"cacheWrites":3,"cacheReads":7}', 4000),
			]

			const result = getApiMetrics(messages)

			// Should use the values from the last api_req_started message
			expect(result.contextTokens).toBe(210) // 50 + 150 + 3 + 7
		})

		it("should handle missing values when calculating contextTokens", () => {
			// We need to mock console.error to avoid polluting test output
			const originalConsoleError = console.error
			console.error = vi.fn()

			const messages: ClineMessage[] = [
				createApiReqStartedMessage('{"tokensIn":null,"cacheWrites":5,"cacheReads":10}', 1000),
			]

			const result = getApiMetrics(messages)

			// Should handle missing or invalid values
			expect(result.contextTokens).toBe(15) // 0 + 0 + 5 + 10

			// Restore console.error
			console.error = originalConsoleError
		})
	})
})
