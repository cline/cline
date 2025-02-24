// npx jest src/core/sliding-window/__tests__/sliding-window.test.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { ModelInfo } from "../../../shared/api"
import { truncateConversation, truncateConversationIfNeeded } from "../index"

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

	it("should not truncate if tokens are below threshold for prompt caching models", () => {
		const modelInfo = createModelInfo(200000, true, 50000)
		const totalTokens = 100000 // Below threshold
		const result = truncateConversationIfNeeded(messages, totalTokens, modelInfo)
		expect(result).toEqual(messages)
	})

	it("should not truncate if tokens are below threshold for non-prompt caching models", () => {
		const modelInfo = createModelInfo(200000, false)
		const totalTokens = 100000 // Below threshold
		const result = truncateConversationIfNeeded(messages, totalTokens, modelInfo)
		expect(result).toEqual(messages)
	})

	it("should use 80% of context window as threshold if it's greater than (contextWindow - buffer)", () => {
		const modelInfo = createModelInfo(50000, true) // Small context window
		const totalTokens = 40001 // Above 80% threshold (40000)
		const mockResult = [messages[0], messages[3], messages[4]]
		const result = truncateConversationIfNeeded(messages, totalTokens, modelInfo)
		expect(result).toEqual(mockResult)
	})
})
