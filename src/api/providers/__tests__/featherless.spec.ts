// npx vitest run api/providers/__tests__/featherless.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	type FeatherlessModelId,
	featherlessDefaultModelId,
	featherlessModels,
	DEEP_SEEK_DEFAULT_TEMPERATURE,
} from "@roo-code/types"

import { FeatherlessHandler } from "../featherless"

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

describe("FeatherlessHandler", () => {
	let handler: FeatherlessHandler

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
		handler = new FeatherlessHandler({ featherlessApiKey: "test-key" })
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should use the correct Featherless base URL", () => {
		new FeatherlessHandler({ featherlessApiKey: "test-featherless-api-key" })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://api.featherless.ai/v1" }))
	})

	it("should use the provided API key", () => {
		const featherlessApiKey = "test-featherless-api-key"
		new FeatherlessHandler({ featherlessApiKey })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: featherlessApiKey }))
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
		expect(model.id).toBe(featherlessDefaultModelId)
		expect(model.info).toEqual(expect.objectContaining(featherlessModels[featherlessDefaultModelId]))
	})

	it("should return specified model when valid model is provided", () => {
		const testModelId: FeatherlessModelId = "deepseek-ai/DeepSeek-R1-0528"
		const handlerWithModel = new FeatherlessHandler({
			apiModelId: testModelId,
			featherlessApiKey: "test-featherless-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(expect.objectContaining(featherlessModels[testModelId]))
	})

	it("completePrompt method should return text from Featherless API", async () => {
		const expectedResponse = "This is a test response from Featherless"
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe(expectedResponse)
	})

	it("should handle errors in completePrompt", async () => {
		const errorMessage = "Featherless API error"
		mockCreate.mockRejectedValueOnce(new Error(errorMessage))
		await expect(handler.completePrompt("test prompt")).rejects.toThrow(
			`Featherless completion error: ${errorMessage}`,
		)
	})

	it("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content from Featherless stream"

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

	it("createMessage should pass correct parameters to Featherless client for DeepSeek R1", async () => {
		const modelId: FeatherlessModelId = "deepseek-ai/DeepSeek-R1-0528"

		// Clear previous mocks and set up new implementation
		mockCreate.mockClear()
		mockCreate.mockImplementationOnce(async () => ({
			[Symbol.asyncIterator]: async function* () {
				// Empty stream for this test
			},
		}))

		const handlerWithModel = new FeatherlessHandler({
			apiModelId: modelId,
			featherlessApiKey: "test-featherless-api-key",
		})

		const systemPrompt = "Test system prompt for Featherless"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message for Featherless" }]

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

	it("should apply DeepSeek default temperature for R1 models", () => {
		const testModelId: FeatherlessModelId = "deepseek-ai/DeepSeek-R1-0528"
		const handlerWithModel = new FeatherlessHandler({
			apiModelId: testModelId,
			featherlessApiKey: "test-featherless-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.info.temperature).toBe(DEEP_SEEK_DEFAULT_TEMPERATURE)
	})

	it("should use default temperature for non-DeepSeek models", () => {
		const testModelId: FeatherlessModelId = "moonshotai/Kimi-K2-Instruct"
		const handlerWithModel = new FeatherlessHandler({
			apiModelId: testModelId,
			featherlessApiKey: "test-featherless-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.info.temperature).toBe(0.5)
	})
})
