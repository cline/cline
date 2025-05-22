import { describe, expect, it, jest, beforeEach } from "@jest/globals"
import { ApiHandler } from "../../../api"
import { ApiMessage } from "../../task-persistence/apiMessages"
import { maybeRemoveImageBlocks } from "../../../api/transform/image-cleaning"
import { summarizeConversation, getMessagesSinceLastSummary, N_MESSAGES_TO_KEEP } from "../index"
import { telemetryService } from "../../../services/telemetry/TelemetryService"

// Mock dependencies
jest.mock("../../../api/transform/image-cleaning", () => ({
	maybeRemoveImageBlocks: jest.fn((messages: ApiMessage[], _apiHandler: ApiHandler) => [...messages]),
}))

jest.mock("../../../services/telemetry/TelemetryService", () => ({
	telemetryService: {
		captureContextCondensed: jest.fn(),
	},
}))

const taskId = "test-task-id"

describe("getMessagesSinceLastSummary", () => {
	it("should return all messages when there is no summary", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
		]

		const result = getMessagesSinceLastSummary(messages)
		expect(result).toEqual(messages)
	})

	it("should return messages since the last summary", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "assistant", content: "Summary of conversation", ts: 3, isSummary: true },
			{ role: "user", content: "How are you?", ts: 4 },
			{ role: "assistant", content: "I'm good", ts: 5 },
		]

		const result = getMessagesSinceLastSummary(messages)
		expect(result).toEqual([
			{ role: "assistant", content: "Summary of conversation", ts: 3, isSummary: true },
			{ role: "user", content: "How are you?", ts: 4 },
			{ role: "assistant", content: "I'm good", ts: 5 },
		])
	})

	it("should handle multiple summary messages and return since the last one", () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "First summary", ts: 2, isSummary: true },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "Second summary", ts: 4, isSummary: true },
			{ role: "user", content: "What's new?", ts: 5 },
		]

		const result = getMessagesSinceLastSummary(messages)
		expect(result).toEqual([
			{ role: "assistant", content: "Second summary", ts: 4, isSummary: true },
			{ role: "user", content: "What's new?", ts: 5 },
		])
	})

	it("should handle empty messages array", () => {
		const result = getMessagesSinceLastSummary([])
		expect(result).toEqual([])
	})
})

describe("summarizeConversation", () => {
	// Mock ApiHandler
	let mockApiHandler: ApiHandler
	let mockStream: AsyncGenerator<any, void, unknown>

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Setup mock stream with usage information
		mockStream = (async function* () {
			yield { type: "text" as const, text: "This is " }
			yield { type: "text" as const, text: "a summary" }
			yield { type: "usage" as const, totalCost: 0.05, outputTokens: 150 }
		})()

		// Setup mock API handler
		mockApiHandler = {
			createMessage: jest.fn().mockReturnValue(mockStream),
			countTokens: jest.fn().mockImplementation(() => Promise.resolve(100)),
			getModel: jest.fn().mockReturnValue({
				id: "test-model",
				info: {
					contextWindow: 8000,
					supportsImages: true,
					supportsComputerUse: true,
					supportsVision: true,
					maxTokens: 4000,
					supportsPromptCache: true,
					maxCachePoints: 10,
					minTokensPerCachePoint: 100,
					cachableFields: ["system", "messages"],
				},
			}),
		} as unknown as ApiHandler
	})

	// Default system prompt for tests
	const defaultSystemPrompt = "You are a helpful assistant."

	it("should not summarize when there are not enough messages", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
		]

		const result = await summarizeConversation(messages, mockApiHandler, defaultSystemPrompt, taskId)
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.newContextTokens).toBeUndefined()
		expect(mockApiHandler.createMessage).not.toHaveBeenCalled()
	})

	it("should not summarize when there was a recent summary", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6, isSummary: true }, // Recent summary
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const result = await summarizeConversation(messages, mockApiHandler, defaultSystemPrompt, taskId)
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0)
		expect(result.summary).toBe("")
		expect(result.newContextTokens).toBeUndefined()
		expect(mockApiHandler.createMessage).not.toHaveBeenCalled()
	})

	it("should summarize conversation and insert summary message", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const result = await summarizeConversation(messages, mockApiHandler, defaultSystemPrompt, taskId)

		// Check that the API was called correctly
		expect(mockApiHandler.createMessage).toHaveBeenCalled()
		expect(maybeRemoveImageBlocks).toHaveBeenCalled()

		// Verify the structure of the result
		// The result should be: original messages (except last N) + summary + last N messages
		expect(result.messages.length).toBe(messages.length + 1) // Original + summary

		// Check that the summary message was inserted correctly
		const summaryMessage = result.messages[result.messages.length - N_MESSAGES_TO_KEEP - 1]
		expect(summaryMessage.role).toBe("assistant")
		expect(summaryMessage.content).toBe("This is a summary")
		expect(summaryMessage.isSummary).toBe(true)

		// Check that the last N_MESSAGES_TO_KEEP messages are preserved
		const lastMessages = messages.slice(-N_MESSAGES_TO_KEEP)
		expect(result.messages.slice(-N_MESSAGES_TO_KEEP)).toEqual(lastMessages)

		// Check the cost and token counts
		expect(result.cost).toBe(0.05)
		expect(result.summary).toBe("This is a summary")
		expect(result.newContextTokens).toBe(250) // 150 output tokens + 100 from countTokens
	})

	it("should handle empty summary response", async () => {
		// We need enough messages to trigger summarization
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		// Mock console.warn before we call the function
		const originalWarn = console.warn
		const mockWarn = jest.fn()
		console.warn = mockWarn

		// Setup empty summary response with usage information
		const emptyStream = (async function* () {
			yield { type: "text" as const, text: "" }
			yield { type: "usage" as const, totalCost: 0.02, outputTokens: 0 }
		})()

		// Create a new mock for createMessage that returns empty stream
		const createMessageMock = jest.fn().mockReturnValue(emptyStream)
		mockApiHandler.createMessage = createMessageMock as any

		// We need to mock maybeRemoveImageBlocks to return the expected messages
		;(maybeRemoveImageBlocks as jest.Mock).mockImplementationOnce((messages: any) => {
			return messages.map(({ role, content }: { role: string; content: any }) => ({ role, content }))
		})

		const result = await summarizeConversation(messages, mockApiHandler, defaultSystemPrompt, taskId)

		// Should return original messages when summary is empty
		expect(result.messages).toEqual(messages)
		expect(result.cost).toBe(0.02)
		expect(result.summary).toBe("")
		expect(mockWarn).toHaveBeenCalledWith("Received empty summary from API")

		// Restore console.warn
		console.warn = originalWarn
	})

	it("should correctly format the request to the API", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		await summarizeConversation(messages, mockApiHandler, defaultSystemPrompt, taskId)

		// Verify the final request message
		const expectedFinalMessage = {
			role: "user",
			content: "Summarize the conversation so far, as described in the prompt instructions.",
		}

		// Verify that createMessage was called with the correct prompt
		expect(mockApiHandler.createMessage).toHaveBeenCalledWith(
			expect.stringContaining("Your task is to create a detailed summary of the conversation"),
			expect.any(Array),
		)

		// Check that maybeRemoveImageBlocks was called with the correct messages
		const mockCallArgs = (maybeRemoveImageBlocks as jest.Mock).mock.calls[0][0] as any[]
		expect(mockCallArgs[mockCallArgs.length - 1]).toEqual(expectedFinalMessage)
	})

	it("should calculate newContextTokens correctly with systemPrompt", async () => {
		const messages: ApiMessage[] = [
			{ role: "user", content: "Hello", ts: 1 },
			{ role: "assistant", content: "Hi there", ts: 2 },
			{ role: "user", content: "How are you?", ts: 3 },
			{ role: "assistant", content: "I'm good", ts: 4 },
			{ role: "user", content: "What's new?", ts: 5 },
			{ role: "assistant", content: "Not much", ts: 6 },
			{ role: "user", content: "Tell me more", ts: 7 },
		]

		const systemPrompt = "You are a helpful assistant."

		// Create a stream with usage information
		const streamWithUsage = (async function* () {
			yield { type: "text" as const, text: "This is a summary with system prompt" }
			yield { type: "usage" as const, totalCost: 0.06, outputTokens: 200 }
		})()

		// Override the mock for this test
		mockApiHandler.createMessage = jest.fn().mockReturnValue(streamWithUsage) as any

		const result = await summarizeConversation(messages, mockApiHandler, systemPrompt, taskId)

		// Verify that countTokens was called with the correct messages including system prompt
		expect(mockApiHandler.countTokens).toHaveBeenCalled()

		// Check the newContextTokens calculation includes system prompt
		expect(result.newContextTokens).toBe(300) // 200 output tokens + 100 from countTokens
		expect(result.cost).toBe(0.06)
		expect(result.summary).toBe("This is a summary with system prompt")
	})
})

describe("summarizeConversation with custom settings", () => {
	// Mock necessary dependencies
	let mockMainApiHandler: ApiHandler
	let mockCondensingApiHandler: ApiHandler
	const defaultSystemPrompt = "Default prompt"
	const taskId = "test-task"

	// Sample messages for testing
	const sampleMessages: ApiMessage[] = [
		{ role: "user", content: "Hello", ts: 1 },
		{ role: "assistant", content: "Hi there", ts: 2 },
		{ role: "user", content: "How are you?", ts: 3 },
		{ role: "assistant", content: "I'm good", ts: 4 },
		{ role: "user", content: "What's new?", ts: 5 },
		{ role: "assistant", content: "Not much", ts: 6 },
		{ role: "user", content: "Tell me more", ts: 7 },
	]

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Reset telemetry mock
		;(telemetryService.captureContextCondensed as jest.Mock).mockClear()

		// Setup mock API handlers
		mockMainApiHandler = {
			createMessage: jest.fn().mockImplementation(() => {
				return (async function* () {
					yield { type: "text" as const, text: "Summary from main handler" }
					yield { type: "usage" as const, totalCost: 0.05, outputTokens: 100 }
				})()
			}),
			countTokens: jest.fn().mockImplementation(() => Promise.resolve(50)),
			getModel: jest.fn().mockReturnValue({
				id: "main-model",
				info: {
					contextWindow: 8000,
					supportsImages: true,
					supportsComputerUse: true,
					supportsVision: true,
					maxTokens: 4000,
					supportsPromptCache: true,
					maxCachePoints: 10,
					minTokensPerCachePoint: 100,
					cachableFields: ["system", "messages"],
				},
			}),
		} as unknown as ApiHandler

		mockCondensingApiHandler = {
			createMessage: jest.fn().mockImplementation(() => {
				return (async function* () {
					yield { type: "text" as const, text: "Summary from condensing handler" }
					yield { type: "usage" as const, totalCost: 0.03, outputTokens: 80 }
				})()
			}),
			countTokens: jest.fn().mockImplementation(() => Promise.resolve(40)),
			getModel: jest.fn().mockReturnValue({
				id: "condensing-model",
				info: {
					contextWindow: 4000,
					supportsImages: true,
					supportsComputerUse: false,
					supportsVision: false,
					maxTokens: 2000,
					supportsPromptCache: false,
					maxCachePoints: 0,
					minTokensPerCachePoint: 0,
					cachableFields: [],
				},
			}),
		} as unknown as ApiHandler
	})

	/**
	 * Test that custom prompt is used when provided
	 */
	it("should use custom prompt when provided", async () => {
		const customPrompt = "Custom summarization prompt"

		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			false,
			customPrompt,
		)

		// Verify the custom prompt was used
		const createMessageCalls = (mockMainApiHandler.createMessage as jest.Mock).mock.calls
		expect(createMessageCalls.length).toBe(1)
		expect(createMessageCalls[0][0]).toBe(customPrompt)
	})

	/**
	 * Test that default system prompt is used when custom prompt is empty
	 */
	it("should use default systemPrompt when custom prompt is empty or not provided", async () => {
		// Test with empty string
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			false,
			"  ", // Empty custom prompt
		)

		// Verify the default prompt was used
		let createMessageCalls = (mockMainApiHandler.createMessage as jest.Mock).mock.calls
		expect(createMessageCalls.length).toBe(1)
		expect(createMessageCalls[0][0]).toContain("Your task is to create a detailed summary")

		// Reset mock and test with undefined
		jest.clearAllMocks()
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			false,
			undefined, // No custom prompt
		)

		// Verify the default prompt was used again
		createMessageCalls = (mockMainApiHandler.createMessage as jest.Mock).mock.calls
		expect(createMessageCalls.length).toBe(1)
		expect(createMessageCalls[0][0]).toContain("Your task is to create a detailed summary")
	})

	/**
	 * Test that condensing API handler is used when provided and valid
	 */
	it("should use condensingApiHandler when provided and valid", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			false,
			undefined,
			mockCondensingApiHandler,
		)

		// Verify the condensing handler was used
		expect((mockCondensingApiHandler.createMessage as jest.Mock).mock.calls.length).toBe(1)
		expect((mockMainApiHandler.createMessage as jest.Mock).mock.calls.length).toBe(0)
	})

	/**
	 * Test fallback to main API handler when condensing handler is not provided
	 */
	it("should fall back to mainApiHandler if condensingApiHandler is not provided", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			false,
			undefined,
			undefined,
		)

		// Verify the main handler was used
		expect((mockMainApiHandler.createMessage as jest.Mock).mock.calls.length).toBe(1)
	})

	/**
	 * Test fallback to main API handler when condensing handler is invalid
	 */
	it("should fall back to mainApiHandler if condensingApiHandler is invalid", async () => {
		// Create an invalid handler (missing createMessage)
		const invalidHandler = {
			countTokens: jest.fn(),
			getModel: jest.fn(),
			// createMessage is missing
		} as unknown as ApiHandler

		// Mock console.warn to verify warning message
		const originalWarn = console.warn
		const mockWarn = jest.fn()
		console.warn = mockWarn

		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			false,
			undefined,
			invalidHandler,
		)

		// Verify the main handler was used as fallback
		expect((mockMainApiHandler.createMessage as jest.Mock).mock.calls.length).toBe(1)

		// Verify warning was logged
		expect(mockWarn).toHaveBeenCalledWith(
			expect.stringContaining("Chosen API handler for condensing does not support message creation"),
		)

		// Restore console.warn
		console.warn = originalWarn
	})

	/**
	 * Test that telemetry is called for custom prompt usage
	 */
	it("should capture telemetry when using custom prompt", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			false,
			"Custom prompt",
		)

		// Verify telemetry was called with custom prompt flag
		expect(telemetryService.captureContextCondensed).toHaveBeenCalledWith(
			taskId,
			false,
			true, // usedCustomPrompt
			false, // usedCustomApiHandler
		)
	})

	/**
	 * Test that telemetry is called for custom API handler usage
	 */
	it("should capture telemetry when using custom API handler", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			false,
			undefined,
			mockCondensingApiHandler,
		)

		// Verify telemetry was called with custom API handler flag
		expect(telemetryService.captureContextCondensed).toHaveBeenCalledWith(
			taskId,
			false,
			false, // usedCustomPrompt
			true, // usedCustomApiHandler
		)
	})

	/**
	 * Test that telemetry is called with both custom prompt and API handler
	 */
	it("should capture telemetry when using both custom prompt and API handler", async () => {
		await summarizeConversation(
			sampleMessages,
			mockMainApiHandler,
			defaultSystemPrompt,
			taskId,
			true, // isAutomaticTrigger
			"Custom prompt",
			mockCondensingApiHandler,
		)

		// Verify telemetry was called with both flags
		expect(telemetryService.captureContextCondensed).toHaveBeenCalledWith(
			taskId,
			true, // isAutomaticTrigger
			true, // usedCustomPrompt
			true, // usedCustomApiHandler
		)
	})
})
