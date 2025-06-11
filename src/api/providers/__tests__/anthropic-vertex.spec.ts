// npx vitest run src/api/providers/__tests__/anthropic-vertex.spec.ts

import { vitest, describe, it, expect } from "vitest"
import { Anthropic } from "@anthropic-ai/sdk"
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk"

import { ApiStreamChunk } from "../../transform/stream"

import { AnthropicVertexHandler } from "../anthropic-vertex"

vitest.mock("@anthropic-ai/vertex-sdk", () => ({
	AnthropicVertex: vitest.fn().mockImplementation(() => ({
		messages: {
			create: vitest.fn().mockImplementation(async (options) => {
				if (!options.stream) {
					return {
						id: "test-completion",
						content: [{ type: "text", text: "Test response" }],
						role: "assistant",
						model: options.model,
						usage: {
							input_tokens: 10,
							output_tokens: 5,
						},
					}
				}
				return {
					async *[Symbol.asyncIterator]() {
						yield {
							type: "message_start",
							message: {
								usage: {
									input_tokens: 10,
									output_tokens: 5,
								},
							},
						}
						yield {
							type: "content_block_start",
							content_block: {
								type: "text",
								text: "Test response",
							},
						}
					},
				}
			}),
		},
	})),
}))

describe("VertexHandler", () => {
	let handler: AnthropicVertexHandler

	describe("constructor", () => {
		it("should initialize with provided config for Claude", () => {
			handler = new AnthropicVertexHandler({
				apiModelId: "claude-3-5-sonnet-v2@20241022",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
			})

			expect(AnthropicVertex).toHaveBeenCalledWith({
				projectId: "test-project",
				region: "us-central1",
			})
		})
	})

	describe("createMessage", () => {
		const mockMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello",
			},
			{
				role: "assistant",
				content: "Hi there!",
			},
		]

		const systemPrompt = "You are a helpful assistant"

		it("should handle streaming responses correctly for Claude", async () => {
			handler = new AnthropicVertexHandler({
				apiModelId: "claude-3-5-sonnet-v2@20241022",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
			})

			const mockStream = [
				{
					type: "message_start",
					message: {
						usage: {
							input_tokens: 10,
							output_tokens: 0,
						},
					},
				},
				{
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "text",
						text: "Hello",
					},
				},
				{
					type: "content_block_delta",
					delta: {
						type: "text_delta",
						text: " world!",
					},
				},
				{
					type: "message_delta",
					usage: {
						output_tokens: 5,
					},
				},
			]

			// Setup async iterator for mock stream
			const asyncIterator = {
				async *[Symbol.asyncIterator]() {
					for (const chunk of mockStream) {
						yield chunk
					}
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(asyncIterator)
			;(handler["client"].messages as any).create = mockCreate

			const stream = handler.createMessage(systemPrompt, mockMessages)
			const chunks: ApiStreamChunk[] = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(4)
			expect(chunks[0]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 0,
			})
			expect(chunks[1]).toEqual({
				type: "text",
				text: "Hello",
			})
			expect(chunks[2]).toEqual({
				type: "text",
				text: " world!",
			})
			expect(chunks[3]).toEqual({
				type: "usage",
				inputTokens: 0,
				outputTokens: 5,
			})

			expect(mockCreate).toHaveBeenCalledWith({
				model: "claude-3-5-sonnet-v2@20241022",
				max_tokens: 8192,
				temperature: 0,
				system: [
					{
						type: "text",
						text: "You are a helpful assistant",
						cache_control: { type: "ephemeral" },
					},
				],
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "Hello",
								cache_control: { type: "ephemeral" },
							},
						],
					},
					{
						role: "assistant",
						content: "Hi there!",
					},
				],
				stream: true,
			})
		})

		it("should handle multiple content blocks with line breaks for Claude", async () => {
			handler = new AnthropicVertexHandler({
				apiModelId: "claude-3-5-sonnet-v2@20241022",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
			})

			const mockStream = [
				{
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "text",
						text: "First line",
					},
				},
				{
					type: "content_block_start",
					index: 1,
					content_block: {
						type: "text",
						text: "Second line",
					},
				},
			]

			const asyncIterator = {
				async *[Symbol.asyncIterator]() {
					for (const chunk of mockStream) {
						yield chunk
					}
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(asyncIterator)
			;(handler["client"].messages as any).create = mockCreate

			const stream = handler.createMessage(systemPrompt, mockMessages)
			const chunks: ApiStreamChunk[] = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(3)
			expect(chunks[0]).toEqual({
				type: "text",
				text: "First line",
			})
			expect(chunks[1]).toEqual({
				type: "text",
				text: "\n",
			})
			expect(chunks[2]).toEqual({
				type: "text",
				text: "Second line",
			})
		})

		it("should handle API errors for Claude", async () => {
			handler = new AnthropicVertexHandler({
				apiModelId: "claude-3-5-sonnet-v2@20241022",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
			})

			const mockError = new Error("Vertex API error")
			const mockCreate = vitest.fn().mockRejectedValue(mockError)
			;(handler["client"].messages as any).create = mockCreate

			const stream = handler.createMessage(systemPrompt, mockMessages)

			await expect(async () => {
				for await (const _chunk of stream) {
					// Should throw before yielding any chunks
				}
			}).rejects.toThrow("Vertex API error")
		})

		it("should handle prompt caching for supported models for Claude", async () => {
			handler = new AnthropicVertexHandler({
				apiModelId: "claude-3-5-sonnet-v2@20241022",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
			})

			const mockStream = [
				{
					type: "message_start",
					message: {
						usage: {
							input_tokens: 10,
							output_tokens: 0,
							cache_creation_input_tokens: 3,
							cache_read_input_tokens: 2,
						},
					},
				},
				{
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "text",
						text: "Hello",
					},
				},
				{
					type: "content_block_delta",
					delta: {
						type: "text_delta",
						text: " world!",
					},
				},
				{
					type: "message_delta",
					usage: {
						output_tokens: 5,
					},
				},
			]

			const asyncIterator = {
				async *[Symbol.asyncIterator]() {
					for (const chunk of mockStream) {
						yield chunk
					}
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(asyncIterator)
			;(handler["client"].messages as any).create = mockCreate

			const stream = handler.createMessage(systemPrompt, [
				{
					role: "user",
					content: "First message",
				},
				{
					role: "assistant",
					content: "Response",
				},
				{
					role: "user",
					content: "Second message",
				},
			])

			const chunks: ApiStreamChunk[] = []
			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify usage information
			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks).toHaveLength(2)
			expect(usageChunks[0]).toEqual({
				type: "usage",
				inputTokens: 10,
				outputTokens: 0,
				cacheWriteTokens: 3,
				cacheReadTokens: 2,
			})
			expect(usageChunks[1]).toEqual({
				type: "usage",
				inputTokens: 0,
				outputTokens: 5,
			})

			// Verify text content
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks).toHaveLength(2)
			expect(textChunks[0].text).toBe("Hello")
			expect(textChunks[1].text).toBe(" world!")

			// Verify cache control was added correctly
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					system: [
						{
							type: "text",
							text: "You are a helpful assistant",
							cache_control: { type: "ephemeral" },
						},
					],
					messages: [
						expect.objectContaining({
							role: "user",
							content: [
								{
									type: "text",
									text: "First message",
									cache_control: { type: "ephemeral" },
								},
							],
						}),
						expect.objectContaining({
							role: "assistant",
							content: "Response",
						}),
						expect.objectContaining({
							role: "user",
							content: [
								{
									type: "text",
									text: "Second message",
									cache_control: { type: "ephemeral" },
								},
							],
						}),
					],
				}),
			)
		})

		it("should handle cache-related usage metrics for Claude", async () => {
			handler = new AnthropicVertexHandler({
				apiModelId: "claude-3-5-sonnet-v2@20241022",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
			})

			const mockStream = [
				{
					type: "message_start",
					message: {
						usage: {
							input_tokens: 10,
							output_tokens: 0,
							cache_creation_input_tokens: 5,
							cache_read_input_tokens: 3,
						},
					},
				},
				{
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "text",
						text: "Hello",
					},
				},
			]

			const asyncIterator = {
				async *[Symbol.asyncIterator]() {
					for (const chunk of mockStream) {
						yield chunk
					}
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(asyncIterator)
			;(handler["client"].messages as any).create = mockCreate

			const stream = handler.createMessage(systemPrompt, mockMessages)
			const chunks: ApiStreamChunk[] = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Check for cache-related metrics in usage chunk
			const usageChunks = chunks.filter((chunk) => chunk.type === "usage")
			expect(usageChunks.length).toBeGreaterThan(0)
			expect(usageChunks[0]).toHaveProperty("cacheWriteTokens", 5)
			expect(usageChunks[0]).toHaveProperty("cacheReadTokens", 3)
		})
	})

	describe("thinking functionality", () => {
		const mockMessages: Anthropic.Messages.MessageParam[] = [
			{
				role: "user",
				content: "Hello",
			},
		]

		const systemPrompt = "You are a helpful assistant"

		it("should handle thinking content blocks and deltas for Claude", async () => {
			handler = new AnthropicVertexHandler({
				apiModelId: "claude-3-5-sonnet-v2@20241022",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
			})

			const mockStream = [
				{
					type: "message_start",
					message: {
						usage: {
							input_tokens: 10,
							output_tokens: 0,
						},
					},
				},
				{
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "thinking",
						thinking: "Let me think about this...",
					},
				},
				{
					type: "content_block_delta",
					delta: {
						type: "thinking_delta",
						thinking: " I need to consider all options.",
					},
				},
				{
					type: "content_block_start",
					index: 1,
					content_block: {
						type: "text",
						text: "Here's my answer:",
					},
				},
			]

			// Setup async iterator for mock stream
			const asyncIterator = {
				async *[Symbol.asyncIterator]() {
					for (const chunk of mockStream) {
						yield chunk
					}
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(asyncIterator)
			;(handler["client"].messages as any).create = mockCreate

			const stream = handler.createMessage(systemPrompt, mockMessages)
			const chunks: ApiStreamChunk[] = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			// Verify thinking content is processed correctly
			const reasoningChunks = chunks.filter((chunk) => chunk.type === "reasoning")
			expect(reasoningChunks).toHaveLength(2)
			expect(reasoningChunks[0].text).toBe("Let me think about this...")
			expect(reasoningChunks[1].text).toBe(" I need to consider all options.")

			// Verify text content is processed correctly
			const textChunks = chunks.filter((chunk) => chunk.type === "text")
			expect(textChunks).toHaveLength(2) // One for the text block, one for the newline
			expect(textChunks[0].text).toBe("\n")
			expect(textChunks[1].text).toBe("Here's my answer:")
		})

		it("should handle multiple thinking blocks with line breaks for Claude", async () => {
			handler = new AnthropicVertexHandler({
				apiModelId: "claude-3-5-sonnet-v2@20241022",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
			})

			const mockStream = [
				{
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "thinking",
						thinking: "First thinking block",
					},
				},
				{
					type: "content_block_start",
					index: 1,
					content_block: {
						type: "thinking",
						thinking: "Second thinking block",
					},
				},
			]

			const asyncIterator = {
				async *[Symbol.asyncIterator]() {
					for (const chunk of mockStream) {
						yield chunk
					}
				},
			}

			const mockCreate = vitest.fn().mockResolvedValue(asyncIterator)
			;(handler["client"].messages as any).create = mockCreate

			const stream = handler.createMessage(systemPrompt, mockMessages)
			const chunks: ApiStreamChunk[] = []

			for await (const chunk of stream) {
				chunks.push(chunk)
			}

			expect(chunks.length).toBe(3)
			expect(chunks[0]).toEqual({
				type: "reasoning",
				text: "First thinking block",
			})
			expect(chunks[1]).toEqual({
				type: "reasoning",
				text: "\n",
			})
			expect(chunks[2]).toEqual({
				type: "reasoning",
				text: "Second thinking block",
			})
		})
	})

	describe("completePrompt", () => {
		it("should complete prompt successfully for Claude", async () => {
			handler = new AnthropicVertexHandler({
				apiModelId: "claude-3-5-sonnet-v2@20241022",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
			})

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("Test response")
			expect(handler["client"].messages.create).toHaveBeenCalledWith({
				model: "claude-3-5-sonnet-v2@20241022",
				max_tokens: 8192,
				temperature: 0,
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: "Test prompt", cache_control: { type: "ephemeral" } }],
					},
				],
				stream: false,
			})
		})

		it("should handle API errors for Claude", async () => {
			handler = new AnthropicVertexHandler({
				apiModelId: "claude-3-5-sonnet-v2@20241022",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
			})

			const mockError = new Error("Vertex API error")
			const mockCreate = vitest.fn().mockRejectedValue(mockError)
			;(handler["client"].messages as any).create = mockCreate

			await expect(handler.completePrompt("Test prompt")).rejects.toThrow(
				"Vertex completion error: Vertex API error",
			)
		})

		it("should handle non-text content for Claude", async () => {
			handler = new AnthropicVertexHandler({
				apiModelId: "claude-3-5-sonnet-v2@20241022",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
			})

			const mockCreate = vitest.fn().mockResolvedValue({
				content: [{ type: "image" }],
			})
			;(handler["client"].messages as any).create = mockCreate

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})

		it("should handle empty response for Claude", async () => {
			handler = new AnthropicVertexHandler({
				apiModelId: "claude-3-5-sonnet-v2@20241022",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
			})

			const mockCreate = vitest.fn().mockResolvedValue({
				content: [{ type: "text", text: "" }],
			})
			;(handler["client"].messages as any).create = mockCreate

			const result = await handler.completePrompt("Test prompt")
			expect(result).toBe("")
		})
	})

	describe("getModel", () => {
		it("should return correct model info for Claude", () => {
			handler = new AnthropicVertexHandler({
				apiModelId: "claude-3-5-sonnet-v2@20241022",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
			})

			const modelInfo = handler.getModel()
			expect(modelInfo.id).toBe("claude-3-5-sonnet-v2@20241022")
			expect(modelInfo.info).toBeDefined()
			expect(modelInfo.info.maxTokens).toBe(8192)
			expect(modelInfo.info.contextWindow).toBe(200_000)
		})

		it("honors custom maxTokens for thinking models", () => {
			const handler = new AnthropicVertexHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-3-7-sonnet@20250219:thinking",
				modelMaxTokens: 32_768,
				modelMaxThinkingTokens: 16_384,
			})

			const result = handler.getModel()
			expect(result.maxTokens).toBe(32_768)
			expect(result.reasoningBudget).toEqual(16_384)
			expect(result.temperature).toBe(1.0)
		})

		it("does not honor custom maxTokens for non-thinking models", () => {
			const handler = new AnthropicVertexHandler({
				apiKey: "test-api-key",
				apiModelId: "claude-3-7-sonnet@20250219",
				modelMaxTokens: 32_768,
				modelMaxThinkingTokens: 16_384,
			})

			const result = handler.getModel()
			expect(result.maxTokens).toBe(8192)
			expect(result.reasoningBudget).toBeUndefined()
			expect(result.temperature).toBe(0)
		})
	})

	describe("thinking model configuration", () => {
		it("should configure thinking for models with :thinking suffix", () => {
			const thinkingHandler = new AnthropicVertexHandler({
				apiModelId: "claude-3-7-sonnet@20250219:thinking",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
				modelMaxTokens: 16384,
				modelMaxThinkingTokens: 4096,
			})

			const modelInfo = thinkingHandler.getModel()

			expect(modelInfo.id).toBe("claude-3-7-sonnet@20250219")
			expect(modelInfo.reasoningBudget).toBe(4096)
			expect(modelInfo.temperature).toBe(1.0) // Thinking requires temperature 1.0.
		})

		it("should calculate thinking budget correctly", () => {
			// Test with explicit thinking budget
			const handlerWithBudget = new AnthropicVertexHandler({
				apiModelId: "claude-3-7-sonnet@20250219:thinking",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
				modelMaxTokens: 16384,
				modelMaxThinkingTokens: 5000,
			})

			expect(handlerWithBudget.getModel().reasoningBudget).toBe(5000)

			// Test with default thinking budget (80% of max tokens)
			const handlerWithDefaultBudget = new AnthropicVertexHandler({
				apiModelId: "claude-3-7-sonnet@20250219:thinking",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
				modelMaxTokens: 10000,
			})

			expect(handlerWithDefaultBudget.getModel().reasoningBudget).toBe(8000) // 80% of 10000

			// Test with minimum thinking budget (should be at least 1024)
			const handlerWithSmallMaxTokens = new AnthropicVertexHandler({
				apiModelId: "claude-3-7-sonnet@20250219:thinking",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
				modelMaxTokens: 1000, // This would result in 800 tokens for thinking, but minimum is 1024
			})

			expect(handlerWithSmallMaxTokens.getModel().reasoningBudget).toBe(1024)
		})

		it("should pass thinking configuration to API", async () => {
			const thinkingHandler = new AnthropicVertexHandler({
				apiModelId: "claude-3-7-sonnet@20250219:thinking",
				vertexProjectId: "test-project",
				vertexRegion: "us-central1",
				modelMaxTokens: 16384,
				modelMaxThinkingTokens: 4096,
			})

			const mockCreate = vitest.fn().mockImplementation(async (options) => {
				if (!options.stream) {
					return {
						id: "test-completion",
						content: [{ type: "text", text: "Test response" }],
						role: "assistant",
						model: options.model,
						usage: { input_tokens: 10, output_tokens: 5 },
					}
				}
				return {
					async *[Symbol.asyncIterator]() {
						yield { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 5 } } }
					},
				}
			})
			;(thinkingHandler["client"].messages as any).create = mockCreate

			await thinkingHandler
				.createMessage("You are a helpful assistant", [{ role: "user", content: "Hello" }])
				.next()

			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					thinking: { type: "enabled", budget_tokens: 4096 },
					temperature: 1.0, // Thinking requires temperature 1.0
				}),
			)
		})
	})
})
