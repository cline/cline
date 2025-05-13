// npx jest src/api/providers/__tests__/unbound.test.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { ApiHandlerOptions } from "../../../shared/api"

import { UnboundHandler } from "../unbound"

// Mock dependencies
jest.mock("../fetchers/modelCache", () => ({
	getModels: jest.fn().mockImplementation(() => {
		return Promise.resolve({
			"anthropic/claude-3-5-sonnet-20241022": {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: "Claude 3.5 Sonnet",
				thinking: false,
				supportsComputerUse: true,
			},
			"anthropic/claude-3-7-sonnet-20250219": {
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: "Claude 3.7 Sonnet",
				thinking: false,
				supportsComputerUse: true,
			},
			"openai/gpt-4o": {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: false,
				inputPrice: 5,
				outputPrice: 15,
				description: "GPT-4o",
			},
			"openai/o3-mini": {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: false,
				inputPrice: 1,
				outputPrice: 3,
				description: "O3 Mini",
			},
		})
	}),
}))

// Mock OpenAI client
const mockCreate = jest.fn()
const mockWithResponse = jest.fn()

jest.mock("openai", () => {
	return {
		__esModule: true,
		default: jest.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: (...args: any[]) => {
						const stream = {
							[Symbol.asyncIterator]: async function* () {
								// First chunk with content
								yield {
									choices: [{ delta: { content: "Test response" }, index: 0 }],
								}
								// Second chunk with usage data
								yield {
									choices: [{ delta: {}, index: 0 }],
									usage: {
										prompt_tokens: 10,
										completion_tokens: 5,
										total_tokens: 15,
									},
								}
								// Third chunk with cache usage data
								yield {
									choices: [{ delta: {}, index: 0 }],
									usage: {
										prompt_tokens: 8,
										completion_tokens: 4,
										total_tokens: 12,
										cache_creation_input_tokens: 3,
										cache_read_input_tokens: 2,
									},
								}
							},
						}

						const result = mockCreate(...args)

						if (args[0].stream) {
							mockWithResponse.mockReturnValue(
								Promise.resolve({ data: stream, response: { headers: new Map() } }),
							)
							result.withResponse = mockWithResponse
						}

						return result
					},
				},
			},
		})),
	}
})

describe("UnboundHandler", () => {
	let handler: UnboundHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			unboundApiKey: "test-api-key",
			unboundModelId: "anthropic/claude-3-5-sonnet-20241022",
		}

		handler = new UnboundHandler(mockOptions)
		mockCreate.mockClear()
		mockWithResponse.mockClear()

		// Default mock implementation for non-streaming responses
		mockCreate.mockResolvedValue({
			id: "test-completion",
			choices: [
				{
					message: { role: "assistant", content: "Test response" },
					finish_reason: "stop",
					index: 0,
				},
			],
		})
	})

	describe("constructor", () => {
		it("should initialize with provided options", async () => {
			expect(handler).toBeInstanceOf(UnboundHandler)
			expect((await handler.fetchModel()).id).toBe(mockOptions.unboundModelId)
		})
	})

	describe("createMessage", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello!",
			},
		]

		it("should handle streaming responses with text and usage data", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: Array<{ type: string } & Record<string, any>> = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(3)

			// Verify text chunk
			expect(chunks[0]).toEqual({ type: "text", text: "Test response" })

			// Verify regular usage data
			expect(chunks[1]).toEqual({ type: "usage", inputTokens: 10, outputTokens: 5 })

			// Verify usage data with cache information
			expect(chunks[2]).toEqual({
				type: "usage",
				inputTokens: 8,
				outputTokens: 4,
				cacheWriteTokens: 3,
				cacheReadTokens: 2,
			})

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "claude-3-5-sonnet-20241022",
					messages: expect.any(Array),
					stream: true,
				}),

				expect.objectContaining({
					headers: {
						"X-Unbound-Metadata": expect.stringContaining("roo-code"),
					},
				}),
			)
		})

		it("should handle API errors", async () => {
			mockCreate.mockImplementationOnce(() => {
				throw new Error("API Error")
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks = []

			try {
				for await (const chunk of stream) {
					chunks.push(chunk)
				}

				fail("Expected error to be thrown")
			} catch (error) {
				expect(error).toBeInstanceOf(Error)
				expect(error.message).toBe("API Error")
			}
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully", async () => {
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "claude-3-5-sonnet-20241022",
					messages: [{ role: "user", content: "Test prompt" }],
					temperature: 0,
					max_tokens: 8192,
				}),
				expect.objectContaining({
					headers: expect.objectContaining({
						"X-Unbound-Metadata": expect.stringContaining("roo-code"),
					}),
				}),
			)
		})

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))
			await expect(handler.completePrompt("Test prompt")).rejects.toThrow("Unbound completion error: API Error")
		})

		it("should handle empty response", async () => {
			mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "" } }] })
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should not set max_tokens for non-Anthropic models", async () => {
			mockCreate.mockClear()

			const nonAnthropicHandler = new UnboundHandler({
				apiModelId: "openai/gpt-4o",
				unboundApiKey: "test-key",
				unboundModelId: "openai/gpt-4o",
			})

			await nonAnthropicHandler.completePrompt("Test prompt")

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "gpt-4o",
					messages: [{ role: "user", content: "Test prompt" }],
					temperature: 0,
				}),
				expect.objectContaining({
					headers: expect.objectContaining({
						"X-Unbound-Metadata": expect.stringContaining("roo-code"),
					}),
				}),
			)

			expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("max_tokens")
		})

		it("should not set temperature for openai/o3-mini", async () => {
			mockCreate.mockClear()

			const openaiHandler = new UnboundHandler({
				apiModelId: "openai/o3-mini",
				unboundApiKey: "test-key",
				unboundModelId: "openai/o3-mini",
			})

			await openaiHandler.completePrompt("Test prompt")

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "o3-mini",
					messages: [{ role: "user", content: "Test prompt" }],
				}),
				expect.objectContaining({
					headers: expect.objectContaining({
						"X-Unbound-Metadata": expect.stringContaining("roo-code"),
					}),
				}),
			)

			expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("temperature")
		})
	})

	describe("fetchModel", () => {
		it("should return model info", async () => {
			const modelInfo = await handler.fetchModel()
			expect(modelInfo.id).toBe(mockOptions.unboundModelId)
			expect(modelInfo.info).toBeDefined()
		})

		it("should return default model when invalid model provided", async () => {
			const handlerWithInvalidModel = new UnboundHandler({ ...mockOptions, unboundModelId: "invalid/model" })
			const modelInfo = await handlerWithInvalidModel.fetchModel()
			expect(modelInfo.id).toBe("anthropic/claude-3-7-sonnet-20250219")
			expect(modelInfo.info).toBeDefined()
		})
	})
})
