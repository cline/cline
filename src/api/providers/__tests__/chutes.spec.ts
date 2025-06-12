// npx vitest run api/providers/__tests__/chutes.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import OpenAI from "openai"

import { type ChutesModelId, chutesDefaultModelId, chutesModels, DEEP_SEEK_DEFAULT_TEMPERATURE } from "@roo-code/types"

import { ChutesHandler } from "../chutes"

// Create mock functions
const mockCreate = vi.fn()

// Mock OpenAI module
vi.mock("openai", () => ({
	default: vi.fn(() => ({
		chat: {
			completions: {
				create: mockCreate,
			},
		},
	})),
}))

describe("ChutesHandler", () => {
	let handler: ChutesHandler

	beforeEach(() => {
		vi.clearAllMocks()
		// Set up default mock implementation
		mockCreate.mockImplementation(async () => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [
						{
							delta: { content: "Test response" },
							index: 0,
						},
					],
					usage: null,
				}
				yield {
					choices: [
						{
							delta: {},
							index: 0,
						},
					],
					usage: {
						prompt_tokens: 10,
						completion_tokens: 5,
						total_tokens: 15,
					},
				}
			},
		}))
		handler = new ChutesHandler({ chutesApiKey: "test-key" })
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should use the correct Chutes base URL", () => {
		new ChutesHandler({ chutesApiKey: "test-chutes-api-key" })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://llm.chutes.ai/v1" }))
	})

	it("should use the provided API key", () => {
		const chutesApiKey = "test-chutes-api-key"
		new ChutesHandler({ chutesApiKey })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: chutesApiKey }))
	})

	it("should handle DeepSeek R1 reasoning format", async () => {
		// Override the mock for this specific test
		mockCreate.mockImplementationOnce(async () => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [
						{
							delta: { content: "<think>Thinking..." },
							index: 0,
						},
					],
					usage: null,
				}
				yield {
					choices: [
						{
							delta: { content: "</think>Hello" },
							index: 0,
						},
					],
					usage: null,
				}
				yield {
					choices: [
						{
							delta: {},
							index: 0,
						},
					],
					usage: { prompt_tokens: 10, completion_tokens: 5 },
				}
			},
		}))

		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hi" }]
		vi.spyOn(handler, "getModel").mockReturnValue({
			id: "deepseek-ai/DeepSeek-R1-0528",
			info: { maxTokens: 1024, temperature: 0.7 },
		} as any)

		const stream = handler.createMessage(systemPrompt, messages)
		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([
			{ type: "reasoning", text: "Thinking..." },
			{ type: "text", text: "Hello" },
			{ type: "usage", inputTokens: 10, outputTokens: 5 },
		])
	})

	it("should fall back to base provider for non-DeepSeek models", async () => {
		// Use default mock implementation which returns text content
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hi" }]
		vi.spyOn(handler, "getModel").mockReturnValue({
			id: "some-other-model",
			info: { maxTokens: 1024, temperature: 0.7 },
		} as any)

		const stream = handler.createMessage(systemPrompt, messages)
		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([
			{ type: "text", text: "Test response" },
			{ type: "usage", inputTokens: 10, outputTokens: 5 },
		])
	})

	it("should return default model when no model is specified", () => {
		const model = handler.getModel()
		expect(model.id).toBe(chutesDefaultModelId)
		expect(model.info).toEqual(expect.objectContaining(chutesModels[chutesDefaultModelId]))
	})

	it("should return specified model when valid model is provided", () => {
		const testModelId: ChutesModelId = "deepseek-ai/DeepSeek-R1"
		const handlerWithModel = new ChutesHandler({
			apiModelId: testModelId,
			chutesApiKey: "test-chutes-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(expect.objectContaining(chutesModels[testModelId]))
	})

	it("completePrompt method should return text from Chutes API", async () => {
		const expectedResponse = "This is a test response from Chutes"
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe(expectedResponse)
	})

	it("should handle errors in completePrompt", async () => {
		const errorMessage = "Chutes API error"
		mockCreate.mockRejectedValueOnce(new Error(errorMessage))
		await expect(handler.completePrompt("test prompt")).rejects.toThrow(`Chutes completion error: ${errorMessage}`)
	})

	it("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content from Chutes stream"

		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: vi
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

	it("createMessage should yield usage data from stream", async () => {
		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					next: vi
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

	it("createMessage should pass correct parameters to Chutes client for DeepSeek R1", async () => {
		const modelId: ChutesModelId = "deepseek-ai/DeepSeek-R1"

		// Clear previous mocks and set up new implementation
		mockCreate.mockClear()
		mockCreate.mockImplementationOnce(async () => ({
			[Symbol.asyncIterator]: async function* () {
				// Empty stream for this test
			},
		}))

		const handlerWithModel = new ChutesHandler({
			apiModelId: modelId,
			chutesApiKey: "test-chutes-api-key",
		})

		const systemPrompt = "Test system prompt for Chutes"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message for Chutes" }]

		const messageGenerator = handlerWithModel.createMessage(systemPrompt, messages)
		await messageGenerator.next()

		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				model: modelId,
				messages: [
					{
						role: "user",
						content: `${systemPrompt}\n${messages[0].content}`,
					},
				],
			}),
		)
	})

	it("createMessage should pass correct parameters to Chutes client for non-DeepSeek models", async () => {
		const modelId: ChutesModelId = "unsloth/Llama-3.3-70B-Instruct"
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

	it("should apply DeepSeek default temperature for R1 models", () => {
		const testModelId: ChutesModelId = "deepseek-ai/DeepSeek-R1"
		const handlerWithModel = new ChutesHandler({
			apiModelId: testModelId,
			chutesApiKey: "test-chutes-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.info.temperature).toBe(DEEP_SEEK_DEFAULT_TEMPERATURE)
	})

	it("should use default temperature for non-DeepSeek models", () => {
		const testModelId: ChutesModelId = "unsloth/Llama-3.3-70B-Instruct"
		const handlerWithModel = new ChutesHandler({
			apiModelId: testModelId,
			chutesApiKey: "test-chutes-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.info.temperature).toBe(0.5)
	})
})
