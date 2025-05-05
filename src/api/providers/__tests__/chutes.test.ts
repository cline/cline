// npx jest src/api/providers/__tests__/chutes.test.ts

import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

import { ChutesModelId, chutesDefaultModelId, chutesModels } from "../../../shared/api"

import { ChutesHandler } from "../chutes"

jest.mock("openai", () => {
	const createMock = jest.fn()
	return jest.fn(() => ({ chat: { completions: { create: createMock } } }))
})

describe("ChutesHandler", () => {
	let handler: ChutesHandler
	let mockCreate: jest.Mock

	beforeEach(() => {
		jest.clearAllMocks()
		mockCreate = (OpenAI as unknown as jest.Mock)().chat.completions.create
		handler = new ChutesHandler({ chutesApiKey: "test-chutes-api-key" })
	})

	test("should use the correct Chutes base URL", () => {
		new ChutesHandler({ chutesApiKey: "test-chutes-api-key" })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://llm.chutes.ai/v1" }))
	})

	test("should use the provided API key", () => {
		const chutesApiKey = "test-chutes-api-key"
		new ChutesHandler({ chutesApiKey })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: chutesApiKey }))
	})

	test("should return default model when no model is specified", () => {
		const model = handler.getModel()
		expect(model.id).toBe(chutesDefaultModelId)
		expect(model.info).toEqual(chutesModels[chutesDefaultModelId])
	})

	test("should return specified model when valid model is provided", () => {
		const testModelId: ChutesModelId = "deepseek-ai/DeepSeek-R1"
		const handlerWithModel = new ChutesHandler({ apiModelId: testModelId, chutesApiKey: "test-chutes-api-key" })
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(chutesModels[testModelId])
	})

	test("completePrompt method should return text from Chutes API", async () => {
		const expectedResponse = "This is a test response from Chutes"
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe(expectedResponse)
	})

	test("should handle errors in completePrompt", async () => {
		const errorMessage = "Chutes API error"
		mockCreate.mockRejectedValueOnce(new Error(errorMessage))
		await expect(handler.completePrompt("test prompt")).rejects.toThrow(`Chutes completion error: ${errorMessage}`)
	})

	test("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content from Chutes stream"

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

	test("createMessage should pass correct parameters to Chutes client", async () => {
		const modelId: ChutesModelId = "deepseek-ai/DeepSeek-R1"
		const modelInfo = chutesModels[modelId]
		const handlerWithModel = new ChutesHandler({ apiModelId: modelId, chutesApiKey: "test-chutes-api-key" })

		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		const systemPrompt = "Test system prompt for Chutes"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message for Chutes" }]

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
