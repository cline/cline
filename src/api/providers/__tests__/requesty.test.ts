import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandlerOptions, ModelInfo, requestyModelInfoSaneDefaults } from "../../../shared/api"
import { RequestyHandler } from "../requesty"
import { convertToOpenAiMessages } from "../../transform/openai-format"
import { convertToR1Format } from "../../transform/r1-format"

// Mock OpenAI and transform functions
jest.mock("openai")
jest.mock("../../transform/openai-format")
jest.mock("../../transform/r1-format")

describe("RequestyHandler", () => {
	let handler: RequestyHandler
	let mockCreate: jest.Mock

	const defaultOptions: ApiHandlerOptions = {
		requestyApiKey: "test-key",
		requestyModelId: "test-model",
		requestyModelInfo: {
			maxTokens: 1000,
			contextWindow: 4000,
			supportsPromptCache: false,
			supportsImages: true,
			inputPrice: 1,
			outputPrice: 10,
			cacheReadsPrice: 0.1,
			cacheWritesPrice: 1.5,
		},
		openAiStreamingEnabled: true,
		includeMaxTokens: true, // Add this to match the implementation
	}

	beforeEach(() => {
		// Clear mocks
		jest.clearAllMocks()

		// Setup mock create function
		mockCreate = jest.fn()

		// Mock OpenAI constructor
		;(OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(
			() =>
				({
					chat: {
						completions: {
							create: mockCreate,
						},
					},
				}) as unknown as OpenAI,
		)

		// Mock transform functions
		;(convertToOpenAiMessages as jest.Mock).mockImplementation((messages) => messages)
		;(convertToR1Format as jest.Mock).mockImplementation((messages) => messages)

		// Create handler instance
		handler = new RequestyHandler(defaultOptions)
	})

	describe("constructor", () => {
		it("should initialize with correct options", () => {
			expect(OpenAI).toHaveBeenCalledWith({
				baseURL: "https://router.requesty.ai/v1",
				apiKey: defaultOptions.requestyApiKey,
				defaultHeaders: {
					"HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",
					"X-Title": "Roo Code",
				},
			})
		})
	})

	describe("createMessage", () => {
		const systemPrompt = "You are a helpful assistant"
		const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

		describe("with streaming enabled", () => {
			beforeEach(() => {
				const stream = {
					[Symbol.asyncIterator]: async function* () {
						yield {
							choices: [{ delta: { content: "Hello" } }],
						}
						yield {
							choices: [{ delta: { content: " world" } }],
							usage: {
								prompt_tokens: 30,
								completion_tokens: 10,
								prompt_tokens_details: {
									cached_tokens: 15,
									caching_tokens: 5,
								},
							},
						}
					},
				}
				mockCreate.mockResolvedValue(stream)
			})

			it("should handle streaming response correctly", async () => {
				const stream = handler.createMessage(systemPrompt, messages)
				const results = []

				for await (const chunk of stream) {
					results.push(chunk)
				}

				expect(results).toEqual([
					{ type: "text", text: "Hello" },
					{ type: "text", text: " world" },
					{
						type: "usage",
						inputTokens: 30,
						outputTokens: 10,
						cacheWriteTokens: 5,
						cacheReadTokens: 15,
						totalCost: 0.000119, // (10 * 1 / 1,000,000) + (5 * 1.5 / 1,000,000) + (15 * 0.1 / 1,000,000) + (10 * 10 / 1,000,000)
					},
				])

				expect(mockCreate).toHaveBeenCalledWith({
					model: defaultOptions.requestyModelId,
					temperature: 0,
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: "Hello" },
					],
					stream: true,
					stream_options: { include_usage: true },
					max_tokens: defaultOptions.requestyModelInfo?.maxTokens,
				})
			})

			it("should not include max_tokens when includeMaxTokens is false", async () => {
				handler = new RequestyHandler({
					...defaultOptions,
					includeMaxTokens: false,
				})

				await handler.createMessage(systemPrompt, messages).next()

				expect(mockCreate).toHaveBeenCalledWith(
					expect.not.objectContaining({
						max_tokens: expect.any(Number),
					}),
				)
			})

			it("should handle deepseek-reasoner model format", async () => {
				handler = new RequestyHandler({
					...defaultOptions,
					requestyModelId: "deepseek-reasoner",
				})

				await handler.createMessage(systemPrompt, messages).next()

				expect(convertToR1Format).toHaveBeenCalledWith([{ role: "user", content: systemPrompt }, ...messages])
			})
		})

		describe("with streaming disabled", () => {
			beforeEach(() => {
				handler = new RequestyHandler({
					...defaultOptions,
					openAiStreamingEnabled: false,
				})

				mockCreate.mockResolvedValue({
					choices: [{ message: { content: "Hello world" } }],
					usage: {
						prompt_tokens: 10,
						completion_tokens: 5,
					},
				})
			})

			it("should handle non-streaming response correctly", async () => {
				const stream = handler.createMessage(systemPrompt, messages)
				const results = []

				for await (const chunk of stream) {
					results.push(chunk)
				}

				expect(results).toEqual([
					{ type: "text", text: "Hello world" },
					{
						type: "usage",
						inputTokens: 10,
						outputTokens: 5,
						cacheWriteTokens: 0,
						cacheReadTokens: 0,
						totalCost: 0.00006, // (10 * 1 / 1,000,000) + (5 * 10 / 1,000,000)
					},
				])

				expect(mockCreate).toHaveBeenCalledWith({
					model: defaultOptions.requestyModelId,
					messages: [
						{ role: "user", content: systemPrompt },
						{ role: "user", content: "Hello" },
					],
				})
			})
		})
	})

	describe("getModel", () => {
		it("should return correct model information", () => {
			const result = handler.getModel()
			expect(result).toEqual({
				id: defaultOptions.requestyModelId,
				info: defaultOptions.requestyModelInfo,
			})
		})

		it("should use sane defaults when no model info provided", () => {
			handler = new RequestyHandler({
				...defaultOptions,
				requestyModelInfo: undefined,
			})

			const result = handler.getModel()
			expect(result).toEqual({
				id: defaultOptions.requestyModelId,
				info: requestyModelInfoSaneDefaults,
			})
		})
	})

	describe("completePrompt", () => {
		beforeEach(() => {
			mockCreate.mockResolvedValue({
				choices: [{ message: { content: "Completed response" } }],
			})
		})

		it("should complete prompt successfully", async () => {
			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Completed response")
			expect(mockCreate).toHaveBeenCalledWith({
				model: defaultOptions.requestyModelId,
				messages: [{ role: "user", content: "Test prompt" }],
			})
		})

		it("should handle errors correctly", async () => {
			const errorMessage = "API error"
			mockCreate.mockRejectedValue(new Error(errorMessage))

			await expect(handler.completePrompt("Test prompt")).rejects.toThrow(
				`OpenAI completion error: ${errorMessage}`,
			)
		})
	})
})
