import { vitest, describe, it, expect, beforeEach, afterEach } from "vitest"
import type { MockedClass, MockedFunction } from "vitest"
import { OpenAI } from "openai"
import { OpenAICompatibleEmbedder } from "../openai-compatible"
import { MAX_BATCH_TOKENS, MAX_ITEM_TOKENS, MAX_BATCH_RETRIES, INITIAL_RETRY_DELAY_MS } from "../../constants"

// Mock the OpenAI SDK
vitest.mock("openai")

const MockedOpenAI = OpenAI as MockedClass<typeof OpenAI>

describe("OpenAICompatibleEmbedder", () => {
	let embedder: OpenAICompatibleEmbedder
	let mockOpenAIInstance: any
	let mockEmbeddingsCreate: MockedFunction<any>

	const testBaseUrl = "https://api.example.com/v1"
	const testApiKey = "test-api-key"
	const testModelId = "text-embedding-3-small"

	beforeEach(() => {
		vitest.clearAllMocks()
		vitest.spyOn(console, "warn").mockImplementation(() => {})
		vitest.spyOn(console, "error").mockImplementation(() => {})

		// Setup mock OpenAI instance
		mockEmbeddingsCreate = vitest.fn()
		mockOpenAIInstance = {
			embeddings: {
				create: mockEmbeddingsCreate,
			},
		}

		MockedOpenAI.mockImplementation(() => mockOpenAIInstance)
	})

	afterEach(() => {
		vitest.restoreAllMocks()
	})

	describe("constructor", () => {
		it("should create embedder with valid configuration", () => {
			embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)

			expect(MockedOpenAI).toHaveBeenCalledWith({
				baseURL: testBaseUrl,
				apiKey: testApiKey,
			})
			expect(embedder).toBeDefined()
		})

		it("should use default model when modelId is not provided", () => {
			embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey)

			expect(MockedOpenAI).toHaveBeenCalledWith({
				baseURL: testBaseUrl,
				apiKey: testApiKey,
			})
			expect(embedder).toBeDefined()
		})

		it("should throw error when baseUrl is missing", () => {
			expect(() => new OpenAICompatibleEmbedder("", testApiKey, testModelId)).toThrow(
				"Base URL is required for OpenAI Compatible embedder",
			)
		})

		it("should throw error when apiKey is missing", () => {
			expect(() => new OpenAICompatibleEmbedder(testBaseUrl, "", testModelId)).toThrow(
				"API key is required for OpenAI Compatible embedder",
			)
		})

		it("should throw error when both baseUrl and apiKey are missing", () => {
			expect(() => new OpenAICompatibleEmbedder("", "", testModelId)).toThrow(
				"Base URL is required for OpenAI Compatible embedder",
			)
		})
	})

	describe("embedderInfo", () => {
		beforeEach(() => {
			embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
		})

		it("should return correct embedder info", () => {
			const info = embedder.embedderInfo

			expect(info).toEqual({
				name: "openai-compatible",
			})
		})
	})

	describe("createEmbeddings", () => {
		beforeEach(() => {
			embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
		})

		it("should create embeddings for single text", async () => {
			const testTexts = ["Hello world"]
			const mockResponse = {
				data: [{ embedding: [0.1, 0.2, 0.3] }],
				usage: { prompt_tokens: 10, total_tokens: 15 },
			}
			mockEmbeddingsCreate.mockResolvedValue(mockResponse)

			const result = await embedder.createEmbeddings(testTexts)

			expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
				input: testTexts,
				model: testModelId,
			})
			expect(result).toEqual({
				embeddings: [[0.1, 0.2, 0.3]],
				usage: { promptTokens: 10, totalTokens: 15 },
			})
		})

		it("should create embeddings for multiple texts", async () => {
			const testTexts = ["Hello world", "Goodbye world"]
			const mockResponse = {
				data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
				usage: { prompt_tokens: 20, total_tokens: 30 },
			}
			mockEmbeddingsCreate.mockResolvedValue(mockResponse)

			const result = await embedder.createEmbeddings(testTexts)

			expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
				input: testTexts,
				model: testModelId,
			})
			expect(result).toEqual({
				embeddings: [
					[0.1, 0.2, 0.3],
					[0.4, 0.5, 0.6],
				],
				usage: { promptTokens: 20, totalTokens: 30 },
			})
		})

		it("should use custom model when provided", async () => {
			const testTexts = ["Hello world"]
			const customModel = "custom-embedding-model"
			const mockResponse = {
				data: [{ embedding: [0.1, 0.2, 0.3] }],
				usage: { prompt_tokens: 10, total_tokens: 15 },
			}
			mockEmbeddingsCreate.mockResolvedValue(mockResponse)

			await embedder.createEmbeddings(testTexts, customModel)

			expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
				input: testTexts,
				model: customModel,
			})
		})

		it("should handle missing usage data gracefully", async () => {
			const testTexts = ["Hello world"]
			const mockResponse = {
				data: [{ embedding: [0.1, 0.2, 0.3] }],
				usage: undefined,
			}
			mockEmbeddingsCreate.mockResolvedValue(mockResponse)

			const result = await embedder.createEmbeddings(testTexts)

			expect(result).toEqual({
				embeddings: [[0.1, 0.2, 0.3]],
				usage: { promptTokens: 0, totalTokens: 0 },
			})
		})

		/**
		 * Test batching logic when texts exceed token limits
		 */
		describe("batching logic", () => {
			it("should process texts in batches", async () => {
				// Use normal sized texts that won't be skipped
				const testTexts = ["text1", "text2", "text3"]

				mockEmbeddingsCreate.mockResolvedValue({
					data: [
						{ embedding: [0.1, 0.2, 0.3] },
						{ embedding: [0.4, 0.5, 0.6] },
						{ embedding: [0.7, 0.8, 0.9] },
					],
					usage: { prompt_tokens: 10, total_tokens: 15 },
				})

				await embedder.createEmbeddings(testTexts)

				// Should be called once for normal texts
				expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1)
			})

			it("should skip texts that exceed MAX_ITEM_TOKENS", async () => {
				const normalText = "Hello world"
				const oversizedText = "a".repeat(MAX_ITEM_TOKENS * 5) // Exceeds MAX_ITEM_TOKENS
				const testTexts = [normalText, oversizedText, normalText]

				const mockResponse = {
					data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
					usage: { prompt_tokens: 10, total_tokens: 15 },
				}
				mockEmbeddingsCreate.mockResolvedValue(mockResponse)

				await embedder.createEmbeddings(testTexts)

				// Should warn about oversized text
				expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("exceeds maximum token limit"))

				// Should only process normal texts (1 call for 2 normal texts batched together)
				expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1)
			})

			it("should return correct usage statistics", async () => {
				const testTexts = ["text1", "text2"]

				mockEmbeddingsCreate.mockResolvedValue({
					data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
					usage: { prompt_tokens: 10, total_tokens: 15 },
				})

				const result = await embedder.createEmbeddings(testTexts)

				expect(result.usage).toEqual({
					promptTokens: 10,
					totalTokens: 15,
				})
			})
		})

		/**
		 * Test retry logic with exponential backoff
		 */
		describe("retry logic", () => {
			beforeEach(() => {
				vitest.useFakeTimers()
			})

			afterEach(() => {
				vitest.useRealTimers()
			})

			it("should retry on rate limit errors with exponential backoff", async () => {
				const testTexts = ["Hello world"]
				const rateLimitError = { status: 429, message: "Rate limit exceeded" }

				mockEmbeddingsCreate
					.mockRejectedValueOnce(rateLimitError)
					.mockRejectedValueOnce(rateLimitError)
					.mockResolvedValueOnce({
						data: [{ embedding: [0.1, 0.2, 0.3] }],
						usage: { prompt_tokens: 10, total_tokens: 15 },
					})

				const resultPromise = embedder.createEmbeddings(testTexts)

				// Fast-forward through the delays
				await vitest.advanceTimersByTimeAsync(INITIAL_RETRY_DELAY_MS) // First retry delay
				await vitest.advanceTimersByTimeAsync(INITIAL_RETRY_DELAY_MS * 2) // Second retry delay

				const result = await resultPromise

				expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(3)
				expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Rate limit hit, retrying in"))
				expect(result).toEqual({
					embeddings: [[0.1, 0.2, 0.3]],
					usage: { promptTokens: 10, totalTokens: 15 },
				})
			})

			it("should not retry on non-rate-limit errors", async () => {
				const testTexts = ["Hello world"]
				const authError = new Error("Unauthorized")
				;(authError as any).status = 401

				mockEmbeddingsCreate.mockRejectedValue(authError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings: batch processing error",
				)

				expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1)
				expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("Rate limit hit"))
			})

			it("should throw error immediately on non-retryable errors", async () => {
				const testTexts = ["Hello world"]
				const serverError = new Error("Internal server error")
				;(serverError as any).status = 500

				mockEmbeddingsCreate.mockRejectedValue(serverError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings: batch processing error",
				)

				expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1)
			})
		})

		/**
		 * Test error handling scenarios
		 */
		describe("error handling", () => {
			it("should handle API errors gracefully", async () => {
				const testTexts = ["Hello world"]
				const apiError = new Error("API connection failed")

				mockEmbeddingsCreate.mockRejectedValue(apiError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings: batch processing error",
				)

				expect(console.error).toHaveBeenCalledWith(
					expect.stringContaining("Failed to process batch"),
					expect.any(Error),
				)
			})

			it("should handle batch processing errors", async () => {
				const testTexts = ["text1", "text2"]
				const batchError = new Error("Batch processing failed")

				mockEmbeddingsCreate.mockRejectedValue(batchError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings: batch processing error",
				)

				expect(console.error).toHaveBeenCalledWith("Failed to process batch:", batchError)
			})

			it("should handle empty text arrays", async () => {
				const testTexts: string[] = []

				const result = await embedder.createEmbeddings(testTexts)

				expect(result).toEqual({
					embeddings: [],
					usage: { promptTokens: 0, totalTokens: 0 },
				})
				expect(mockEmbeddingsCreate).not.toHaveBeenCalled()
			})

			it("should handle malformed API responses", async () => {
				const testTexts = ["Hello world"]
				const malformedResponse = {
					data: null,
					usage: { prompt_tokens: 10, total_tokens: 15 },
				}

				mockEmbeddingsCreate.mockResolvedValue(malformedResponse)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow()
			})
		})
	})
})
