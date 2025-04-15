import { OpenAiNativeHandler } from "../openai-native"
import { ApiHandlerOptions } from "../../../shared/api"
import OpenAI from "openai"
import { Anthropic } from "@anthropic-ai/sdk"

// Mock OpenAI client
const mockCreate = jest.fn()
jest.mock("openai", () => {
	return {
		__esModule: true,
		default: jest.fn().mockImplementation(() => ({
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
				for await (const chunk of stream) {
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
			expect((results[0] as any).inputTokens).toBe(0)
			expect((results[0] as any).outputTokens).toBe(0)

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
			expect(modelInfo.id).toBe("gpt-4.1") // Default model
			expect(modelInfo.info).toBeDefined()
		})
	})
})
