// npx vitest run src/api/providers/__tests__/glama.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { GlamaHandler } from "../glama"
import { ApiHandlerOptions } from "../../../shared/api"

// Mock dependencies
vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockImplementation(() => {
		return Promise.resolve({
			"anthropic/claude-3-7-sonnet": {
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
		})
	}),
}))

// Mock OpenAI client
const mockCreate = vitest.fn()
const mockWithResponse = vitest.fn()

vitest.mock("openai", () => {
	return {
		__esModule: true,
		default: vitest.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: (...args: any[]) => {
						const stream = {
							[Symbol.asyncIterator]: async function* () {
								yield {
									choices: [{ delta: { content: "Test response" }, index: 0 }],
									usage: null,
								}
								yield {
									choices: [{ delta: {}, index: 0 }],
									usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
								}
							},
						}

						const result = mockCreate(...args)

						if (args[0].stream) {
							mockWithResponse.mockReturnValue(
								Promise.resolve({
									data: stream,
									response: {
										headers: {
											get: (name: string) =>
												name === "x-completion-request-id" ? "test-request-id" : null,
										},
									},
								}),
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

describe("GlamaHandler", () => {
	let handler: GlamaHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			glamaApiKey: "test-api-key",
			glamaModelId: "anthropic/claude-3-7-sonnet",
		}

		handler = new GlamaHandler(mockOptions)
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
			usage: {
				prompt_tokens: 10,
				completion_tokens: 5,
				total_tokens: 15,
			},
		})
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(GlamaHandler)
			expect(handler.getModel().id).toBe(mockOptions.glamaModelId)
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

		it("should handle streaming responses", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(1)
			expect(chunks[0]).toEqual({ type: "text", text: "Test response" })
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
				expect.fail("Expected error to be thrown")
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
					model: mockOptions.glamaModelId,
					messages: [{ role: "user", content: "Test prompt" }],
					temperature: 0,
					max_tokens: 8192,
				}),
			)
		})

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))
			await expect(handler.completePrompt("Test prompt")).rejects.toThrow("Glama completion error: API Error")
		})

		it("should handle empty response", async () => {
			mockCreate.mockResolvedValueOnce({
				choices: [{ message: { content: "" } }],
			})
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should not set max_tokens for non-Anthropic models", async () => {
			// Reset mock to clear any previous calls
			mockCreate.mockClear()

			const nonAnthropicOptions = {
				glamaApiKey: "test-key",
				glamaModelId: "openai/gpt-4o",
			}

			const nonAnthropicHandler = new GlamaHandler(nonAnthropicOptions)

			await nonAnthropicHandler.completePrompt("Test prompt")
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "openai/gpt-4o",
					messages: [{ role: "user", content: "Test prompt" }],
					temperature: 0,
				}),
			)
			expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("max_tokens")
		})
	})

	describe("fetchModel", () => {
		it("should return model info", async () => {
			const modelInfo = await handler.fetchModel()
			expect(modelInfo.id).toBe(mockOptions.glamaModelId)
			expect(modelInfo.info).toBeDefined()
			expect(modelInfo.info.maxTokens).toBe(8192)
			expect(modelInfo.info.contextWindow).toBe(200_000)
		})

		it("should return default model when invalid model provided", async () => {
			const handlerWithInvalidModel = new GlamaHandler({ ...mockOptions, glamaModelId: "invalid/model" })
			const modelInfo = await handlerWithInvalidModel.fetchModel()
			expect(modelInfo.id).toBe("anthropic/claude-3-7-sonnet")
			expect(modelInfo.info).toBeDefined()
		})
	})
})
