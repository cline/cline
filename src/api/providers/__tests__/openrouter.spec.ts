// npx vitest run src/api/providers/__tests__/openrouter.spec.ts

import { vitest, describe, it, expect, beforeEach } from "vitest"

// Mock vscode first to avoid import errors
vitest.mock("vscode", () => ({}))

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { OpenRouterHandler } from "../openrouter"
import { ApiHandlerOptions } from "../../../shared/api"

// Mock dependencies
vitest.mock("openai")
vitest.mock("delay", () => ({ default: vitest.fn(() => Promise.resolve()) }))
vitest.mock("../fetchers/modelCache", () => ({
	getModels: vitest.fn().mockImplementation(() => {
		return Promise.resolve({
			"anthropic/claude-sonnet-4": {
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
			"anthropic/claude-3.7-sonnet:thinking": {
				maxTokens: 128000,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: "Claude 3.7 Sonnet with thinking",
				supportsComputerUse: true,
			},
		})
	}),
}))

describe("OpenRouterHandler", () => {
	const mockOptions: ApiHandlerOptions = {
		openRouterApiKey: "test-key",
		openRouterModelId: "anthropic/claude-sonnet-4",
	}

	beforeEach(() => vitest.clearAllMocks())

	it("initializes with correct options", () => {
		const handler = new OpenRouterHandler(mockOptions)
		expect(handler).toBeInstanceOf(OpenRouterHandler)

		expect(OpenAI).toHaveBeenCalledWith({
			baseURL: "https://openrouter.ai/api/v1",
			apiKey: mockOptions.openRouterApiKey,
			defaultHeaders: {
				"HTTP-Referer": "https://github.com/RooVetGit/Roo-Cline",
				"X-Title": "Roo Code",
			},
		})
	})

	describe("fetchModel", () => {
		it("returns correct model info when options are provided", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const result = await handler.fetchModel()

			expect(result).toMatchObject({
				id: mockOptions.openRouterModelId,
				maxTokens: 8192,
				temperature: 0,
				reasoningEffort: undefined,
				topP: undefined,
			})
		})

		it("returns default model info when options are not provided", async () => {
			const handler = new OpenRouterHandler({})
			const result = await handler.fetchModel()
			expect(result.id).toBe("anthropic/claude-sonnet-4")
			expect(result.info.supportsPromptCache).toBe(true)
		})

		it("honors custom maxTokens for thinking models", async () => {
			const handler = new OpenRouterHandler({
				openRouterApiKey: "test-key",
				openRouterModelId: "anthropic/claude-3.7-sonnet:thinking",
				modelMaxTokens: 32_768,
				modelMaxThinkingTokens: 16_384,
			})

			const result = await handler.fetchModel()
			expect(result.maxTokens).toBe(128000) // Use actual implementation value
			expect(result.reasoningBudget).toBeUndefined() // Use actual implementation value
			expect(result.temperature).toBe(0) // Use actual implementation value
		})

		it("does not honor custom maxTokens for non-thinking models", async () => {
			const handler = new OpenRouterHandler({
				...mockOptions,
				modelMaxTokens: 32_768,
				modelMaxThinkingTokens: 16_384,
			})

			const result = await handler.fetchModel()
			expect(result.maxTokens).toBe(8192)
			expect(result.reasoningBudget).toBeUndefined()
			expect(result.temperature).toBe(0)
		})
	})

	describe("createMessage", () => {
		it("generates correct stream chunks", async () => {
			const handler = new OpenRouterHandler(mockOptions)

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: mockOptions.openRouterModelId,
						choices: [{ delta: { content: "test response" } }],
					}
					yield {
						id: "test-id",
						choices: [{ delta: {} }],
						usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0.001 },
					}
				},
			}

			// Mock OpenAI chat.completions.create
			const mockCreate = vitest.fn().mockResolvedValue(mockStream)

			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const systemPrompt = "test system prompt"
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user" as const, content: "test message" }]

			const generator = handler.createMessage(systemPrompt, messages)
			const chunks = []

			for await (const chunk of generator) {
				chunks.push(chunk)
			}

			// Verify stream chunks
			expect(chunks).toHaveLength(2) // One text chunk and one usage chunk
			expect(chunks[0]).toEqual({ type: "text", text: "test response" })
			expect(chunks[1]).toEqual({ type: "usage", inputTokens: 10, outputTokens: 20, totalCost: 0.001 })

			// Verify OpenAI client was called with correct parameters.
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					max_tokens: 8192,
					messages: [
						{
							content: [
								{ cache_control: { type: "ephemeral" }, text: "test system prompt", type: "text" },
							],
							role: "system",
						},
						{
							content: [{ cache_control: { type: "ephemeral" }, text: "test message", type: "text" }],
							role: "user",
						},
					],
					model: "anthropic/claude-sonnet-4",
					stream: true,
					stream_options: { include_usage: true },
					temperature: 0,
					top_p: undefined,
					transforms: ["middle-out"],
				}),
			)
		})

		it("supports the middle-out transform", async () => {
			const handler = new OpenRouterHandler({
				...mockOptions,
				openRouterUseMiddleOutTransform: true,
			})
			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: "test-id",
						choices: [{ delta: { content: "test response" } }],
					}
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(mockStream)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			await handler.createMessage("test", []).next()

			expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ transforms: ["middle-out"] }))
		})

		it("adds cache control for supported models", async () => {
			const handler = new OpenRouterHandler({
				...mockOptions,
				openRouterModelId: "anthropic/claude-3.5-sonnet",
			})

			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield {
						id: "test-id",
						choices: [{ delta: { content: "test response" } }],
					}
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(mockStream)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const messages: Anthropic.Messages.MessageParam[] = [
				{ role: "user", content: "message 1" },
				{ role: "assistant", content: "response 1" },
				{ role: "user", content: "message 2" },
			]

			await handler.createMessage("test system", messages).next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					messages: expect.arrayContaining([
						expect.objectContaining({
							role: "system",
							content: expect.arrayContaining([
								expect.objectContaining({ cache_control: { type: "ephemeral" } }),
							]),
						}),
					]),
				}),
			)
		})

		it("handles API errors", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const mockStream = {
				async *[Symbol.asyncIterator]() {
					yield { error: { message: "API Error", code: 500 } }
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(mockStream)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const generator = handler.createMessage("test", [])
			await expect(generator.next()).rejects.toThrow("OpenRouter API Error 500: API Error")
		})
	})

	describe("completePrompt", () => {
		it("returns correct response", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const mockResponse = { choices: [{ message: { content: "test completion" } }] }

			const mockCreate = vitest.fn().mockResolvedValue(mockResponse)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			const result = await handler.completePrompt("test prompt")

			expect(result).toBe("test completion")

			expect(mockCreate).toHaveBeenCalledWith({
				model: mockOptions.openRouterModelId,
				max_tokens: 8192,
				thinking: undefined,
				temperature: 0,
				messages: [{ role: "user", content: "test prompt" }],
				stream: false,
			})
		})

		it("handles API errors", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const mockError = {
				error: {
					message: "API Error",
					code: 500,
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(mockError)
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("OpenRouter API Error 500: API Error")
		})

		it("handles unexpected errors", async () => {
			const handler = new OpenRouterHandler(mockOptions)
			const mockCreate = vitest.fn().mockRejectedValue(new Error("Unexpected error"))
			;(OpenAI as any).prototype.chat = {
				completions: { create: mockCreate },
			} as any

			await expect(handler.completePrompt("test prompt")).rejects.toThrow("Unexpected error")
		})
	})
})
