import { MistralHandler } from "../mistral"
import { ApiHandlerOptions, mistralDefaultModelId } from "../../../shared/api"
import { Anthropic } from "@anthropic-ai/sdk"
import { ApiStreamTextChunk } from "../../transform/stream"

// Mock Mistral client
const mockCreate = jest.fn()
jest.mock("@mistralai/mistralai", () => {
	return {
		Mistral: jest.fn().mockImplementation(() => ({
			chat: {
				stream: mockCreate.mockImplementation(async (options) => {
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
			},
		})),
	}
})

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
	})
})
