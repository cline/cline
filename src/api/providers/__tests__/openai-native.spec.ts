// npx vitest run api/providers/__tests__/openai-native.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import { OpenAiNativeHandler } from "../openai-native"
import { ApiHandlerOptions } from "../../../shared/api"

// Mock OpenAI client
const mockCreate = vitest.fn()

vitest.mock("openai", () => {
	return {
		__esModule: true,
		default: vitest.fn().mockImplementation(() => ({
			chat: {
				completions: {
					create: mockCreate.mockImplementation(async (options) => {
						if (!options.stream) {
							return {
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
							}
						}

						return {
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
						}
					}),
				},
			},
		})),
	}
})

describe("OpenAiNativeHandler", () => {
	let handler: OpenAiNativeHandler
	let mockOptions: ApiHandlerOptions
	const systemPrompt = "You are a helpful assistant."
	const messages: Anthropic.Messages.MessageParam[] = [
		{
			role: "user",
			content: "Hello!",
		},
	]

	beforeEach(() => {
		mockOptions = {
			apiModelId: "gpt-4.1",
			openAiNativeApiKey: "test-api-key",
		}
		handler = new OpenAiNativeHandler(mockOptions)
		mockCreate.mockClear()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(OpenAiNativeHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it("should initialize with empty API key", () => {
			const handlerWithoutKey = new OpenAiNativeHandler({
				apiModelId: "gpt-4.1",
				openAiNativeApiKey: "",
			})
			expect(handlerWithoutKey).toBeInstanceOf(OpenAiNativeHandler)
		})
	})

	describe("createMessage", () => {
		it("should handle streaming responses", async () => {
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBeGreaterThan(0)
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks).toHaveLength(1)
			expect(textChunks[0].text).toBe("Test response")
		})

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))
			const stream = handler.createMessage(systemPrompt, messages)
			await expect(async () => {
				for await (const _chunk of stream) {
					// Should not reach here
				}
			}).rejects.toThrow("API Error")
		})

		it("should handle missing content in response for o1 model", async () => {
			// Use o1 model which supports developer role
			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "o1",
			})

			mockCreate.mockResolvedValueOnce({
				[Symbol.asyncIterator]: async function* () {
					yield {
						choices: [
							{
								delta: { content: null },
								index: 0,
							},
						],
						usage: {
							prompt_tokens: 0,
							completion_tokens: 0,
							total_tokens: 0,
						},
					}
				},
			})

			const generator = handler.createMessage(systemPrompt, messages)
			const results = []
			for await (const result of generator) {
				results.push(result)
			}

			// Verify essential fields directly
			expect(results.length).toBe(1)
			expect(results[0].type).toBe("usage")
			// Use type assertion to avoid TypeScript errors
			const usageResult = results[0] as any
			expect(usageResult.inputTokens).toBe(0)
			expect(usageResult.outputTokens).toBe(0)
			// When no cache tokens are present, they should be undefined
			expect(usageResult.cacheWriteTokens).toBeUndefined()
			expect(usageResult.cacheReadTokens).toBeUndefined()

			// Verify developer role is used for system prompt with o1 model
			expect(mockCreate).toHaveBeenCalledWith({
				model: "o1",
				messages: [
					{ role: "developer", content: "Formatting re-enabled\n" + systemPrompt },
					{ role: "user", content: "Hello!" },
				],
				stream: true,
				stream_options: { include_usage: true },
			})
		})

		it("should handle o3-mini model family correctly", async () => {
			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "o3-mini",
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(mockCreate).toHaveBeenCalledWith({
				model: "o3-mini",
				messages: [
					{ role: "developer", content: "Formatting re-enabled\n" + systemPrompt },
					{ role: "user", content: "Hello!" },
				],
				stream: true,
				stream_options: { include_usage: true },
				reasoning_effort: "medium",
			})
		})
	})

	describe("streaming models", () => {
		beforeEach(() => {
			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-4.1",
			})
		})

		it("should handle streaming response", async () => {
			const mockStream = [
				{ choices: [{ delta: { content: "Hello" } }], usage: null },
				{ choices: [{ delta: { content: " there" } }], usage: null },
				{ choices: [{ delta: { content: "!" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
			]

			mockCreate.mockResolvedValueOnce(
				(async function* () {
					for (const chunk of mockStream) {
						yield chunk
					}
				})(),
			)

			const generator = handler.createMessage(systemPrompt, messages)
			const results = []
			for await (const result of generator) {
				results.push(result)
			}

			// Verify text responses individually
			expect(results.length).toBe(4)
			expect(results[0]).toMatchObject({ type: "text", text: "Hello" })
			expect(results[1]).toMatchObject({ type: "text", text: " there" })
			expect(results[2]).toMatchObject({ type: "text", text: "!" })

			// Check usage data fields but use toBeCloseTo for floating point comparison
			expect(results[3].type).toBe("usage")
			// Use type assertion to avoid TypeScript errors
			expect((results[3] as any).inputTokens).toBe(10)
			expect((results[3] as any).outputTokens).toBe(5)
			expect((results[3] as any).totalCost).toBeCloseTo(0.00006, 6)

			expect(mockCreate).toHaveBeenCalledWith({
				model: "gpt-4.1",
				temperature: 0,
				messages: [
					{ role: "system", content: systemPrompt },
					{ role: "user", content: "Hello!" },
				],
				stream: true,
				stream_options: { include_usage: true },
			})
		})

		it("should not include verbosity parameter for models that don't support it", async () => {
			// Test with gpt-4.1 which does NOT support verbosity
			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-4.1",
				verbosity: "high", // Set verbosity but it should be ignored
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify that verbosity is NOT included in the request
			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs).not.toHaveProperty("verbosity")
			expect(callArgs.model).toBe("gpt-4.1")
			expect(callArgs.temperature).toBe(0)
			expect(callArgs.stream).toBe(true)
		})

		it("should not include verbosity for gpt-4o models", async () => {
			// Test with gpt-4o which does NOT support verbosity
			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-4o",
				verbosity: "medium", // Set verbosity but it should be ignored
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify that verbosity is NOT included in the request
			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs).not.toHaveProperty("verbosity")
			expect(callArgs.model).toBe("gpt-4o")
		})

		it("should not include verbosity for gpt-4.1-mini models", async () => {
			// Test with gpt-4.1-mini which does NOT support verbosity
			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-4.1-mini",
				verbosity: "low", // Set verbosity but it should be ignored
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify that verbosity is NOT included in the request
			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs).not.toHaveProperty("verbosity")
			expect(callArgs.model).toBe("gpt-4.1-mini")
		})

		it("should handle empty delta content", async () => {
			const mockStream = [
				{ choices: [{ delta: {} }], usage: null },
				{ choices: [{ delta: { content: null } }], usage: null },
				{ choices: [{ delta: { content: "Hello" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
			]

			mockCreate.mockResolvedValueOnce(
				(async function* () {
					for (const chunk of mockStream) {
						yield chunk
					}
				})(),
			)

			const generator = handler.createMessage(systemPrompt, messages)
			const results = []
			for await (const result of generator) {
				results.push(result)
			}

			// Verify responses individually
			expect(results.length).toBe(2)
			expect(results[0]).toMatchObject({ type: "text", text: "Hello" })

			// Check usage data fields but use toBeCloseTo for floating point comparison
			expect(results[1].type).toBe("usage")
			// Use type assertion to avoid TypeScript errors
			expect((results[1] as any).inputTokens).toBe(10)
			expect((results[1] as any).outputTokens).toBe(5)
			expect((results[1] as any).totalCost).toBeCloseTo(0.00006, 6)
		})

		it("should handle cache tokens in streaming response", async () => {
			const mockStream = [
				{ choices: [{ delta: { content: "Hello" } }], usage: null },
				{ choices: [{ delta: { content: " cached" } }], usage: null },
				{
					choices: [{ delta: { content: " response" } }],
					usage: {
						prompt_tokens: 100,
						completion_tokens: 10,
						prompt_tokens_details: {
							cached_tokens: 80,
							audio_tokens: 0,
						},
						completion_tokens_details: {
							reasoning_tokens: 0,
							audio_tokens: 0,
							accepted_prediction_tokens: 0,
							rejected_prediction_tokens: 0,
						},
					},
				},
			]

			mockCreate.mockResolvedValueOnce(
				(async function* () {
					for (const chunk of mockStream) {
						yield chunk
					}
				})(),
			)

			const generator = handler.createMessage(systemPrompt, messages)
			const results = []
			for await (const result of generator) {
				results.push(result)
			}

			// Verify text responses
			expect(results.length).toBe(4)
			expect(results[0]).toMatchObject({ type: "text", text: "Hello" })
			expect(results[1]).toMatchObject({ type: "text", text: " cached" })
			expect(results[2]).toMatchObject({ type: "text", text: " response" })

			// Check usage data includes cache tokens
			expect(results[3].type).toBe("usage")
			const usageChunk = results[3] as any
			expect(usageChunk.inputTokens).toBe(100) // Total input tokens (includes cached)
			expect(usageChunk.outputTokens).toBe(10)
			expect(usageChunk.cacheReadTokens).toBe(80) // Cached tokens from prompt_tokens_details
			expect(usageChunk.cacheWriteTokens).toBeUndefined() // No cache write tokens in standard response

			// Verify cost calculation takes cache into account
			// GPT-4.1 pricing: input $2/1M, output $8/1M, cache read $0.5/1M
			// OpenAI's prompt_tokens includes cached tokens, so we need to calculate:
			// - Non-cached input tokens: 100 - 80 = 20
			// - Cost for non-cached input: (20 / 1_000_000) * 2.0
			// - Cost for cached input: (80 / 1_000_000) * 0.5
			// - Cost for output: (10 / 1_000_000) * 8.0
			const nonCachedInputTokens = 100 - 80
			const expectedNonCachedInputCost = (nonCachedInputTokens / 1_000_000) * 2.0
			const expectedCacheReadCost = (80 / 1_000_000) * 0.5
			const expectedOutputCost = (10 / 1_000_000) * 8.0
			const expectedTotalCost = expectedNonCachedInputCost + expectedCacheReadCost + expectedOutputCost
			expect(usageChunk.totalCost).toBeCloseTo(expectedTotalCost, 10)
		})

		it("should handle cache write tokens if present", async () => {
			const mockStream = [
				{ choices: [{ delta: { content: "Test" } }], usage: null },
				{
					choices: [{ delta: {} }],
					usage: {
						prompt_tokens: 150,
						completion_tokens: 5,
						prompt_tokens_details: {
							cached_tokens: 50,
						},
						cache_creation_input_tokens: 30, // Cache write tokens
					},
				},
			]

			mockCreate.mockResolvedValueOnce(
				(async function* () {
					for (const chunk of mockStream) {
						yield chunk
					}
				})(),
			)

			const generator = handler.createMessage(systemPrompt, messages)
			const results = []
			for await (const result of generator) {
				results.push(result)
			}

			// Check usage data includes both cache read and write tokens
			const usageChunk = results.find((r) => r.type === "usage") as any
			expect(usageChunk).toBeDefined()
			expect(usageChunk.inputTokens).toBe(150)
			expect(usageChunk.outputTokens).toBe(5)
			expect(usageChunk.cacheReadTokens).toBe(50)
			expect(usageChunk.cacheWriteTokens).toBe(30)
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully with gpt-4.1 model", async () => {
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(mockCreate).toHaveBeenCalledWith({
				model: "gpt-4.1",
				messages: [{ role: "user", content: "Test prompt" }],
				temperature: 0,
			})
		})

		it("should complete prompt successfully with o1 model", async () => {
			handler = new OpenAiNativeHandler({
				apiModelId: "o1",
				openAiNativeApiKey: "test-api-key",
			})

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(mockCreate).toHaveBeenCalledWith({
				model: "o1",
				messages: [{ role: "user", content: "Test prompt" }],
			})
		})

		it("should complete prompt successfully with o1-preview model", async () => {
			handler = new OpenAiNativeHandler({
				apiModelId: "o1-preview",
				openAiNativeApiKey: "test-api-key",
			})

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(mockCreate).toHaveBeenCalledWith({
				model: "o1-preview",
				messages: [{ role: "user", content: "Test prompt" }],
			})
		})

		it("should complete prompt successfully with o1-mini model", async () => {
			handler = new OpenAiNativeHandler({
				apiModelId: "o1-mini",
				openAiNativeApiKey: "test-api-key",
			})

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(mockCreate).toHaveBeenCalledWith({
				model: "o1-mini",
				messages: [{ role: "user", content: "Test prompt" }],
			})
		})

		it("should complete prompt successfully with o3-mini model", async () => {
			handler = new OpenAiNativeHandler({
				apiModelId: "o3-mini",
				openAiNativeApiKey: "test-api-key",
			})

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(mockCreate).toHaveBeenCalledWith({
				model: "o3-mini",
				messages: [{ role: "user", content: "Test prompt" }],
				reasoning_effort: "medium",
			})
		})

		it("should handle API errors", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))
			await expect(handler.completePrompt("Test prompt")).rejects.toThrow(
				"OpenAI Native completion error: API Error",
			)
		})

		it("should handle empty response", async () => {
			mockCreate.mockResolvedValueOnce({
				choices: [{ message: { content: "" } }],
			})
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})
	})

	describe("temperature parameter handling", () => {
		it("should include temperature for models that support it", async () => {
			// Test with gpt-4.1 which supports temperature
			handler = new OpenAiNativeHandler({
				apiModelId: "gpt-4.1",
				openAiNativeApiKey: "test-api-key",
			})

			await handler.completePrompt("Test prompt")
			expect(mockCreate).toHaveBeenCalledWith({
				model: "gpt-4.1",
				messages: [{ role: "user", content: "Test prompt" }],
				temperature: 0,
			})
		})

		it("should strip temperature for o1 family models", async () => {
			const o1Models = ["o1", "o1-preview", "o1-mini"]

			for (const modelId of o1Models) {
				handler = new OpenAiNativeHandler({
					apiModelId: modelId,
					openAiNativeApiKey: "test-api-key",
				})

				mockCreate.mockClear()
				await handler.completePrompt("Test prompt")

				const callArgs = mockCreate.mock.calls[0][0]
				// Temperature should be undefined for o1 models
				expect(callArgs.temperature).toBeUndefined()
				expect(callArgs.model).toBe(modelId)
			}
		})

		it("should strip temperature for o3-mini model", async () => {
			handler = new OpenAiNativeHandler({
				apiModelId: "o3-mini",
				openAiNativeApiKey: "test-api-key",
			})

			await handler.completePrompt("Test prompt")

			const callArgs = mockCreate.mock.calls[0][0]
			// Temperature should be undefined for o3-mini models
			expect(callArgs.temperature).toBeUndefined()
			expect(callArgs.model).toBe("o3-mini")
			expect(callArgs.reasoning_effort).toBe("medium")
		})

		it("should strip temperature in streaming mode for unsupported models", async () => {
			handler = new OpenAiNativeHandler({
				apiModelId: "o1",
				openAiNativeApiKey: "test-api-key",
			})

			const stream = handler.createMessage(systemPrompt, messages)
			// Consume the stream
			for await (const _chunk of stream) {
				// Just consume the stream
			}

			const callArgs = mockCreate.mock.calls[0][0]
			expect(callArgs).not.toHaveProperty("temperature")
			expect(callArgs.model).toBe("o1")
			expect(callArgs.stream).toBe(true)
		})
	})

	describe("getModel", () => {
		it("should return model info", () => {
			const modelInfo = handler.getModel()
			expect(modelInfo.id).toBe(mockOptions.apiModelId)
			expect(modelInfo.info).toBeDefined()
			expect(modelInfo.info.maxTokens).toBe(32768)
			expect(modelInfo.info.contextWindow).toBe(1047576)
		})

		it("should handle undefined model ID", () => {
			const handlerWithoutModel = new OpenAiNativeHandler({
				openAiNativeApiKey: "test-api-key",
			})
			const modelInfo = handlerWithoutModel.getModel()
			expect(modelInfo.id).toBe("gpt-5-2025-08-07") // Default model
			expect(modelInfo.info).toBeDefined()
		})
	})

	describe("GPT-5 models", () => {
		it("should handle GPT-5 model with Responses API", async () => {
			// Mock fetch for Responses API
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						// Simulate actual GPT-5 Responses API SSE stream format
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.created","response":{"id":"test","status":"in_progress"}}\n\n',
							),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_item.added","item":{"type":"text","text":"Hello"}}\n\n',
							),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_item.added","item":{"type":"text","text":" world"}}\n\n',
							),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.done","response":{"usage":{"prompt_tokens":10,"completion_tokens":2}}}\n\n',
							),
						)
						controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-2025-08-07",
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify Responses API is called with correct parameters
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.openai.com/v1/responses",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Content-Type": "application/json",
						Authorization: "Bearer test-api-key",
						Accept: "text/event-stream",
					}),
					body: expect.any(String),
				}),
			)
			const body1 = (mockFetch.mock.calls[0][1] as any).body as string
			expect(body1).toContain('"model":"gpt-5-2025-08-07"')
			expect(body1).toContain('"input":"Developer: You are a helpful assistant.\\n\\nUser: Hello!"')
			expect(body1).toContain('"effort":"medium"')
			expect(body1).toContain('"summary":"auto"')
			expect(body1).toContain('"verbosity":"medium"')
			expect(body1).toContain('"temperature":1')
			expect(body1).toContain('"max_output_tokens"')

			// Verify the streamed content
			const textChunks = chunks.filter((c) => c.type === "text")
			expect(textChunks).toHaveLength(2)
			expect(textChunks[0].text).toBe("Hello")
			expect(textChunks[1].text).toBe(" world")

			// Clean up
			delete (global as any).fetch
		})

		it("should handle GPT-5-mini model with Responses API", async () => {
			// Mock fetch for Responses API
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_item.added","item":{"type":"text","text":"Response"}}\n\n',
							),
						)
						controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-mini-2025-08-07",
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify correct model and default parameters
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.openai.com/v1/responses",
				expect.objectContaining({
					body: expect.stringContaining('"model":"gpt-5-mini-2025-08-07"'),
				}),
			)

			// Clean up
			delete (global as any).fetch
		})

		it("should handle GPT-5-nano model with Responses API", async () => {
			// Mock fetch for Responses API
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_item.added","item":{"type":"text","text":"Nano response"}}\n\n',
							),
						)
						controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-nano-2025-08-07",
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify correct model
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.openai.com/v1/responses",
				expect.objectContaining({
					body: expect.stringContaining('"model":"gpt-5-nano-2025-08-07"'),
				}),
			)

			// Clean up
			delete (global as any).fetch
		})

		it("should support verbosity control for GPT-5", async () => {
			// Mock fetch for Responses API
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_item.added","item":{"type":"text","text":"Low verbosity"}}\n\n',
							),
						)
						controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-2025-08-07",
				verbosity: "low", // Set verbosity through options
			})

			// Create a message to verify verbosity is passed
			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify that verbosity is passed in the request
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.openai.com/v1/responses",
				expect.objectContaining({
					body: expect.stringContaining('"verbosity":"low"'),
				}),
			)

			// Clean up
			delete (global as any).fetch
		})

		it("should support minimal reasoning effort for GPT-5", async () => {
			// Mock fetch for Responses API
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_item.added","item":{"type":"text","text":"Minimal effort"}}\n\n',
							),
						)
						controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-2025-08-07",
				reasoningEffort: "minimal" as any, // GPT-5 supports minimal
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// With minimal reasoning effort, the model should pass it through
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.openai.com/v1/responses",
				expect.objectContaining({
					body: expect.stringContaining('"effort":"minimal"'),
				}),
			)

			// Clean up
			delete (global as any).fetch
		})

		it("should support low reasoning effort for GPT-5", async () => {
			// Mock fetch for Responses API
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_item.added","item":{"type":"text","text":"Low effort response"}}\n\n',
							),
						)
						controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-2025-08-07",
				reasoningEffort: "low",
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Should use Responses API with low reasoning effort
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.openai.com/v1/responses",
				expect.objectContaining({
					body: expect.any(String),
				}),
			)
			const body2 = (mockFetch.mock.calls[0][1] as any).body as string
			expect(body2).toContain('"model":"gpt-5-2025-08-07"')
			expect(body2).toContain('"effort":"low"')
			expect(body2).toContain('"summary":"auto"')
			expect(body2).toContain('"verbosity":"medium"')
			expect(body2).toContain('"temperature":1')
			expect(body2).toContain('"max_output_tokens"')

			// Clean up
			delete (global as any).fetch
		})

		it("should support both verbosity and reasoning effort together for GPT-5", async () => {
			// Mock fetch for Responses API
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_item.added","item":{"type":"text","text":"High verbosity minimal effort"}}\n\n',
							),
						)
						controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-2025-08-07",
				verbosity: "high",
				reasoningEffort: "minimal" as any,
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Should use Responses API with both parameters
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.openai.com/v1/responses",
				expect.objectContaining({
					body: expect.any(String),
				}),
			)
			const body3 = (mockFetch.mock.calls[0][1] as any).body as string
			expect(body3).toContain('"model":"gpt-5-2025-08-07"')
			expect(body3).toContain('"effort":"minimal"')
			expect(body3).toContain('"summary":"auto"')
			expect(body3).toContain('"verbosity":"high"')
			expect(body3).toContain('"temperature":1')
			expect(body3).toContain('"max_output_tokens"')

			// Clean up
			delete (global as any).fetch
		})

		it("should handle actual GPT-5 Responses API format", async () => {
			// Mock fetch with actual response format from GPT-5
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						// Test actual GPT-5 response format
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.created","response":{"id":"test","status":"in_progress"}}\n\n',
							),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.in_progress","response":{"status":"in_progress"}}\n\n',
							),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_item.added","item":{"type":"text","text":"First text"}}\n\n',
							),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_item.added","item":{"type":"text","text":" Second text"}}\n\n',
							),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_item.added","item":{"type":"reasoning","text":"Some reasoning"}}\n\n',
							),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.done","response":{"usage":{"prompt_tokens":100,"completion_tokens":20}}}\n\n',
							),
						)
						controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-2025-08-07",
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Should handle the actual format correctly
			const textChunks = chunks.filter((c) => c.type === "text")
			const reasoningChunks = chunks.filter((c) => c.type === "reasoning")

			expect(textChunks).toHaveLength(2)
			expect(textChunks[0].text).toBe("First text")
			expect(textChunks[1].text).toBe(" Second text")

			expect(reasoningChunks).toHaveLength(1)
			expect(reasoningChunks[0].text).toBe("Some reasoning")

			// Should also have usage information with cost
			const usageChunks = chunks.filter((c) => c.type === "usage")
			expect(usageChunks).toHaveLength(1)
			expect(usageChunks[0]).toMatchObject({
				type: "usage",
				inputTokens: 100,
				outputTokens: 20,
				totalCost: expect.any(Number),
			})

			// Verify cost calculation (GPT-5 pricing: input $1.25/M, output $10/M)
			const expectedInputCost = (100 / 1_000_000) * 1.25
			const expectedOutputCost = (20 / 1_000_000) * 10.0
			const expectedTotalCost = expectedInputCost + expectedOutputCost
			expect(usageChunks[0].totalCost).toBeCloseTo(expectedTotalCost, 10)

			// Clean up
			delete (global as any).fetch
		})

		it("should handle Responses API with no content gracefully", async () => {
			// Mock fetch with empty response
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode('data: {"someField":"value"}\n\n'))
						controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-2025-08-07",
			})

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []

			// Should not throw, just warn
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Should have no content chunks when stream is empty
			const contentChunks = chunks.filter((c) => c.type === "text" || c.type === "reasoning")

			expect(contentChunks).toHaveLength(0)

			// Clean up
			delete (global as any).fetch
		})

		it("should support previous_response_id for conversation continuity", async () => {
			// Mock fetch for Responses API
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						// Include response ID in the response
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.created","response":{"id":"resp_123","status":"in_progress"}}\n\n',
							),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_item.added","item":{"type":"text","text":"Response with ID"}}\n\n',
							),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.done","response":{"id":"resp_123","usage":{"prompt_tokens":10,"completion_tokens":3}}}\n\n',
							),
						)
						controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-2025-08-07",
			})

			// First request - should not have previous_response_id
			const stream1 = handler.createMessage(systemPrompt, messages)
			const chunks1: any[] = []
			for await (const chunk of stream1) {
				chunks1.push(chunk)
			}

			// Verify first request doesn't include previous_response_id
			let firstCallBody = JSON.parse(mockFetch.mock.calls[0][1].body)
			expect(firstCallBody.previous_response_id).toBeUndefined()

			// Second request with metadata - should include previous_response_id
			const stream2 = handler.createMessage(systemPrompt, messages, {
				taskId: "test-task",
				previousResponseId: "resp_456",
			})
			const chunks2: any[] = []
			for await (const chunk of stream2) {
				chunks2.push(chunk)
			}

			// Verify second request includes the provided previous_response_id
			let secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body)
			expect(secondCallBody.previous_response_id).toBe("resp_456")

			// Clean up
			delete (global as any).fetch
		})

		it("should handle unhandled stream events gracefully", async () => {
			// Mock fetch for the fallback SSE path (which is what gets used when SDK fails)
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_item.added","item":{"type":"text","text":"Hello"}}\n\n',
							),
						)
						// This event is not handled, so it should be ignored
						controller.enqueue(
							new TextEncoder().encode('data: {"type":"response.audio.delta","delta":"..."}\n\n'),
						)
						controller.enqueue(new TextEncoder().encode('data: {"type":"response.done","response":{}}\n\n'))
						controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			// Also mock the SDK to throw an error so it falls back to fetch
			const mockClient = {
				responses: {
					create: vitest.fn().mockRejectedValue(new Error("SDK not available")),
				},
			}

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-2025-08-07",
			})

			// Replace the client with our mock
			;(handler as any).client = mockClient

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			const errors: any[] = []

			try {
				for await (const chunk of stream) {
					chunks.push(chunk)
				}
			} catch (error) {
				errors.push(error)
			}

			// Log for debugging
			if (chunks.length === 0 && errors.length === 0) {
				console.log("No chunks and no errors received")
			}
			if (errors.length > 0) {
				console.log("Errors:", errors)
			}

			expect(errors.length).toBe(0)
			const textChunks = chunks.filter((c) => c.type === "text")
			expect(textChunks.length).toBeGreaterThan(0)
			expect(textChunks[0].text).toBe("Hello")

			delete (global as any).fetch
		})

		it("should use stored response ID when metadata doesn't provide one", async () => {
			// Mock fetch for Responses API
			const mockFetch = vitest
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					body: new ReadableStream({
						start(controller) {
							// First response with ID
							controller.enqueue(
								new TextEncoder().encode(
									'data: {"type":"response.done","response":{"id":"resp_789","output":[{"type":"text","content":[{"type":"text","text":"First"}]}],"usage":{"prompt_tokens":10,"completion_tokens":1}}}\n\n',
								),
							)
							controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
							controller.close()
						},
					}),
				})
				.mockResolvedValueOnce({
					ok: true,
					body: new ReadableStream({
						start(controller) {
							// Second response
							controller.enqueue(
								new TextEncoder().encode(
									'data: {"type":"response.output_item.added","item":{"type":"text","text":"Second"}}\n\n',
								),
							)
							controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
							controller.close()
						},
					}),
				})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-2025-08-07",
			})

			// First request - establishes response ID
			const stream1 = handler.createMessage(systemPrompt, messages)
			for await (const chunk of stream1) {
				// consume stream
			}

			// Second request without metadata - should use stored response ID
			const stream2 = handler.createMessage(systemPrompt, messages, { taskId: "test-task" })
			for await (const chunk of stream2) {
				// consume stream
			}

			// Verify second request uses the stored response ID from first request
			let secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body)
			expect(secondCallBody.previous_response_id).toBe("resp_789")

			// Clean up
			delete (global as any).fetch
		})

		it("should only send latest message when using previous_response_id", async () => {
			// Mock fetch for Responses API
			const mockFetch = vitest
				.fn()
				.mockResolvedValueOnce({
					ok: true,
					body: new ReadableStream({
						start(controller) {
							// First response with ID
							controller.enqueue(
								new TextEncoder().encode(
									'data: {"type":"response.done","response":{"id":"resp_001","output":[{"type":"text","content":[{"type":"text","text":"First"}]}],"usage":{"prompt_tokens":50,"completion_tokens":1}}}\n\n',
								),
							)
							controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
							controller.close()
						},
					}),
				})
				.mockResolvedValueOnce({
					ok: true,
					body: new ReadableStream({
						start(controller) {
							// Second response
							controller.enqueue(
								new TextEncoder().encode(
									'data: {"type":"response.output_item.added","item":{"type":"text","text":"Second"}}\n\n',
								),
							)
							controller.enqueue(
								new TextEncoder().encode(
									'data: {"type":"response.done","response":{"id":"resp_002","usage":{"prompt_tokens":10,"completion_tokens":1}}}\n\n',
								),
							)
							controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
							controller.close()
						},
					}),
				})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-2025-08-07",
			})

			// First request with full conversation
			const firstMessages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there!" },
				{ role: "user", content: "How are you?" },
			]

			const stream1 = handler.createMessage(systemPrompt, firstMessages)
			for await (const chunk of stream1) {
				// consume stream
			}

			// Verify first request sends full conversation
			let firstCallBody = JSON.parse(mockFetch.mock.calls[0][1].body)
			expect(firstCallBody.input).toContain("Hello")
			expect(firstCallBody.input).toContain("Hi there!")
			expect(firstCallBody.input).toContain("How are you?")
			expect(firstCallBody.previous_response_id).toBeUndefined()

			// Second request with previous_response_id - should only send latest message
			const secondMessages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Hello" },
				{ role: "assistant", content: "Hi there!" },
				{ role: "user", content: "How are you?" },
				{ role: "assistant", content: "I'm doing well!" },
				{ role: "user", content: "What's the weather?" }, // Latest message
			]

			const stream2 = handler.createMessage(systemPrompt, secondMessages, {
				taskId: "test-task",
				previousResponseId: "resp_001",
			})
			for await (const chunk of stream2) {
				// consume stream
			}

			// Verify second request only sends the latest user message
			let secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body)
			expect(secondCallBody.input).toBe("User: What's the weather?")
			expect(secondCallBody.input).not.toContain("Hello")
			expect(secondCallBody.input).not.toContain("Hi there!")
			expect(secondCallBody.input).not.toContain("How are you?")
			expect(secondCallBody.previous_response_id).toBe("resp_001")

			// Clean up
			delete (global as any).fetch
		})

		it("should correctly prepare GPT-5 input with conversation continuity", () => {
			const gpt5Handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "gpt-5-2025-08-07",
			})

			// @ts-expect-error - private method
			const { formattedInput, previousResponseId } = gpt5Handler.prepareGpt5Input(systemPrompt, messages, {
				taskId: "task1",
				previousResponseId: "resp_123",
			})

			expect(previousResponseId).toBe("resp_123")
			expect(formattedInput).toBe("User: Hello!")
		})

		it("should provide helpful error messages for different error codes", async () => {
			const testCases = [
				{ status: 400, expectedMessage: "Invalid request to GPT-5 API" },
				{ status: 401, expectedMessage: "Authentication failed" },
				{ status: 403, expectedMessage: "Access denied" },
				{ status: 404, expectedMessage: "GPT-5 API endpoint not found" },
				{ status: 429, expectedMessage: "Rate limit exceeded" },
				{ status: 500, expectedMessage: "OpenAI service error" },
			]

			for (const { status, expectedMessage } of testCases) {
				// Mock fetch with error response
				const mockFetch = vitest.fn().mockResolvedValue({
					ok: false,
					status,
					statusText: "Error",
					text: async () => JSON.stringify({ error: { message: "Test error" } }),
				})
				global.fetch = mockFetch as any

				handler = new OpenAiNativeHandler({
					...mockOptions,
					apiModelId: "gpt-5-2025-08-07",
				})

				const stream = handler.createMessage(systemPrompt, messages)

				await expect(async () => {
					for await (const chunk of stream) {
						// Should throw before yielding anything
					}
				}).rejects.toThrow(expectedMessage)
			}

			// Clean up
			delete (global as any).fetch
		})
	})
})

// Added tests for GPT-5 streaming event coverage per PR_review_gpt5_final.md

describe("GPT-5 streaming event coverage (additional)", () => {
	it("should handle reasoning delta events for GPT-5", async () => {
		const mockFetch = vitest.fn().mockResolvedValue({
			ok: true,
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode(
							'data: {"type":"response.reasoning.delta","delta":"Thinking about the problem..."}\n\n',
						),
					)
					controller.enqueue(
						new TextEncoder().encode('data: {"type":"response.text.delta","delta":"The answer is..."}\n\n'),
					)
					controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
					controller.close()
				},
			}),
		})
		// @ts-ignore
		global.fetch = mockFetch

		const handler = new OpenAiNativeHandler({
			apiModelId: "gpt-5-2025-08-07",
			openAiNativeApiKey: "test-api-key",
		})

		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello!" }]
		const stream = handler.createMessage(systemPrompt, messages)

		const chunks: any[] = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		const reasoningChunks = chunks.filter((c) => c.type === "reasoning")
		const textChunks = chunks.filter((c) => c.type === "text")

		expect(reasoningChunks).toHaveLength(1)
		expect(reasoningChunks[0].text).toBe("Thinking about the problem...")
		expect(textChunks).toHaveLength(1)
		expect(textChunks[0].text).toBe("The answer is...")

		// @ts-ignore
		delete global.fetch
	})

	it("should handle refusal delta events for GPT-5 and prefix output", async () => {
		const mockFetch = vitest.fn().mockResolvedValue({
			ok: true,
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode(
							'data: {"type":"response.refusal.delta","delta":"I cannot comply with this request."}\n\n',
						),
					)
					controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
					controller.close()
				},
			}),
		})
		// @ts-ignore
		global.fetch = mockFetch

		const handler = new OpenAiNativeHandler({
			apiModelId: "gpt-5-2025-08-07",
			openAiNativeApiKey: "test-api-key",
		})

		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Do something disallowed" }]
		const stream = handler.createMessage(systemPrompt, messages)

		const chunks: any[] = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		const textChunks = chunks.filter((c) => c.type === "text")
		expect(textChunks).toHaveLength(1)
		expect(textChunks[0].text).toBe("[Refusal] I cannot comply with this request.")

		// @ts-ignore
		delete global.fetch
	})

	it("should ignore malformed JSON lines in SSE stream", async () => {
		const mockFetch = vitest.fn().mockResolvedValue({
			ok: true,
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode(
							'data: {"type":"response.output_item.added","item":{"type":"text","text":"Before"}}\n\n',
						),
					)
					// Malformed JSON line
					controller.enqueue(
						new TextEncoder().encode('data: {"type":"response.text.delta","delta":"Bad"\n\n'),
					)
					// Valid line after malformed
					controller.enqueue(
						new TextEncoder().encode(
							'data: {"type":"response.output_item.added","item":{"type":"text","text":"After"}}\n\n',
						),
					)
					controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
					controller.close()
				},
			}),
		})
		// @ts-ignore
		global.fetch = mockFetch

		const handler = new OpenAiNativeHandler({
			apiModelId: "gpt-5-2025-08-07",
			openAiNativeApiKey: "test-api-key",
		})

		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello!" }]
		const stream = handler.createMessage(systemPrompt, messages)

		const chunks: any[] = []
		for await (const chunk of stream) {
			chunks.push(chunk)
		}

		// It should not throw and still capture the valid texts around the malformed line
		const textChunks = chunks.filter((c) => c.type === "text")
		expect(textChunks.map((c: any) => c.text)).toEqual(["Before", "After"])

		// @ts-ignore
		delete global.fetch
	})

	describe("Codex Mini Model", () => {
		let handler: OpenAiNativeHandler
		const mockOptions: ApiHandlerOptions = {
			openAiNativeApiKey: "test-api-key",
			apiModelId: "codex-mini-latest",
		}

		it("should handle codex-mini-latest streaming response", async () => {
			// Mock fetch for Codex Mini responses API
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						// Codex Mini uses the same responses API format
						controller.enqueue(
							new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"Hello"}\n\n'),
						)
						controller.enqueue(
							new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":" from"}\n\n'),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_text.delta","delta":" Codex"}\n\n',
							),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_text.delta","delta":" Mini!"}\n\n',
							),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.done","response":{"usage":{"prompt_tokens":50,"completion_tokens":10}}}\n\n',
							),
						)
						controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "codex-mini-latest",
			})

			const systemPrompt = "You are a helpful coding assistant."
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "Write a hello world function" },
			]

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify text chunks
			const textChunks = chunks.filter((c) => c.type === "text")
			expect(textChunks).toHaveLength(4)
			expect(textChunks.map((c) => c.text).join("")).toBe("Hello from Codex Mini!")

			// Verify usage data from API
			const usageChunks = chunks.filter((c) => c.type === "usage")
			expect(usageChunks).toHaveLength(1)
			expect(usageChunks[0]).toMatchObject({
				type: "usage",
				inputTokens: 50,
				outputTokens: 10,
				totalCost: expect.any(Number), // Codex Mini has pricing: $1.5/M input, $6/M output
			})

			// Verify cost is calculated correctly based on API usage data
			const expectedCost = (50 / 1_000_000) * 1.5 + (10 / 1_000_000) * 6
			expect(usageChunks[0].totalCost).toBeCloseTo(expectedCost, 10)

			// Verify the request was made with correct parameters
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.openai.com/v1/responses",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Content-Type": "application/json",
						Authorization: "Bearer test-api-key",
						Accept: "text/event-stream",
					}),
					body: expect.any(String),
				}),
			)

			const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body)
			expect(requestBody).toMatchObject({
				model: "codex-mini-latest",
				input: "Developer: You are a helpful coding assistant.\n\nUser: Write a hello world function",
				stream: true,
			})

			// Clean up
			delete (global as any).fetch
		})

		it("should handle codex-mini-latest non-streaming completion", async () => {
			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "codex-mini-latest",
			})

			// Codex Mini now uses the same Responses API as GPT-5, which doesn't support non-streaming
			await expect(handler.completePrompt("Write a hello world function in Python")).rejects.toThrow(
				"completePrompt is not supported for codex-mini-latest. Use createMessage (Responses API) instead.",
			)
		})

		it("should handle codex-mini-latest API errors", async () => {
			// Mock fetch with error response
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: false,
				status: 429,
				statusText: "Too Many Requests",
				text: async () => "Rate limit exceeded",
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "codex-mini-latest",
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			const stream = handler.createMessage(systemPrompt, messages)

			// Should throw an error (using the same error format as GPT-5)
			await expect(async () => {
				for await (const chunk of stream) {
					// consume stream
				}
			}).rejects.toThrow("Rate limit exceeded")

			// Clean up
			delete (global as any).fetch
		})

		it("should handle codex-mini-latest with multiple user messages", async () => {
			// Mock fetch for streaming response
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_text.delta","delta":"Combined response"}\n\n',
							),
						)
						controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed"}\n\n'))
						controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "codex-mini-latest",
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "First question" },
				{ role: "assistant", content: "First answer" },
				{ role: "user", content: "Second question" },
			]

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks: any[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify the request body includes full conversation like GPT-5
			const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body)
			expect(requestBody.input).toContain("Developer: You are a helpful assistant")
			expect(requestBody.input).toContain("User: First question")
			expect(requestBody.input).toContain("Assistant: First answer")
			expect(requestBody.input).toContain("User: Second question")

			// Clean up
			delete (global as any).fetch
		})

		it("should handle codex-mini-latest stream error events", async () => {
			// Mock fetch with error event in stream
			const mockFetch = vitest.fn().mockResolvedValue({
				ok: true,
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.output_text.delta","delta":"Partial"}\n\n',
							),
						)
						controller.enqueue(
							new TextEncoder().encode(
								'data: {"type":"response.error","error":{"message":"Model overloaded"}}\n\n',
							),
						)
						// The error handler will throw, but we still need to close the stream
						controller.close()
					},
				}),
			})
			global.fetch = mockFetch as any

			handler = new OpenAiNativeHandler({
				...mockOptions,
				apiModelId: "codex-mini-latest",
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			const stream = handler.createMessage(systemPrompt, messages)

			// Should throw an error when encountering error event
			await expect(async () => {
				const chunks = []
				for await (const chunk of stream) {
					chunks.push(chunk)
				}
			}).rejects.toThrow("Responses API error: Model overloaded")

			// Clean up
			delete (global as any).fetch
		})
	})
})
