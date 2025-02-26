// npx jest src/core/sliding-window/__tests__/sliding-window.test.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { ModelInfo } from "../../../shared/api"
import { truncateConversation, truncateConversationIfNeeded } from "../index"

/**
 * Tests for the truncateConversation function
 */
describe("truncateConversation", () => {
	it("should retain the first message", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "First message" },
			{ role: "assistant", content: "Second message" },
			{ role: "user", content: "Third message" },
		]

		const result = truncateConversation(messages, 0.5)

		// With 2 messages after the first, 0.5 fraction means remove 1 message
		// But 1 is odd, so it rounds down to 0 (to make it even)
		expect(result.length).toBe(3) // First message + 2 remaining messages
		expect(result[0]).toEqual(messages[0])
		expect(result[1]).toEqual(messages[1])
		expect(result[2]).toEqual(messages[2])
	})

	it("should remove the specified fraction of messages (rounded to even number)", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "First message" },
			{ role: "assistant", content: "Second message" },
			{ role: "user", content: "Third message" },
			{ role: "assistant", content: "Fourth message" },
			{ role: "user", content: "Fifth message" },
		]

		// 4 messages excluding first, 0.5 fraction = 2 messages to remove
		// 2 is already even, so no rounding needed
		const result = truncateConversation(messages, 0.5)

		expect(result.length).toBe(3)
		expect(result[0]).toEqual(messages[0])
		expect(result[1]).toEqual(messages[3])
		expect(result[2]).toEqual(messages[4])
	})

	it("should round to an even number of messages to remove", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "First message" },
			{ role: "assistant", content: "Second message" },
			{ role: "user", content: "Third message" },
			{ role: "assistant", content: "Fourth message" },
			{ role: "user", content: "Fifth message" },
			{ role: "assistant", content: "Sixth message" },
			{ role: "user", content: "Seventh message" },
		]

		// 6 messages excluding first, 0.3 fraction = 1.8 messages to remove
		// 1.8 rounds down to 1, then to 0 to make it even
		const result = truncateConversation(messages, 0.3)

		expect(result.length).toBe(7) // No messages removed
		expect(result).toEqual(messages)
	})

	it("should handle edge case with fracToRemove = 0", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "First message" },
			{ role: "assistant", content: "Second message" },
			{ role: "user", content: "Third message" },
		]

		const result = truncateConversation(messages, 0)

		expect(result).toEqual(messages)
	})

	it("should handle edge case with fracToRemove = 1", () => {
		const messages: Anthropic.Messages.MessageParam[] = [
			{ role: "user", content: "First message" },
			{ role: "assistant", content: "Second message" },
			{ role: "user", content: "Third message" },
			{ role: "assistant", content: "Fourth message" },
		]

		// 3 messages excluding first, 1.0 fraction = 3 messages to remove
		// But 3 is odd, so it rounds down to 2 to make it even
		const result = truncateConversation(messages, 1)

		expect(result.length).toBe(2)
		expect(result[0]).toEqual(messages[0])
		expect(result[1]).toEqual(messages[3])
	})
})

/**
 * Tests for the getMaxTokens function (private but tested through truncateConversationIfNeeded)
 */
describe("getMaxTokens", () => {
	// We'll test this indirectly through truncateConversationIfNeeded
	const createModelInfo = (contextWindow: number, maxTokens?: number): ModelInfo => ({
		contextWindow,
		supportsPromptCache: true, // Not relevant for getMaxTokens
		maxTokens,
	})

	// Reuse across tests for consistency
	const messages: Anthropic.Messages.MessageParam[] = [
		{ role: "user", content: "First message" },
		{ role: "assistant", content: "Second message" },
		{ role: "user", content: "Third message" },
		{ role: "assistant", content: "Fourth message" },
		{ role: "user", content: "Fifth message" },
	]

	it("should use maxTokens as buffer when specified", () => {
		const modelInfo = createModelInfo(100000, 50000)
		// Max tokens = 100000 - 50000 = 50000

		// Below max tokens - no truncation
		const result1 = truncateConversationIfNeeded({
			messages,
			totalTokens: 49999,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
		})
		expect(result1).toEqual(messages)

		// Above max tokens - truncate
		const result2 = truncateConversationIfNeeded({
			messages,
			totalTokens: 50001,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
		})
		expect(result2).not.toEqual(messages)
		expect(result2.length).toBe(3) // Truncated with 0.5 fraction
	})

	it("should use 20% of context window as buffer when maxTokens is undefined", () => {
		const modelInfo = createModelInfo(100000, undefined)
		// Max tokens = 100000 - (100000 * 0.2) = 80000

		// Below max tokens - no truncation
		const result1 = truncateConversationIfNeeded({
			messages,
			totalTokens: 79999,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
		})
		expect(result1).toEqual(messages)

		// Above max tokens - truncate
		const result2 = truncateConversationIfNeeded({
			messages,
			totalTokens: 80001,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
		})
		expect(result2).not.toEqual(messages)
		expect(result2.length).toBe(3) // Truncated with 0.5 fraction
	})

	it("should handle small context windows appropriately", () => {
		const modelInfo = createModelInfo(50000, 10000)
		// Max tokens = 50000 - 10000 = 40000

		// Below max tokens - no truncation
		const result1 = truncateConversationIfNeeded({
			messages,
			totalTokens: 39999,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
		})
		expect(result1).toEqual(messages)

		// Above max tokens - truncate
		const result2 = truncateConversationIfNeeded({
			messages,
			totalTokens: 40001,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
		})
		expect(result2).not.toEqual(messages)
		expect(result2.length).toBe(3) // Truncated with 0.5 fraction
	})

	it("should handle large context windows appropriately", () => {
		const modelInfo = createModelInfo(200000, 30000)
		// Max tokens = 200000 - 30000 = 170000

		// Below max tokens - no truncation
		const result1 = truncateConversationIfNeeded({
			messages,
			totalTokens: 169999,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
		})
		expect(result1).toEqual(messages)

		// Above max tokens - truncate
		const result2 = truncateConversationIfNeeded({
			messages,
			totalTokens: 170001,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
		})
		expect(result2).not.toEqual(messages)
		expect(result2.length).toBe(3) // Truncated with 0.5 fraction
	})
})

/**
 * Tests for the truncateConversationIfNeeded function
 */
describe("truncateConversationIfNeeded", () => {
	const createModelInfo = (contextWindow: number, supportsPromptCache: boolean, maxTokens?: number): ModelInfo => ({
		contextWindow,
		supportsPromptCache,
		maxTokens,
	})

	const messages: Anthropic.Messages.MessageParam[] = [
		{ role: "user", content: "First message" },
		{ role: "assistant", content: "Second message" },
		{ role: "user", content: "Third message" },
		{ role: "assistant", content: "Fourth message" },
		{ role: "user", content: "Fifth message" },
	]

	it("should not truncate if tokens are below max tokens threshold", () => {
		const modelInfo = createModelInfo(100000, true, 30000)
		const maxTokens = 100000 - 30000 // 70000
		const totalTokens = 69999 // Below threshold

		const result = truncateConversationIfNeeded({
			messages,
			totalTokens,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
		})
		expect(result).toEqual(messages) // No truncation occurs
	})

	it("should truncate if tokens are above max tokens threshold", () => {
		const modelInfo = createModelInfo(100000, true, 30000)
		const maxTokens = 100000 - 30000 // 70000
		const totalTokens = 70001 // Above threshold

		// When truncating, always uses 0.5 fraction
		// With 4 messages after the first, 0.5 fraction means remove 2 messages
		const expectedResult = [messages[0], messages[3], messages[4]]

		const result = truncateConversationIfNeeded({
			messages,
			totalTokens,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
		})
		expect(result).toEqual(expectedResult)
	})

	it("should work with non-prompt caching models the same as prompt caching models", () => {
		// The implementation no longer differentiates between prompt caching and non-prompt caching models
		const modelInfo1 = createModelInfo(100000, true, 30000)
		const modelInfo2 = createModelInfo(100000, false, 30000)

		// Test below threshold
		const belowThreshold = 69999
		expect(
			truncateConversationIfNeeded({
				messages,
				totalTokens: belowThreshold,
				contextWindow: modelInfo1.contextWindow,
				maxTokens: modelInfo1.maxTokens,
			}),
		).toEqual(
			truncateConversationIfNeeded({
				messages,
				totalTokens: belowThreshold,
				contextWindow: modelInfo2.contextWindow,
				maxTokens: modelInfo2.maxTokens,
			}),
		)

		// Test above threshold
		const aboveThreshold = 70001
		expect(
			truncateConversationIfNeeded({
				messages,
				totalTokens: aboveThreshold,
				contextWindow: modelInfo1.contextWindow,
				maxTokens: modelInfo1.maxTokens,
			}),
		).toEqual(
			truncateConversationIfNeeded({
				messages,
				totalTokens: aboveThreshold,
				contextWindow: modelInfo2.contextWindow,
				maxTokens: modelInfo2.maxTokens,
			}),
		)
	})
})
