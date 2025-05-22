// npx jest src/core/sliding-window/__tests__/sliding-window.test.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { ModelInfo } from "../../../shared/api"
import { BaseProvider } from "../../../api/providers/base-provider"
import {
	TOKEN_BUFFER_PERCENTAGE,
	estimateTokenCount,
	truncateConversation,
	truncateConversationIfNeeded,
} from "../index"
import { ApiMessage } from "../../task-persistence/apiMessages"
import * as condenseModule from "../../condense"

// Create a mock ApiHandler for testing
class MockApiHandler extends BaseProvider {
	createMessage(): any {
		throw new Error("Method not implemented.")
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "test-model",
			info: {
				contextWindow: 100000,
				maxTokens: 50000,
				supportsPromptCache: true,
				supportsImages: false,
				inputPrice: 0,
				outputPrice: 0,
				description: "Test model",
			},
		}
	}
}

// Create a singleton instance for tests
const mockApiHandler = new MockApiHandler()
const taskId = "test-task-id"

/**
 * Tests for the truncateConversation function
 */
describe("truncateConversation", () => {
	it("should retain the first message", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "First message" },
			{ role: "assistant", content: "Second message" },
			{ role: "user", content: "Third message" },
		]

		const result = truncateConversation(messages, 0.5, taskId)

		// With 2 messages after the first, 0.5 fraction means remove 1 message
		// But 1 is odd, so it rounds down to 0 (to make it even)
		expect(result.length).toBe(3) // First message + 2 remaining messages
		expect(result[0]).toEqual(messages[0])
		expect(result[1]).toEqual(messages[1])
		expect(result[2]).toEqual(messages[2])
	})

	it("should remove the specified fraction of messages (rounded to even number)", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "First message" },
			{ role: "assistant", content: "Second message" },
			{ role: "user", content: "Third message" },
			{ role: "assistant", content: "Fourth message" },
			{ role: "user", content: "Fifth message" },
		]

		// 4 messages excluding first, 0.5 fraction = 2 messages to remove
		// 2 is already even, so no rounding needed
		const result = truncateConversation(messages, 0.5, taskId)

		expect(result.length).toBe(3)
		expect(result[0]).toEqual(messages[0])
		expect(result[1]).toEqual(messages[3])
		expect(result[2]).toEqual(messages[4])
	})

	it("should round to an even number of messages to remove", () => {
		const messages: ApiMessage[] = [
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
		const result = truncateConversation(messages, 0.3, taskId)

		expect(result.length).toBe(7) // No messages removed
		expect(result).toEqual(messages)
	})

	it("should handle edge case with fracToRemove = 0", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "First message" },
			{ role: "assistant", content: "Second message" },
			{ role: "user", content: "Third message" },
		]

		const result = truncateConversation(messages, 0, taskId)

		expect(result).toEqual(messages)
	})

	it("should handle edge case with fracToRemove = 1", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "First message" },
			{ role: "assistant", content: "Second message" },
			{ role: "user", content: "Third message" },
			{ role: "assistant", content: "Fourth message" },
		]

		// 3 messages excluding first, 1.0 fraction = 3 messages to remove
		// But 3 is odd, so it rounds down to 2 to make it even
		const result = truncateConversation(messages, 1, taskId)

		expect(result.length).toBe(2)
		expect(result[0]).toEqual(messages[0])
		expect(result[1]).toEqual(messages[3])
	})
})

/**
 * Tests for the estimateTokenCount function
 */
describe("estimateTokenCount", () => {
	it("should return 0 for empty or undefined content", async () => {
		expect(await estimateTokenCount([], mockApiHandler)).toBe(0)
		// @ts-ignore - Testing with undefined
		expect(await estimateTokenCount(undefined, mockApiHandler)).toBe(0)
	})

	it("should estimate tokens for text blocks", async () => {
		const content: Array<Anthropic.Messages.ContentBlockParam> = [
			{ type: "text", text: "This is a text block with 36 characters" },
		]

		// With tiktoken, the exact token count may differ from character-based estimation
		// Instead of expecting an exact number, we verify it's a reasonable positive number
		const result = await estimateTokenCount(content, mockApiHandler)
		expect(result).toBeGreaterThan(0)

		// We can also verify that longer text results in more tokens
		const longerContent: Array<Anthropic.Messages.ContentBlockParam> = [
			{
				type: "text",
				text: "This is a longer text block with significantly more characters to encode into tokens",
			},
		]
		const longerResult = await estimateTokenCount(longerContent, mockApiHandler)
		expect(longerResult).toBeGreaterThan(result)
	})

	it("should estimate tokens for image blocks based on data size", async () => {
		// Small image
		const smallImage: Array<Anthropic.Messages.ContentBlockParam> = [
			{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "small_dummy_data" } },
		]
		// Larger image with more data
		const largerImage: Array<Anthropic.Messages.ContentBlockParam> = [
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "X".repeat(1000) } },
		]

		// Verify the token count scales with the size of the image data
		const smallImageTokens = await estimateTokenCount(smallImage, mockApiHandler)
		const largerImageTokens = await estimateTokenCount(largerImage, mockApiHandler)

		// Small image should have some tokens
		expect(smallImageTokens).toBeGreaterThan(0)

		// Larger image should have proportionally more tokens
		expect(largerImageTokens).toBeGreaterThan(smallImageTokens)

		// Verify the larger image calculation matches our formula including the 50% fudge factor
		expect(largerImageTokens).toBe(48)
	})

	it("should estimate tokens for mixed content blocks", async () => {
		const content: Array<Anthropic.Messages.ContentBlockParam> = [
			{ type: "text", text: "A text block with 30 characters" },
			{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "dummy_data" } },
			{ type: "text", text: "Another text with 24 chars" },
		]

		// We know image tokens calculation should be consistent
		const imageTokens = Math.ceil(Math.sqrt("dummy_data".length)) * 1.5

		// With tiktoken, we can't predict exact text token counts,
		// but we can verify the total is greater than just the image tokens
		const result = await estimateTokenCount(content, mockApiHandler)
		expect(result).toBeGreaterThan(imageTokens)

		// Also test against a version with only the image to verify text adds tokens
		const imageOnlyContent: Array<Anthropic.Messages.ContentBlockParam> = [
			{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "dummy_data" } },
		]
		const imageOnlyResult = await estimateTokenCount(imageOnlyContent, mockApiHandler)
		expect(result).toBeGreaterThan(imageOnlyResult)
	})

	it("should handle empty text blocks", async () => {
		const content: Array<Anthropic.Messages.ContentBlockParam> = [{ type: "text", text: "" }]
		expect(await estimateTokenCount(content, mockApiHandler)).toBe(0)
	})

	it("should handle plain string messages", async () => {
		const content = "This is a plain text message"
		expect(await estimateTokenCount([{ type: "text", text: content }], mockApiHandler)).toBeGreaterThan(0)
	})
})

/**
 * Tests for the truncateConversationIfNeeded function
 */
describe("truncateConversationIfNeeded", () => {
	const createModelInfo = (contextWindow: number, maxTokens?: number): ModelInfo => ({
		contextWindow,
		supportsPromptCache: true,
		maxTokens,
	})

	const messages: ApiMessage[] = [
		{ role: "user", content: "First message" },
		{ role: "assistant", content: "Second message" },
		{ role: "user", content: "Third message" },
		{ role: "assistant", content: "Fourth message" },
		{ role: "user", content: "Fifth message" },
	]

	it("should not truncate if tokens are below max tokens threshold", async () => {
		const modelInfo = createModelInfo(100000, 30000)
		const dynamicBuffer = modelInfo.contextWindow * TOKEN_BUFFER_PERCENTAGE // 10000
		const totalTokens = 70000 - dynamicBuffer - 1 // Just below threshold - buffer

		// Create messages with very small content in the last one to avoid token overflow
		const messagesWithSmallContent = [...messages.slice(0, -1), { ...messages[messages.length - 1], content: "" }]

		const result = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})

		// Check the new return type
		expect(result).toEqual({
			messages: messagesWithSmallContent,
			summary: "",
			cost: 0,
			prevContextTokens: totalTokens,
		})
	})

	it("should truncate if tokens are above max tokens threshold", async () => {
		const modelInfo = createModelInfo(100000, 30000)
		const totalTokens = 70001 // Above threshold

		// Create messages with very small content in the last one to avoid token overflow
		const messagesWithSmallContent = [...messages.slice(0, -1), { ...messages[messages.length - 1], content: "" }]

		// When truncating, always uses 0.5 fraction
		// With 4 messages after the first, 0.5 fraction means remove 2 messages
		const expectedMessages = [messagesWithSmallContent[0], messagesWithSmallContent[3], messagesWithSmallContent[4]]

		const result = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})

		expect(result).toEqual({
			messages: expectedMessages,
			summary: "",
			cost: 0,
			prevContextTokens: totalTokens,
		})
	})

	it("should work with non-prompt caching models the same as prompt caching models", async () => {
		// The implementation no longer differentiates between prompt caching and non-prompt caching models
		const modelInfo1 = createModelInfo(100000, 30000)
		const modelInfo2 = createModelInfo(100000, 30000)

		// Create messages with very small content in the last one to avoid token overflow
		const messagesWithSmallContent = [...messages.slice(0, -1), { ...messages[messages.length - 1], content: "" }]

		// Test below threshold
		const belowThreshold = 69999
		const result1 = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens: belowThreshold,
			contextWindow: modelInfo1.contextWindow,
			maxTokens: modelInfo1.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})

		const result2 = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens: belowThreshold,
			contextWindow: modelInfo2.contextWindow,
			maxTokens: modelInfo2.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})

		expect(result1.messages).toEqual(result2.messages)
		expect(result1.summary).toEqual(result2.summary)
		expect(result1.cost).toEqual(result2.cost)
		expect(result1.prevContextTokens).toEqual(result2.prevContextTokens)

		// Test above threshold
		const aboveThreshold = 70001
		const result3 = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens: aboveThreshold,
			contextWindow: modelInfo1.contextWindow,
			maxTokens: modelInfo1.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})

		const result4 = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens: aboveThreshold,
			contextWindow: modelInfo2.contextWindow,
			maxTokens: modelInfo2.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})

		expect(result3.messages).toEqual(result4.messages)
		expect(result3.summary).toEqual(result4.summary)
		expect(result3.cost).toEqual(result4.cost)
		expect(result3.prevContextTokens).toEqual(result4.prevContextTokens)
	})

	it("should consider incoming content when deciding to truncate", async () => {
		const modelInfo = createModelInfo(100000, 30000)
		const maxTokens = 30000
		const availableTokens = modelInfo.contextWindow - maxTokens

		// Test case 1: Small content that won't push us over the threshold
		const smallContent = [{ type: "text" as const, text: "Small content" }]
		const smallContentTokens = await estimateTokenCount(smallContent, mockApiHandler)
		const messagesWithSmallContent: ApiMessage[] = [
			...messages.slice(0, -1),
			{ role: messages[messages.length - 1].role, content: smallContent },
		]

		// Set base tokens so total is well below threshold + buffer even with small content added
		const dynamicBuffer = modelInfo.contextWindow * TOKEN_BUFFER_PERCENTAGE
		const baseTokensForSmall = availableTokens - smallContentTokens - dynamicBuffer - 10
		const resultWithSmall = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens: baseTokensForSmall,
			contextWindow: modelInfo.contextWindow,
			maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})
		expect(resultWithSmall).toEqual({
			messages: messagesWithSmallContent,
			summary: "",
			cost: 0,
			prevContextTokens: baseTokensForSmall + smallContentTokens,
		}) // No truncation

		// Test case 2: Large content that will push us over the threshold
		const largeContent = [
			{
				type: "text" as const,
				text: "A very large incoming message that would consume a significant number of tokens and push us over the threshold",
			},
		]
		const largeContentTokens = await estimateTokenCount(largeContent, mockApiHandler)
		const messagesWithLargeContent: ApiMessage[] = [
			...messages.slice(0, -1),
			{ role: messages[messages.length - 1].role, content: largeContent },
		]

		// Set base tokens so we're just below threshold without content, but over with content
		const baseTokensForLarge = availableTokens - Math.floor(largeContentTokens / 2)
		const resultWithLarge = await truncateConversationIfNeeded({
			messages: messagesWithLargeContent,
			totalTokens: baseTokensForLarge,
			contextWindow: modelInfo.contextWindow,
			maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})
		expect(resultWithLarge.messages).not.toEqual(messagesWithLargeContent) // Should truncate
		expect(resultWithLarge.summary).toBe("")
		expect(resultWithLarge.cost).toBe(0)
		expect(resultWithLarge.prevContextTokens).toBe(baseTokensForLarge + largeContentTokens)

		// Test case 3: Very large content that will definitely exceed threshold
		const veryLargeContent = [{ type: "text" as const, text: "X".repeat(1000) }]
		const veryLargeContentTokens = await estimateTokenCount(veryLargeContent, mockApiHandler)
		const messagesWithVeryLargeContent: ApiMessage[] = [
			...messages.slice(0, -1),
			{ role: messages[messages.length - 1].role, content: veryLargeContent },
		]

		// Set base tokens so we're just below threshold without content
		const baseTokensForVeryLarge = availableTokens - Math.floor(veryLargeContentTokens / 2)
		const resultWithVeryLarge = await truncateConversationIfNeeded({
			messages: messagesWithVeryLargeContent,
			totalTokens: baseTokensForVeryLarge,
			contextWindow: modelInfo.contextWindow,
			maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})
		expect(resultWithVeryLarge.messages).not.toEqual(messagesWithVeryLargeContent) // Should truncate
		expect(resultWithVeryLarge.summary).toBe("")
		expect(resultWithVeryLarge.cost).toBe(0)
		expect(resultWithVeryLarge.prevContextTokens).toBe(baseTokensForVeryLarge + veryLargeContentTokens)
	})

	it("should truncate if tokens are within TOKEN_BUFFER_PERCENTAGE of the threshold", async () => {
		const modelInfo = createModelInfo(100000, 30000)
		const dynamicBuffer = modelInfo.contextWindow * TOKEN_BUFFER_PERCENTAGE // 10% of 100000 = 10000
		const totalTokens = 70000 - dynamicBuffer + 1 // Just within the dynamic buffer of threshold (70000)

		// Create messages with very small content in the last one to avoid token overflow
		const messagesWithSmallContent = [...messages.slice(0, -1), { ...messages[messages.length - 1], content: "" }]

		// When truncating, always uses 0.5 fraction
		// With 4 messages after the first, 0.5 fraction means remove 2 messages
		const expectedResult = [messagesWithSmallContent[0], messagesWithSmallContent[3], messagesWithSmallContent[4]]

		const result = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})
		expect(result).toEqual({
			messages: expectedResult,
			summary: "",
			cost: 0,
			prevContextTokens: totalTokens,
		})
	})

	it("should use summarizeConversation when autoCondenseContext is true and tokens exceed threshold", async () => {
		// Mock the summarizeConversation function
		const mockSummary = "This is a summary of the conversation"
		const mockCost = 0.05
		const mockSummarizeResponse: condenseModule.SummarizeResponse = {
			messages: [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: mockSummary, isSummary: true },
				{ role: "user", content: "Last message" },
			],
			summary: mockSummary,
			cost: mockCost,
			newContextTokens: 100,
		}

		const summarizeSpy = jest
			.spyOn(condenseModule, "summarizeConversation")
			.mockResolvedValue(mockSummarizeResponse)

		const modelInfo = createModelInfo(100000, 30000)
		const totalTokens = 70001 // Above threshold
		const messagesWithSmallContent = [...messages.slice(0, -1), { ...messages[messages.length - 1], content: "" }]

		const result = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: true,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})

		// Verify summarizeConversation was called with the right parameters
		expect(summarizeSpy).toHaveBeenCalledWith(
			messagesWithSmallContent,
			mockApiHandler,
			"System prompt",
			taskId,
			true,
			undefined, // customCondensingPrompt
			undefined, // condensingApiHandler
		)

		// Verify the result contains the summary information
		expect(result).toMatchObject({
			messages: mockSummarizeResponse.messages,
			summary: mockSummary,
			cost: mockCost,
			prevContextTokens: totalTokens,
		})
		// newContextTokens might be present, but we don't need to verify its exact value

		// Clean up
		summarizeSpy.mockRestore()
	})

	it("should fall back to truncateConversation when autoCondenseContext is true but summarization fails", async () => {
		// Mock the summarizeConversation function to return empty summary
		const mockSummarizeResponse: condenseModule.SummarizeResponse = {
			messages: messages, // Original messages unchanged
			summary: "", // Empty summary indicates failure
			cost: 0.01,
		}

		const summarizeSpy = jest
			.spyOn(condenseModule, "summarizeConversation")
			.mockResolvedValue(mockSummarizeResponse)

		const modelInfo = createModelInfo(100000, 30000)
		const totalTokens = 70001 // Above threshold
		const messagesWithSmallContent = [...messages.slice(0, -1), { ...messages[messages.length - 1], content: "" }]

		// When truncating, always uses 0.5 fraction
		// With 4 messages after the first, 0.5 fraction means remove 2 messages
		const expectedMessages = [messagesWithSmallContent[0], messagesWithSmallContent[3], messagesWithSmallContent[4]]

		const result = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: true,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})

		// Verify summarizeConversation was called
		expect(summarizeSpy).toHaveBeenCalled()

		// Verify it fell back to truncation
		expect(result.messages).toEqual(expectedMessages)
		expect(result.summary).toBe("")
		expect(result.prevContextTokens).toBe(totalTokens)
		// The cost might be different than expected, so we don't check it

		// Clean up
		summarizeSpy.mockRestore()
	})

	it("should not call summarizeConversation when autoCondenseContext is false", async () => {
		// Reset any previous mock calls
		jest.clearAllMocks()
		const summarizeSpy = jest.spyOn(condenseModule, "summarizeConversation")

		const modelInfo = createModelInfo(100000, 30000)
		const totalTokens = 70001 // Above threshold
		const messagesWithSmallContent = [...messages.slice(0, -1), { ...messages[messages.length - 1], content: "" }]

		// When truncating, always uses 0.5 fraction
		// With 4 messages after the first, 0.5 fraction means remove 2 messages
		const expectedMessages = [messagesWithSmallContent[0], messagesWithSmallContent[3], messagesWithSmallContent[4]]

		const result = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens,
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 50, // This shouldn't matter since autoCondenseContext is false
			systemPrompt: "System prompt",
			taskId,
		})

		// Verify summarizeConversation was not called
		expect(summarizeSpy).not.toHaveBeenCalled()

		// Verify it used truncation
		expect(result).toEqual({
			messages: expectedMessages,
			summary: "",
			cost: 0,
			prevContextTokens: totalTokens,
		})

		// Clean up
		summarizeSpy.mockRestore()
	})

	it("should use summarizeConversation when autoCondenseContext is true and context percent exceeds threshold", async () => {
		// Mock the summarizeConversation function
		const mockSummary = "This is a summary of the conversation"
		const mockCost = 0.05
		const mockSummarizeResponse: condenseModule.SummarizeResponse = {
			messages: [
				{ role: "user", content: "First message" },
				{ role: "assistant", content: mockSummary, isSummary: true },
				{ role: "user", content: "Last message" },
			],
			summary: mockSummary,
			cost: mockCost,
			newContextTokens: 100,
		}

		const summarizeSpy = jest
			.spyOn(condenseModule, "summarizeConversation")
			.mockResolvedValue(mockSummarizeResponse)

		const modelInfo = createModelInfo(100000, 30000)
		// Set tokens to be below the allowedTokens threshold but above the percentage threshold
		const contextWindow = modelInfo.contextWindow
		const totalTokens = 60000 // Below allowedTokens but 60% of context window
		const messagesWithSmallContent = [...messages.slice(0, -1), { ...messages[messages.length - 1], content: "" }]

		const result = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens,
			contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: true,
			autoCondenseContextPercent: 50, // Set threshold to 50% - our tokens are at 60%
			systemPrompt: "System prompt",
			taskId,
		})

		// Verify summarizeConversation was called with the right parameters
		expect(summarizeSpy).toHaveBeenCalledWith(
			messagesWithSmallContent,
			mockApiHandler,
			"System prompt",
			taskId,
			true,
			undefined, // customCondensingPrompt
			undefined, // condensingApiHandler
		)

		// Verify the result contains the summary information
		expect(result).toMatchObject({
			messages: mockSummarizeResponse.messages,
			summary: mockSummary,
			cost: mockCost,
			prevContextTokens: totalTokens,
		})

		// Clean up
		summarizeSpy.mockRestore()
	})

	it("should not use summarizeConversation when autoCondenseContext is true but context percent is below threshold", async () => {
		// Reset any previous mock calls
		jest.clearAllMocks()
		const summarizeSpy = jest.spyOn(condenseModule, "summarizeConversation")

		const modelInfo = createModelInfo(100000, 30000)
		// Set tokens to be below both the allowedTokens threshold and the percentage threshold
		const contextWindow = modelInfo.contextWindow
		const totalTokens = 40000 // 40% of context window
		const messagesWithSmallContent = [...messages.slice(0, -1), { ...messages[messages.length - 1], content: "" }]

		const result = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens,
			contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: true,
			autoCondenseContextPercent: 50, // Set threshold to 50% - our tokens are at 40%
			systemPrompt: "System prompt",
			taskId,
		})

		// Verify summarizeConversation was not called
		expect(summarizeSpy).not.toHaveBeenCalled()

		// Verify no truncation or summarization occurred
		expect(result).toEqual({
			messages: messagesWithSmallContent,
			summary: "",
			cost: 0,
			prevContextTokens: totalTokens,
		})

		// Clean up
		summarizeSpy.mockRestore()
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
	const messages: ApiMessage[] = [
		{ role: "user", content: "First message" },
		{ role: "assistant", content: "Second message" },
		{ role: "user", content: "Third message" },
		{ role: "assistant", content: "Fourth message" },
		{ role: "user", content: "Fifth message" },
	]

	it("should use maxTokens as buffer when specified", async () => {
		const modelInfo = createModelInfo(100000, 50000)
		// Max tokens = 100000 - 50000 = 50000

		// Create messages with very small content in the last one to avoid token overflow
		const messagesWithSmallContent = [...messages.slice(0, -1), { ...messages[messages.length - 1], content: "" }]

		// Account for the dynamic buffer which is 10% of context window (10,000 tokens)
		// Below max tokens and buffer - no truncation
		const result1 = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens: 39999, // Well below threshold + dynamic buffer
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})
		expect(result1).toEqual({
			messages: messagesWithSmallContent,
			summary: "",
			cost: 0,
			prevContextTokens: 39999,
		})

		// Above max tokens - truncate
		const result2 = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens: 50001, // Above threshold
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})
		expect(result2.messages).not.toEqual(messagesWithSmallContent)
		expect(result2.messages.length).toBe(3) // Truncated with 0.5 fraction
		expect(result2.summary).toBe("")
		expect(result2.cost).toBe(0)
		expect(result2.prevContextTokens).toBe(50001)
	})

	it("should use 20% of context window as buffer when maxTokens is undefined", async () => {
		const modelInfo = createModelInfo(100000, undefined)
		// Max tokens = 100000 - (100000 * 0.2) = 80000

		// Create messages with very small content in the last one to avoid token overflow
		const messagesWithSmallContent = [...messages.slice(0, -1), { ...messages[messages.length - 1], content: "" }]

		// Account for the dynamic buffer which is 10% of context window (10,000 tokens)
		// Below max tokens and buffer - no truncation
		const result1 = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens: 69999, // Well below threshold + dynamic buffer
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})
		expect(result1).toEqual({
			messages: messagesWithSmallContent,
			summary: "",
			cost: 0,
			prevContextTokens: 69999,
		})

		// Above max tokens - truncate
		const result2 = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens: 80001, // Above threshold
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})
		expect(result2.messages).not.toEqual(messagesWithSmallContent)
		expect(result2.messages.length).toBe(3) // Truncated with 0.5 fraction
		expect(result2.summary).toBe("")
		expect(result2.cost).toBe(0)
		expect(result2.prevContextTokens).toBe(80001)
	})

	it("should handle small context windows appropriately", async () => {
		const modelInfo = createModelInfo(50000, 10000)
		// Max tokens = 50000 - 10000 = 40000

		// Create messages with very small content in the last one to avoid token overflow
		const messagesWithSmallContent = [...messages.slice(0, -1), { ...messages[messages.length - 1], content: "" }]

		// Below max tokens and buffer - no truncation
		const result1 = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens: 34999, // Well below threshold + buffer
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})
		expect(result1.messages).toEqual(messagesWithSmallContent)

		// Above max tokens - truncate
		const result2 = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens: 40001, // Above threshold
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})
		expect(result2).not.toEqual(messagesWithSmallContent)
		expect(result2.messages.length).toBe(3) // Truncated with 0.5 fraction
	})

	it("should handle large context windows appropriately", async () => {
		const modelInfo = createModelInfo(200000, 30000)
		// Max tokens = 200000 - 30000 = 170000

		// Create messages with very small content in the last one to avoid token overflow
		const messagesWithSmallContent = [...messages.slice(0, -1), { ...messages[messages.length - 1], content: "" }]

		// Account for the dynamic buffer which is 10% of context window (20,000 tokens for this test)
		// Below max tokens and buffer - no truncation
		const result1 = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens: 149999, // Well below threshold + dynamic buffer
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})
		expect(result1.messages).toEqual(messagesWithSmallContent)

		// Above max tokens - truncate
		const result2 = await truncateConversationIfNeeded({
			messages: messagesWithSmallContent,
			totalTokens: 170001, // Above threshold
			contextWindow: modelInfo.contextWindow,
			maxTokens: modelInfo.maxTokens,
			apiHandler: mockApiHandler,
			autoCondenseContext: false,
			autoCondenseContextPercent: 100,
			systemPrompt: "System prompt",
			taskId,
		})
		expect(result2).not.toEqual(messagesWithSmallContent)
		expect(result2.messages.length).toBe(3) // Truncated with 0.5 fraction
	})
})
