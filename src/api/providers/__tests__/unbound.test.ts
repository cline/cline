import { UnboundHandler } from "../unbound"
import { ApiHandlerOptions } from "../../../shared/api"
import { Anthropic } from "@anthropic-ai/sdk"

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
									choices: [
										{
											delta: { content: "Test response" },
											index: 0,
										},
									],
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
								Promise.resolve({
									data: stream,
									response: { headers: new Map() },
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

describe("UnboundHandler", () => {
	let handler: UnboundHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			apiModelId: "anthropic/claude-3-5-sonnet-20241022",
			unboundApiKey: "test-api-key",
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
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(UnboundHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
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
			expect(chunks[0]).toEqual({
				type: "text",
				text: "Test response",
			})

			// Verify regular usage data
			expect(chunks[1]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 5,
			})

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
			)
		})

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))
			await expect(handler.completePrompt("Test prompt")).rejects.toThrow("Unbound completion error: API Error")
		})

		it("should handle empty response", async () => {
			mockCreate.mockResolvedValueOnce({
				choices: [{ message: { content: "" } }],
			})
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should not set max_tokens for non-Anthropic models", async () => {
			mockCreate.mockClear()

			const nonAnthropicOptions = {
				apiModelId: "openai/gpt-4o",
				unboundApiKey: "test-key",
			}
			const nonAnthropicHandler = new UnboundHandler(nonAnthropicOptions)

			await nonAnthropicHandler.completePrompt("Test prompt")
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "gpt-4o",
					messages: [{ role: "user", content: "Test prompt" }],
					temperature: 0,
				}),
			)
			expect(mockCreate.mock.calls[0][0]).not.toHaveProperty("max_tokens")
		})
	})

	describe("getModel", () => {
		it("should return model info", () => {
			const modelInfo = handler.getModel()
			expect(modelInfo.id).toBe(mockOptions.apiModelId)
			expect(modelInfo.info).toBeDefined()
		})

		it("should return default model when invalid model provided", () => {
			const handlerWithInvalidModel = new UnboundHandler({
				...mockOptions,
				apiModelId: "invalid/model",
			})
			const modelInfo = handlerWithInvalidModel.getModel()
			expect(modelInfo.id).toBe("openai/gpt-4o") // Default model
			expect(modelInfo.info).toBeDefined()
		})
	})
})
