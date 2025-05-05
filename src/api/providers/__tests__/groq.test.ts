// npx jest src/api/providers/__tests__/groq.test.ts

import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

import { GroqModelId, groqDefaultModelId, groqModels } from "../../../shared/api"

import { GroqHandler } from "../groq"

jest.mock("openai", () => {
	const createMock = jest.fn()
	return jest.fn(() => ({ chat: { completions: { create: createMock } } }))
})

describe("GroqHandler", () => {
	let handler: GroqHandler
	let mockCreate: jest.Mock

	beforeEach(() => {
		jest.clearAllMocks()
		mockCreate = (OpenAI as unknown as jest.Mock)().chat.completions.create
		handler = new GroqHandler({ groqApiKey: "test-groq-api-key" })
	})

	test("should use the correct Groq base URL", () => {
		new GroqHandler({ groqApiKey: "test-groq-api-key" })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://api.groq.com/openai/v1" }))
	})

	test("should use the provided API key", () => {
		const groqApiKey = "test-groq-api-key"
		new GroqHandler({ groqApiKey })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: groqApiKey }))
	})

	test("should return default model when no model is specified", () => {
		const model = handler.getModel()
		expect(model.id).toBe(groqDefaultModelId)
		expect(model.info).toEqual(groqModels[groqDefaultModelId])
	})

	test("should return specified model when valid model is provided", () => {
		const testModelId: GroqModelId = "llama-3.3-70b-versatile"
		const handlerWithModel = new GroqHandler({ apiModelId: testModelId, groqApiKey: "test-groq-api-key" })
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(groqModels[testModelId])
	})

	test("completePrompt method should return text from Groq API", async () => {
		const expectedResponse = "This is a test response from Groq"
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe(expectedResponse)
	})

	test("should handle errors in completePrompt", async () => {
		const errorMessage = "Groq API error"
		mockCreate.mockRejectedValueOnce(new Error(errorMessage))
		await expect(handler.completePrompt("test prompt")).rejects.toThrow(`Groq completion error: ${errorMessage}`)
	})

	test("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content from Groq stream"

		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: jest
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: { choices: [{ delta: { content: testContent } }] },
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({ type: "text", text: testContent })
	})

	test("createMessage should yield usage data from stream", async () => {
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: jest
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: { choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 20 } },
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			}
		})

		const stream = handler.createMessage("system prompt", [])
		const firstChunk = await stream.next()

		expect(firstChunk.done).toBe(false)
		expect(firstChunk.value).toEqual({ type: "usage", inputTokens: 10, outputTokens: 20 })
	})

	test("createMessage should pass correct parameters to Groq client", async () => {
		const modelId: GroqModelId = "llama-3.1-8b-instant"
		const modelInfo = groqModels[modelId]
		const handlerWithModel = new GroqHandler({ apiModelId: modelId, groqApiKey: "test-groq-api-key" })

		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		const systemPrompt = "Test system prompt for Groq"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message for Groq" }]

		const messageGenerator = handlerWithModel.createMessage(systemPrompt, messages)
		await messageGenerator.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: modelId,
				max_tokens: modelInfo.maxTokens,
				temperature: 0.5,
				messages: expect.arrayContaining([{ role: "system", content: systemPrompt }]),
				stream: true,
				stream_options: { include_usage: true },
			}),
		)
	})
})
