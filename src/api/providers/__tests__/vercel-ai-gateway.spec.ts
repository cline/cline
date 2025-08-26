// npx vitest run src/api/providers/__tests__/vercel-ai-gateway.spec.ts

// Mock vscode first to avoid import errors
vitest.mock("vscode", () => ({}))

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { VercelAiGatewayHandler } from "../vercel-ai-gateway"
import { ApiHandlerOptions } from "../../../shared/api"
import { vercelAiGatewayDefaultModelId, VERCEL_AI_GATEWAY_DEFAULT_TEMPERATURE } from "@roo-code/types"

// Mock dependencies
vitest.mock("openai")
vitest.mock("delay", () => ({ default: vitest.fn(() => Promise.resolve()) }))
vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockImplementation(() => {
		return Promise.resolve({
			"anthropic/claude-sonnet-4": {
				maxTokens: 64000,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: "Claude Sonnet 4",
				supportsComputerUse: true,
			},
			"anthropic/claude-3.5-haiku": {
				maxTokens: 32000,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 1,
				outputPrice: 5,
				cacheWritesPrice: 1.25,
				cacheReadsPrice: 0.1,
				description: "Claude 3.5 Haiku",
				supportsComputerUse: false,
			},
			"openai/gpt-4o": {
				maxTokens: 16000,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 2.5,
				outputPrice: 10,
				cacheWritesPrice: 3.125,
				cacheReadsPrice: 0.25,
				description: "GPT-4o",
				supportsComputerUse: true,
			},
		})
	}),
}))

vitest.mock("../../transform/caching/vercel-ai-gateway", () => ({
	addCacheBreakpoints: vitest.fn(),
}))

const mockCreate = vitest.fn()
const mockConstructor = vitest.fn()

;(OpenAI as any).mockImplementation(() => ({
	chat: {
		completions: {
			create: mockCreate,
		},
	},
}))
;(OpenAI as any).mockImplementation = mockConstructor.mockReturnValue({
	chat: {
		completions: {
			create: mockCreate,
		},
	},
})

describe("VercelAiGatewayHandler", () => {
	const mockOptions: ApiHandlerOptions = {
		vercelAiGatewayApiKey: "test-key",
		vercelAiGatewayModelId: "anthropic/claude-sonnet-4",
	}

	beforeEach(() => {
		vitest.clearAllMocks()
		mockCreate.mockClear()
		mockConstructor.mockClear()
	})

	it("initializes with correct options", () => {
		const handler = new VercelAiGatewayHandler(mockOptions)
		expect(handler).toBeInstanceOf(VercelAiGatewayHandler)

		expect(OpenAI).toHaveBeenCalledWith({
			baseURL: "https://ai-gateway.vercel.sh/v1",
			apiKey: mockOptions.vercelAiGatewayApiKey,
			defaultHeaders: expect.objectContaining({
				"HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",
				"X-Title": "Roo Code",
				"User-Agent": expect.stringContaining("RooCode/"),
			}),
		})
	})

	describe("fetchModel", () => {
		it("returns correct model info when options are provided", async () => {
			const handler = new VercelAiGatewayHandler(mockOptions)
			const result = await handler.fetchModel()

			expect(result.id).toBe(mockOptions.vercelAiGatewayModelId)
			expect(result.info.maxTokens).toBe(64000)
			expect(result.info.contextWindow).toBe(200000)
			expect(result.info.supportsImages).toBe(true)
			expect(result.info.supportsPromptCache).toBe(true)
			expect(result.info.supportsComputerUse).toBe(true)
		})

		it("returns default model info when options are not provided", async () => {
			const handler = new VercelAiGatewayHandler({})
			const result = await handler.fetchModel()
			expect(result.id).toBe(vercelAiGatewayDefaultModelId)
			expect(result.info.supportsPromptCache).toBe(true)
		})

		it("uses vercel ai gateway default model when no model specified", async () => {
			const handler = new VercelAiGatewayHandler({ vercelAiGatewayApiKey: "test-key" })
			const result = await handler.fetchModel()
			expect(result.id).toBe("anthropic/claude-sonnet-4")
		})
	})

	describe("createMessage", () => {
		beforeEach(() => {
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
							cache_creation_input_tokens: 2,
							prompt_tokens_details: {
								cached_tokens: 3,
							},
							cost: 0.005,
						},
					}
				},
			}))
		})

		it("streams text content correctly", async () => {
			const handler = new VercelAiGatewayHandler(mockOptions)
			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks).toHaveLength(2)
			expect(chunks[0]).toEqual({
				type: "text",
				text: "Test response",
			})
			expect(chunks[1]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 5,
				cacheWriteTokens: 2,
				cacheReadTokens: 3,
				totalCost: 0.005,
			})
		})

		it("uses correct temperature from options", async () => {
			const customTemp = 0.5
			const handler = new VercelAiGatewayHandler({
				...mockOptions,
				modelTemperature: customTemp,
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			await handler.createMessage(systemPrompt, messages).next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: customTemp,
				}),
			)
		})

		it("uses default temperature when none provided", async () => {
			const handler = new VercelAiGatewayHandler(mockOptions)

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			await handler.createMessage(systemPrompt, messages).next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: VERCEL_AI_GATEWAY_DEFAULT_TEMPERATURE,
				}),
			)
		})

		it("adds cache breakpoints for supported models", async () => {
			const { addCacheBreakpoints } = await import("../../transform/caching/vercel-ai-gateway")
			const handler = new VercelAiGatewayHandler({
				...mockOptions,
				vercelAiGatewayModelId: "anthropic/claude-3.5-haiku",
			})

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			await handler.createMessage(systemPrompt, messages).next()

			expect(addCacheBreakpoints).toHaveBeenCalled()
		})

		it("sets correct max_completion_tokens", async () => {
			const handler = new VercelAiGatewayHandler(mockOptions)

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			await handler.createMessage(systemPrompt, messages).next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					max_completion_tokens: 64000, // max tokens for sonnet 4
				}),
			)
		})

		it("handles usage info correctly with all Vercel AI Gateway specific fields", async () => {
			const handler = new VercelAiGatewayHandler(mockOptions)
			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			const stream = handler.createMessage(systemPrompt, messages)
			const chunks = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			const usageChunk = chunks.find((chunk) => chunk.type === "usage")
			expect(usageChunk).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 5,
				cacheWriteTokens: 2,
				cacheReadTokens: 3,
				totalCost: 0.005,
			})
		})
	})

	describe("completePrompt", () => {
		beforeEach(() => {
			mockCreate.mockImplementation(async () => ({
				choices: [
					{
						message: { role: "assistant", content: "Test completion response" },
						finish_reason: "stop",
						index: 0,
					},
				],
				usage: {
					prompt_tokens: 8,
					completion_tokens: 4,
					total_tokens: 12,
				},
			}))
		})

		it("completes prompt correctly", async () => {
			const handler = new VercelAiGatewayHandler(mockOptions)
			const prompt = "Complete this: Hello"

			const result = await handler.completePrompt(prompt)

			expect(result).toBe("Test completion response")
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "anthropic/claude-sonnet-4",
					messages: [{ role: "user", content: prompt }],
					stream: false,
					temperature: VERCEL_AI_GATEWAY_DEFAULT_TEMPERATURE,
					max_completion_tokens: 64000,
				}),
			)
		})

		it("uses custom temperature for completion", async () => {
			const customTemp = 0.8
			const handler = new VercelAiGatewayHandler({
				...mockOptions,
				modelTemperature: customTemp,
			})

			await handler.completePrompt("Test prompt")

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: customTemp,
				}),
			)
		})

		it("handles completion errors correctly", async () => {
			const handler = new VercelAiGatewayHandler(mockOptions)
			const errorMessage = "API error"

			mockCreate.mockImplementation(() => {
				throw new Error(errorMessage)
			})

			await expect(handler.completePrompt("Test")).rejects.toThrow(
				`Vercel AI Gateway completion error: ${errorMessage}`,
			)
		})

		it("returns empty string when no content in response", async () => {
			const handler = new VercelAiGatewayHandler(mockOptions)

			mockCreate.mockImplementation(async () => ({
				choices: [
					{
						message: { role: "assistant", content: null },
						finish_reason: "stop",
						index: 0,
					},
				],
			}))

			const result = await handler.completePrompt("Test")
			expect(result).toBe("")
		})
	})

	describe("temperature support", () => {
		it("applies temperature for supported models", async () => {
			const handler = new VercelAiGatewayHandler({
				...mockOptions,
				vercelAiGatewayModelId: "anthropic/claude-sonnet-4",
				modelTemperature: 0.9,
			})

			await handler.completePrompt("Test")

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					temperature: 0.9,
				}),
			)
		})
	})
})
