// Mock Mistral client - must come before other imports
const mockCreate = vi.fn()
const mockComplete = vi.fn()
vi.mock("@mistralai/mistralai", () => {
	return {
		Mistral: vi.fn().mockImplementation(() => ({
			chat: {
				stream: mockCreate.mockImplementation(async (_options) => {
					const stream = {
						[Symbol.asyncIterator]: async function* () {
							yield {
								data: {
									choices: [
										{
											delta: { content: "Test response" },
											index: 0,
										},
									],
								},
							}
						},
					}
					return stream
				}),
				complete: mockComplete.mockImplementation(async (_options) => {
					return {
						choices: [
							{
								message: {
									content: "Test response",
								},
							},
						],
					}
				}),
			},
		})),
	}
})

import type { Anthropic } from "@anthropic-ai/sdk"
import { MistralHandler } from "../mistral"
import type { ApiHandlerOptions } from "../../../shared/api"
import type { ApiStreamTextChunk, ApiStreamReasoningChunk } from "../../transform/stream"

describe("MistralHandler", () => {
	let handler: MistralHandler
	let mockOptions: ApiHandlerOptions

	beforeEach(() => {
		mockOptions = {
			apiModelId: "codestral-latest", // Update to match the actual model ID
			mistralApiKey: "test-api-key",
			includeMaxTokens: true,
			modelTemperature: 0,
		}
		handler = new MistralHandler(mockOptions)
		mockCreate.mockClear()
		mockComplete.mockClear()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(handler).toBeInstanceOf(MistralHandler)
			expect(handler.getModel().id).toBe(mockOptions.apiModelId)
		})

		it("should throw error if API key is missing", () => {
			expect(() => {
				new MistralHandler({
					...mockOptions,
					mistralApiKey: undefined,
				})
			}).toThrow("Mistral API key is required")
		})

		it("should use custom base URL if provided", () => {
			const customBaseUrl = "https://custom.mistral.ai/v1"
			const handlerWithCustomUrl = new MistralHandler({
				...mockOptions,
				mistralCodestralUrl: customBaseUrl,
			})
			expect(handlerWithCustomUrl).toBeInstanceOf(MistralHandler)
		})
	})

	describe("getModel", () => {
		it("should return correct model info", () => {
			const model = handler.getModel()
			expect(model.id).toBe(mockOptions.apiModelId)
			expect(model.info).toBeDefined()
			expect(model.info.supportsPromptCache).toBe(false)
		})
	})

	describe("createMessage", () => {
		const systemPrompt = "You are a helpful assistant."
		const messages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: [{ type: "text", text: "Hello!" }],
			},
		]

		it("should create message successfully", async () => {
			const iterator = handler.createMessage(systemPrompt, messages)
			const result = await iterator.next()

			expect(mockCreate).toHaveBeenCalledWith({
				model: mockOptions.apiModelId,
				messages: expect.any(Array),
				maxTokens: expect.any(Number),
				temperature: 0,
			})

			expect(result.value).toBeDefined()
			expect(result.done).toBe(false)
		})

		it("should handle streaming response correctly", async () => {
			const iterator = handler.createMessage(systemPrompt, messages)
			const results: ApiStreamTextChunk[] = []

			for await (const chunk of iterator) {
				if ("text" in chunk) {
					results.push(chunk as ApiStreamTextChunk)
				}
			}

			expect(results.length).toBeGreaterThan(0)
			expect(results[0].text).toBe("Test response")
		})

		it("should handle errors gracefully", async () => {
			mockCreate.mockRejectedValueOnce(new Error("API Error"))
			await expect(handler.createMessage(systemPrompt, messages).next()).rejects.toThrow("API Error")
		})

		it("should handle thinking content as reasoning chunks", async () => {
			// Mock stream with thinking content matching new SDK structure
			mockCreate.mockImplementationOnce(async (_options) => {
				const stream = {
					[Symbol.asyncIterator]: async function* () {
						yield {
							data: {
								choices: [
									{
										delta: {
											content: [
												{
													type: "thinking",
													thinking: [{ type: "text", text: "Let me think about this..." }],
												},
												{ type: "text", text: "Here's the answer" },
											],
										},
										index: 0,
									},
								],
							},
						}
					},
				}
				return stream
			})

			const iterator = handler.createMessage(systemPrompt, messages)
			const results: (ApiStreamTextChunk | ApiStreamReasoningChunk)[] = []

			for await (const chunk of iterator) {
				if ("text" in chunk) {
					results.push(chunk as ApiStreamTextChunk | ApiStreamReasoningChunk)
				}
			}

			expect(results).toHaveLength(2)
			expect(results[0]).toEqual({ type: "reasoning", text: "Let me think about this..." })
			expect(results[1]).toEqual({ type: "text", text: "Here's the answer" })
		})

		it("should handle mixed content arrays correctly", async () => {
			// Mock stream with mixed content matching new SDK structure
			mockCreate.mockImplementationOnce(async (_options) => {
				const stream = {
					[Symbol.asyncIterator]: async function* () {
						yield {
							data: {
								choices: [
									{
										delta: {
											content: [
												{ type: "text", text: "First text" },
												{
													type: "thinking",
													thinking: [{ type: "text", text: "Some reasoning" }],
												},
												{ type: "text", text: "Second text" },
											],
										},
										index: 0,
									},
								],
							},
						}
					},
				}
				return stream
			})

			const iterator = handler.createMessage(systemPrompt, messages)
			const results: (ApiStreamTextChunk | ApiStreamReasoningChunk)[] = []

			for await (const chunk of iterator) {
				if ("text" in chunk) {
					results.push(chunk as ApiStreamTextChunk | ApiStreamReasoningChunk)
				}
			}

			expect(results).toHaveLength(3)
			expect(results[0]).toEqual({ type: "text", text: "First text" })
			expect(results[1]).toEqual({ type: "reasoning", text: "Some reasoning" })
			expect(results[2]).toEqual({ type: "text", text: "Second text" })
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully", async () => {
			const prompt = "Test prompt"
			const result = await handler.completePrompt(prompt)

			expect(mockComplete).toHaveBeenCalledWith({
				model: mockOptions.apiModelId,
				messages: [{ role: "user", content: prompt }],
				temperature: 0,
			})

			expect(result).toBe("Test response")
		})

		it("should filter out thinking content in completePrompt", async () => {
			mockComplete.mockImplementationOnce(async (_options) => {
				return {
					choices: [
						{
							message: {
								content: [
									{ type: "thinking", text: "Let me think..." },
									{ type: "text", text: "Answer part 1" },
									{ type: "text", text: "Answer part 2" },
								],
							},
						},
					],
				}
			})

			const prompt = "Test prompt"
			const result = await handler.completePrompt(prompt)

			expect(result).toBe("Answer part 1Answer part 2")
		})

		it("should handle errors in completePrompt", async () => {
			mockComplete.mockRejectedValueOnce(new Error("API Error"))
			await expect(handler.completePrompt("Test prompt")).rejects.toThrow("Mistral completion error: API Error")
		})
	})
})
