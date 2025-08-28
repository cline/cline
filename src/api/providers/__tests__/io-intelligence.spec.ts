import { Anthropic } from "@anthropic-ai/sdk"

import { IOIntelligenceHandler } from "../io-intelligence"
import type { ApiHandlerOptions } from "../../../shared/api"

const mockCreate = vi.fn()

// Mock OpenAI
vi.mock("openai", () => ({
	default: class MockOpenAI {
		baseURL: string
		apiKey: string
		chat = {
			completions: {
				create: vi.fn(),
			},
		}
		constructor(options: any) {
			this.baseURL = options.baseURL
			this.apiKey = options.apiKey
			this.chat.completions.create = mockCreate
		}
	},
}))

// Mock the fetcher functions
vi.mock("../fetchers/io-intelligence", () => ({
	getIOIntelligenceModels: vi.fn(),
	getCachedIOIntelligenceModels: vi.fn(() => ({
		"meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8": {
			maxTokens: 8192,
			contextWindow: 430000,
			description: "Llama 4 Maverick 17B model",
			supportsImages: true,
			supportsPromptCache: false,
		},
		"deepseek-ai/DeepSeek-R1-0528": {
			maxTokens: 8192,
			contextWindow: 128000,
			supportsImages: false,
			supportsPromptCache: false,
			description: "DeepSeek R1 reasoning model",
		},
		"Intel/Qwen3-Coder-480B-A35B-Instruct-int4-mixed-ar": {
			maxTokens: 4096,
			contextWindow: 106000,
			supportsImages: false,
			supportsPromptCache: false,
			description: "Qwen3 Coder 480B specialized for coding",
		},
		"openai/gpt-oss-120b": {
			maxTokens: 8192,
			contextWindow: 131072,
			supportsImages: false,
			supportsPromptCache: false,
			description: "OpenAI GPT-OSS 120B model",
		},
	})),
}))

// Mock constants
vi.mock("../constants", () => ({
	DEFAULT_HEADERS: { "User-Agent": "roo-cline" },
}))

// Mock transform functions
vi.mock("../../transform/openai-format", () => ({
	convertToOpenAiMessages: vi.fn((messages) => messages),
}))

describe("IOIntelligenceHandler", () => {
	let handler: IOIntelligenceHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		vi.clearAllMocks()
		mockOptions = {
			ioIntelligenceApiKey: "test-api-key",
			apiModelId: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
			modelTemperature: 0.7,
			includeMaxTokens: false,
			modelMaxTokens: undefined,
		} as ApiHandlerOptions

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
		handler = new IOIntelligenceHandler(mockOptions)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should create OpenAI client with correct configuration", () => {
		const ioIntelligenceApiKey = "test-io-intelligence-api-key"
		const handler = new IOIntelligenceHandler({ ioIntelligenceApiKey })
		// Verify that the handler was created successfully
		expect(handler).toBeInstanceOf(IOIntelligenceHandler)
		expect(handler["client"]).toBeDefined()
		// Verify the client has the expected properties
		expect(handler["client"].baseURL).toBe("https://api.intelligence.io.solutions/api/v1")
		expect(handler["client"].apiKey).toBe(ioIntelligenceApiKey)
	})

	it("should initialize with correct configuration", () => {
		expect(handler).toBeInstanceOf(IOIntelligenceHandler)
		expect(handler["client"]).toBeDefined()
		expect(handler["options"]).toEqual({
			...mockOptions,
			apiKey: mockOptions.ioIntelligenceApiKey,
		})
	})

	it("should throw error when API key is missing", () => {
		const optionsWithoutKey = { ...mockOptions }
		delete optionsWithoutKey.ioIntelligenceApiKey

		expect(() => new IOIntelligenceHandler(optionsWithoutKey)).toThrow("IO Intelligence API key is required")
	})

	it("should handle streaming response correctly", async () => {
		const mockStream = [
			{
				choices: [{ delta: { content: "Hello" } }],
				usage: null,
			},
			{
				choices: [{ delta: { content: " world" } }],
				usage: null,
			},
			{
				choices: [{ delta: {} }],
				usage: { prompt_tokens: 10, completion_tokens: 5 },
			},
		]

		mockCreate.mockResolvedValue({
			[Symbol.asyncIterator]: async function* () {
				for (const chunk of mockStream) {
					yield chunk
				}
			},
		})

		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

		const stream = handler.createMessage("System prompt", messages)
		const results = []

		for await (const chunk of stream) {
			results.push(chunk)
		}

		expect(results).toHaveLength(3)
		expect(results[0]).toEqual({ type: "text", text: "Hello" })
		expect(results[1]).toEqual({ type: "text", text: " world" })
		expect(results[2]).toEqual({
			type: "usage",
			inputTokens: 10,
			outputTokens: 5,
		})
	})

	it("completePrompt method should return text from IO Intelligence API", async () => {
		const expectedResponse = "This is a test response from IO Intelligence"
		mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: expectedResponse } }] })
		const result = await handler.completePrompt("test prompt")
		expect(result).toBe(expectedResponse)
	})

	it("should handle errors in completePrompt", async () => {
		const errorMessage = "IO Intelligence API error"
		mockCreate.mockRejectedValueOnce(new Error(errorMessage))
		await expect(handler.completePrompt("test prompt")).rejects.toThrow(
			`IO Intelligence completion error: ${errorMessage}`,
		)
	})

	it("createMessage should yield text content from stream", async () => {
		const testContent = "This is test content from IO Intelligence stream"

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

	it("should return model info from cache when available", () => {
		const model = handler.getModel()
		expect(model.id).toBe("meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8")
		expect(model.info).toEqual({
			maxTokens: 8192,
			contextWindow: 430000,
			description: "Llama 4 Maverick 17B model",
			supportsImages: true,
			supportsPromptCache: false,
		})
	})

	it("should return fallback model info when not in cache", () => {
		const handlerWithUnknownModel = new IOIntelligenceHandler({
			...mockOptions,
			apiModelId: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
		})
		const model = handlerWithUnknownModel.getModel()
		expect(model.id).toBe("meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8")
		expect(model.info).toEqual({
			maxTokens: 8192,
			contextWindow: 430000,
			description: "Llama 4 Maverick 17B model",
			supportsImages: true,
			supportsPromptCache: false,
		})
	})

	it("should use default model when no model is specified", () => {
		const handlerWithoutModel = new IOIntelligenceHandler({
			...mockOptions,
			apiModelId: undefined,
		})
		const model = handlerWithoutModel.getModel()
		expect(model.id).toBe("meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8")
	})

	it("should handle empty response from completePrompt", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [{ message: { content: null } }],
		})

		const result = await handler.completePrompt("Test prompt")
		expect(result).toBe("")
	})

	it("should handle missing choices in completePrompt response", async () => {
		mockCreate.mockResolvedValueOnce({
			choices: [],
		})

		const result = await handler.completePrompt("Test prompt")
		expect(result).toBe("")
	})
})
