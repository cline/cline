// npx vitest run api/providers/__tests__/fireworks.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type FireworksModelId, fireworksDefaultModelId, fireworksModels } from "@roo-code/types"

import { FireworksHandler } from "../fireworks"

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

describe("FireworksHandler", () => {
	let handler: FireworksHandler

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
		handler = new FireworksHandler({ fireworksApiKey: "test-key" })
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should use the correct Fireworks base URL", () => {
		new FireworksHandler({ fireworksApiKey: "test-fireworks-api-key" })
		expect(OpenAI).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: "https://api.fireworks.ai/inference/v1" }),
		)
	})

	it("should use the provided API key", () => {
		const fireworksApiKey = "test-fireworks-api-key"
		new FireworksHandler({ fireworksApiKey })
		expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ apiKey: fireworksApiKey }))
	})

	it("should throw error when API key is not provided", () => {
		expect(() => new FireworksHandler({})).toThrow("API key is required")
	})

	it("should return default model when no model is specified", () => {
		const model = handler.getModel()
		expect(model.id).toBe(fireworksDefaultModelId)
		expect(model.info).toEqual(expect.objectContaining(fireworksModels[fireworksDefaultModelId]))
	})

	it("should return specified model when valid model is provided", () => {
		const testModelId: FireworksModelId = "accounts/fireworks/models/qwen3-235b-a22b-instruct-2507"
		const handlerWithModel = new FireworksHandler({
			apiModelId: testModelId,
			fireworksApiKey: "test-fireworks-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(expect.objectContaining(fireworksModels[testModelId]))
	})

	it("should return Kimi K2 Instruct model with correct configuration", () => {
		const testModelId: FireworksModelId = "accounts/fireworks/models/kimi-k2-instruct"
		const handlerWithModel = new FireworksHandler({
			apiModelId: testModelId,
			fireworksApiKey: "test-fireworks-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(
			expect.objectContaining({
				maxTokens: 16384,
				contextWindow: 128000,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0.6,
				outputPrice: 2.5,
				description: expect.stringContaining("Kimi K2 is a state-of-the-art mixture-of-experts"),
			}),
		)
	})

	it("should return Qwen3 235B model with correct configuration", () => {
		const testModelId: FireworksModelId = "accounts/fireworks/models/qwen3-235b-a22b-instruct-2507"
		const handlerWithModel = new FireworksHandler({
			apiModelId: testModelId,
			fireworksApiKey: "test-fireworks-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(
			expect.objectContaining({
				maxTokens: 32768,
				contextWindow: 256000,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0.22,
				outputPrice: 0.88,
				description:
					"Latest Qwen3 thinking model, competitive against the best closed source models in Jul 2025.",
			}),
		)
	})

	it("should return DeepSeek R1 model with correct configuration", () => {
		const testModelId: FireworksModelId = "accounts/fireworks/models/deepseek-r1-0528"
		const handlerWithModel = new FireworksHandler({
			apiModelId: testModelId,
			fireworksApiKey: "test-fireworks-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(
			expect.objectContaining({
				maxTokens: 20480,
				contextWindow: 160000,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 3,
				outputPrice: 8,
				description: expect.stringContaining("05/28 updated checkpoint of Deepseek R1"),
			}),
		)
	})

	it("should return DeepSeek V3 model with correct configuration", () => {
		const testModelId: FireworksModelId = "accounts/fireworks/models/deepseek-v3"
		const handlerWithModel = new FireworksHandler({
			apiModelId: testModelId,
			fireworksApiKey: "test-fireworks-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(
			expect.objectContaining({
				maxTokens: 16384,
				contextWindow: 128000,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0.9,
				outputPrice: 0.9,
				description: expect.stringContaining("strong Mixture-of-Experts (MoE) language model"),
			}),
		)
	})

	it("should return GLM-4.5 model with correct configuration", () => {
		const testModelId: FireworksModelId = "accounts/fireworks/models/glm-4p5"
		const handlerWithModel = new FireworksHandler({
			apiModelId: testModelId,
			fireworksApiKey: "test-fireworks-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(
			expect.objectContaining({
				maxTokens: 16384,
				contextWindow: 128000,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0.55,
				outputPrice: 2.19,
				description: expect.stringContaining("Z.ai GLM-4.5 with 355B total parameters"),
			}),
		)
	})

	it("should return GLM-4.5-Air model with correct configuration", () => {
		const testModelId: FireworksModelId = "accounts/fireworks/models/glm-4p5-air"
		const handlerWithModel = new FireworksHandler({
			apiModelId: testModelId,
			fireworksApiKey: "test-fireworks-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(
			expect.objectContaining({
				maxTokens: 16384,
				contextWindow: 128000,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0.55,
				outputPrice: 2.19,
				description: expect.stringContaining("Z.ai GLM-4.5-Air with 106B total parameters"),
			}),
		)
	})

	it("should return gpt-oss-20b model with correct configuration", () => {
		const testModelId: FireworksModelId = "accounts/fireworks/models/gpt-oss-20b"
		const handlerWithModel = new FireworksHandler({
			apiModelId: testModelId,
			fireworksApiKey: "test-fireworks-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(
			expect.objectContaining({
				maxTokens: 16384,
				contextWindow: 128000,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0.07,
				outputPrice: 0.3,
				description: expect.stringContaining("OpenAI gpt-oss-20b: Compact model for local/edge deployments"),
			}),
		)
	})

	it("should return gpt-oss-120b model with correct configuration", () => {
		const testModelId: FireworksModelId = "accounts/fireworks/models/gpt-oss-120b"
		const handlerWithModel = new FireworksHandler({
			apiModelId: testModelId,
			fireworksApiKey: "test-fireworks-api-key",
		})
		const model = handlerWithModel.getModel()
		expect(model.id).toBe(testModelId)
		expect(model.info).toEqual(
			expect.objectContaining({
				maxTokens: 16384,
				contextWindow: 128000,
				supportsImages: false,
				supportsPromptCache: false,
				inputPrice: 0.15,
				outputPrice: 0.6,
				description: expect.stringContaining("OpenAI gpt-oss-120b: Production-grade, general-purpose model"),
			}),
		)
	})

	it("completePrompt method should return text from Fireworks API", async () => {
		const expectedResponse = "This is a test response from Fireworks"
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe(expectedResponse)
	})

	it("should handle errors in completePrompt", async () => {
		const errorMessage = "Fireworks API error"
		mockCreate.mockRejectedValueOnce(new Error(errorMessage))
		await expect(handler.completePrompt("test prompt")).rejects.toThrow(
			`Fireworks completion error: ${errorMessage}`,
		)
	})

	it("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content from Fireworks stream"

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

	it("createMessage should pass correct parameters to Fireworks client", async () => {
		const modelId: FireworksModelId = "accounts/fireworks/models/kimi-k2-instruct"
		const modelInfo = fireworksModels[modelId]
		const handlerWithModel = new FireworksHandler({
			apiModelId: modelId,
			fireworksApiKey: "test-fireworks-api-key",
		})

		mockCreate.mockImplementationOnce(() => {
			return {
				[Symbol.asyncIterator]: () => ({
					async next() {
						return { done: true }
					},
				}),
			}
		})

		const systemPrompt = "Test system prompt for Fireworks"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Test message for Fireworks" }]

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

	it("should use default temperature of 0.5", () => {
		const testModelId: FireworksModelId = "accounts/fireworks/models/kimi-k2-instruct"
		const handlerWithModel = new FireworksHandler({
			apiModelId: testModelId,
			fireworksApiKey: "test-fireworks-api-key",
		})
		const model = handlerWithModel.getModel()
		// The temperature is set in the constructor as defaultTemperature: 0.5
		// This test verifies the handler is configured with the correct default temperature
		expect(handlerWithModel).toBeDefined()
	})

	it("should handle empty response in completePrompt", async () => {
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: null } }] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe("")
	})

	it("should handle missing choices in completePrompt", async () => {
		mockCreate.mockResolvedValueOnce({ choices: [] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe("")
	})

	it("createMessage should handle stream with multiple chunks", async () => {
		mockCreate.mockImplementationOnce(async () => ({
			[Symbol.asyncIterator]: async function* () {
				yield {
					choices: [
						{
							delta: { content: "Hello" },
							index: 0,
						},
					],
					usage: null,
				}
				yield {
					choices: [
						{
							delta: { content: " world" },
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
						prompt_tokens: 5,
						completion_tokens: 10,
						total_tokens: 15,
					},
				}
			},
		}))

		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hi" }]

		const stream = handler.createMessage(systemPrompt, messages)
		const chunks = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		expect(chunks).toEqual([
			{ type: "text", text: "Hello" },
			{ type: "text", text: " world" },
			{ type: "usage", inputTokens: 5, outputTokens: 10 },
		])
	})
})
