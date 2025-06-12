import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

import { xaiDefaultModelId, xaiModels } from "@roo-code/types"

import { XAIHandler } from "../xai"

jest.mock("openai", () => {
	const createMock = jest.fn()
	return jest.fn(() => ({
		chat: {
			completions: {
				create: createMock,
			},
		},
	}))
})

describe("XAIHandler", () => {
	let handler: XAIHandler
	let mockCreate: jest.Mock

	beforeEach(() => {
		// Reset all mocks
		jest.clearAllMocks()

		// Get the mock create function
		mockCreate = (OpenAI as unknown as jest.Mock)().chat.completions.create

		// Create handler with mock
		handler = new XAIHandler({})
	})

	test("should use the correct X.AI base URL", () => {
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "https://api.x.ai/v1",
			}),
		)
	})

	test("should use the provided API key", () => {
		// Clear mocks before this specific test
		jest.clearAllMocks()

		// Create a handler with our API key
		const xaiApiKey = "test-api-key"
		new XAIHandler({ xaiApiKey })

		// Verify the OpenAI constructor was called with our API key
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: xaiApiKey,
			}),
		)
	})

	test("should return default model when no model is specified", () => {
		const model = handler.getModel()
		expect(model.id).toBe(xaiDefaultModelId)
		expect(model.info).toEqual(xaiModels[xaiDefaultModelId])
	})

	test("should return specified model when valid model is provided", () => {
		const testModelId = "grok-3"
		const handlerWithModel = new XAIHandler({ apiModelId: testModelId })
		const model = handlerWithModel.getModel()

		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(xaiModels[testModelId])
	})

	test("should include reasoning_effort parameter for mini models", async () => {
		const miniModelHandler = new XAIHandler({
			apiModelId: "grok-3-mini",
			reasoningEffort: "high",
		})

		// Setup mock for streaming response
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		// Start generating a message
		const messageGenerator = miniModelHandler.createMessage("test prompt", [])
		await messageGenerator.next() // Start the generator

		// Check that reasoning_effort was included
		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				reasoning_effort: "high",
			}),
		)
	})

	test("should not include reasoning_effort parameter for non-mini models", async () => {
		const regularModelHandler = new XAIHandler({
			apiModelId: "grok-3",
			reasoningEffort: "high",
		})

		// Setup mock for streaming response
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		// Start generating a message
		const messageGenerator = regularModelHandler.createMessage("test prompt", [])
		await messageGenerator.next() // Start the generator

		// Check call args for reasoning_effort
		const calls = mockCreate.mock.calls
		const lastCall = calls[calls.length - 1][0]
		expect(lastCall).not.toHaveProperty("reasoning_effort")
	})

	test("completePrompt method should return text from OpenAI API", async () => {
		const expectedResponse = "This is a test response"

		mockCreate.mockResolvedValueOnce({
			choices: [
				{
					message: {
						content: expectedResponse,
					},
				},
			],
		})

		const result = await handler.completePrompt("test prompt")
		expect(result).toBe(expectedResponse)
	})

	test("should handle errors in completePrompt", async () => {
		const errorMessage = "API error"
		mockCreate.mockRejectedValueOnce(new Error(errorMessage))

		await expect(handler.completePrompt("test prompt")).rejects.toThrow(`xAI completion error: ${errorMessage}`)
	})

	test("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content"

		// Setup mock for streaming response
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: jest
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [{ delta: { content: testContent } }],
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		// Create and consume the stream
		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		// Verify the content
		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({
			type: "text",
			text: testContent,
		})
	})

	test("createMessage should yield reasoning content from stream", async () => {
		const testReasoning = "Test reasoning content"

		// Setup mock for streaming response
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: jest
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [{ delta: { reasoning_content: testReasoning } }],
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		// Create and consume the stream
		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		// Verify the reasoning content
		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({
			type: "reasoning",
			text: testReasoning,
		})
	})

	test("createMessage should yield usage data from stream", async () => {
		// Setup mock for streaming response that includes usage data
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: jest
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: {
								choices: [{ delta: {} }], // Needs to have choices array to avoid error
								usage: {
									prompt_tokens: 10,
									completion_tokens: 20,
									cache_read_input_tokens: 5,
									cache_creation_input_tokens: 15,
								},
							},
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		// Create and consume the stream
		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		// Verify the usage data
		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({
			type: "usage",
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 5,
			cacheWriteTokens: 15,
		})
	})

	test("createMessage should pass correct parameters to OpenAI client", async () => {
		// Setup a handler with specific model
		const modelId = "grok-3"
		const modelInfo = xaiModels[modelId]
		const handlerWithModel = new XAIHandler({ apiModelId: modelId })

		// Setup mock for streaming response
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		// System prompt and messages
		const systemPrompt = "Test system prompt"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message" }]

		// Start generating a message
		const messageGenerator = handlerWithModel.createMessage(systemPrompt, messages)
		await messageGenerator.next() // Start the generator

		// Check that all parameters were passed correctly
		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: modelId,
				max_tokens: modelInfo.maxTokens,
				temperature: 0,
				messages: expect.arrayContaining([{ role: "system", content: systemPrompt }]),
				stream: true,
				stream_options: { include_usage: true },
			}),
		)
	})
})
