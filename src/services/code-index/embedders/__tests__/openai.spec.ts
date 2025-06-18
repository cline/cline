import { vitest, describe, it, expect, beforeEach, afterEach } from "vitest"
import type { MockedClass, MockedFunction } from "vitest"
import { OpenAI } from "openai"
import { OpenAiEmbedder } from "../openai"
import { MAX_BATCH_TOKENS, MAX_ITEM_TOKENS, MAX_BATCH_RETRIES, INITIAL_RETRY_DELAY_MS } from "../../constants"

// Mock the OpenAI SDK
vitest.mock("openai")

// Mock i18n
vitest.mock("../../../../i18n", () => ({
	t: (key: string, params?: Record<string, any>) => {
		const translations: Record<string, string> = {
			"embeddings:authenticationFailed":
				"Failed to create embeddings: Authentication failed. Please check your OpenAI API key.",
			"embeddings:failedWithStatus": `Failed to create embeddings after ${params?.attempts} attempts: HTTP ${params?.statusCode} - ${params?.errorMessage}`,
			"embeddings:failedWithError": `Failed to create embeddings after ${params?.attempts} attempts: ${params?.errorMessage}`,
			"embeddings:failedMaxAttempts": `Failed to create embeddings after ${params?.attempts} attempts`,
			"embeddings:textExceedsTokenLimit": `Text at index ${params?.index} exceeds maximum token limit (${params?.itemTokens} > ${params?.maxTokens}). Skipping.`,
			"embeddings:rateLimitRetry": `Rate limit hit, retrying in ${params?.delayMs}ms (attempt ${params?.attempt}/${params?.maxRetries})`,
		}
		return translations[key] || key
	},
}))

// Mock console methods
const consoleMocks = {
	error: vitest.spyOn(console, "error").mockImplementation(() => {}),
	warn: vitest.spyOn(console, "warn").mockImplementation(() => {}),
}

describe("OpenAiEmbedder", () => {
	let embedder: OpenAiEmbedder
	let mockEmbeddingsCreate: MockedFunction<any>
	let MockedOpenAI: MockedClass<typeof OpenAI>

	beforeEach(() => {
		vitest.clearAllMocks()
		consoleMocks.error.mockClear()
		consoleMocks.warn.mockClear()

		MockedOpenAI = OpenAI as MockedClass<typeof OpenAI>
		mockEmbeddingsCreate = vitest.fn()

		MockedOpenAI.prototype.embeddings = {
			create: mockEmbeddingsCreate,
		} as any

		embedder = new OpenAiEmbedder({
			openAiNativeApiKey: "test-api-key",
			openAiEmbeddingModelId: "text-embedding-3-small",
		})
	})

	afterEach(() => {
		vitest.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided options", () => {
			expect(MockedOpenAI).toHaveBeenCalledWith({ apiKey: "test-api-key" })
			expect(embedder.embedderInfo.name).toBe("openai")
		})

		it("should use 'not-provided' if API key is not provided", () => {
			const embedderWithoutKey = new OpenAiEmbedder({
				openAiEmbeddingModelId: "text-embedding-3-small",
			})

			expect(MockedOpenAI).toHaveBeenCalledWith({ apiKey: "not-provided" })
		})

		it("should use default model if not specified", () => {
			const embedderWithDefaultModel = new OpenAiEmbedder({
				openAiNativeApiKey: "test-api-key",
			})
			// We can't directly test the defaultModelId but it should be text-embedding-3-small
			expect(embedderWithDefaultModel).toBeDefined()
		})
	})

	describe("createEmbeddings", () => {
		const testModelId = "text-embedding-3-small"

		it("should create embeddings for a single text", async () => {
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
			const testTexts = ["Hello world", "Another text"]
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
			const customModel = "text-embedding-ada-002"
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
					data: testTexts.map((_, i) => ({ embedding: [i, i + 0.1, i + 0.2] })),
					usage: { prompt_tokens: 30, total_tokens: 45 },
				})

				const result = await embedder.createEmbeddings(testTexts)

				expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1)
				expect(result.embeddings).toHaveLength(3)
				expect(result.usage?.promptTokens).toBe(30)
			})

			it("should warn and skip texts exceeding maximum token limit", async () => {
				// Create a text that exceeds MAX_ITEM_TOKENS (4 characters ≈ 1 token)
				const oversizedText = "a".repeat(MAX_ITEM_TOKENS * 4 + 100)
				const normalText = "normal text"
				const testTexts = [normalText, oversizedText, "another normal"]

				mockEmbeddingsCreate.mockResolvedValue({
					data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
					usage: { prompt_tokens: 20, total_tokens: 30 },
				})

				const result = await embedder.createEmbeddings(testTexts)

				// Verify warning was logged
				expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`exceeds maximum token limit`))

				// Verify only normal texts were processed
				expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
					input: [normalText, "another normal"],
					model: testModelId,
				})
				expect(result.embeddings).toHaveLength(2)
			})

			it("should handle multiple batches when total tokens exceed batch limit", async () => {
				// Create texts that will require multiple batches
				// Each text needs to be less than MAX_ITEM_TOKENS (8191) but together exceed MAX_BATCH_TOKENS (100000)
				// Let's use 8000 tokens per text (safe under MAX_ITEM_TOKENS)
				const tokensPerText = 8000
				const largeText = "a".repeat(tokensPerText * 4) // 4 chars ≈ 1 token
				// Create 15 texts * 8000 tokens = 120000 tokens total
				const testTexts = Array(15).fill(largeText)

				// Mock responses for each batch
				// First batch will have 12 texts (96000 tokens), second batch will have 3 texts (24000 tokens)
				mockEmbeddingsCreate
					.mockResolvedValueOnce({
						data: Array(12)
							.fill(null)
							.map((_, i) => ({ embedding: [i * 0.1, i * 0.1 + 0.1, i * 0.1 + 0.2] })),
						usage: { prompt_tokens: 96000, total_tokens: 96000 },
					})
					.mockResolvedValueOnce({
						data: Array(3)
							.fill(null)
							.map((_, i) => ({
								embedding: [(12 + i) * 0.1, (12 + i) * 0.1 + 0.1, (12 + i) * 0.1 + 0.2],
							})),
						usage: { prompt_tokens: 24000, total_tokens: 24000 },
					})

				const result = await embedder.createEmbeddings(testTexts)

				expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(2)
				expect(result.embeddings).toHaveLength(15)
				expect(result.usage?.promptTokens).toBe(120000)
				expect(result.usage?.totalTokens).toBe(120000)
			})

			it("should handle all texts being skipped due to size", async () => {
				const oversizedText = "a".repeat(MAX_ITEM_TOKENS * 4 + 100)
				const testTexts = [oversizedText, oversizedText]

				const result = await embedder.createEmbeddings(testTexts)

				expect(console.warn).toHaveBeenCalledTimes(2)
				expect(mockEmbeddingsCreate).not.toHaveBeenCalled()
				expect(result).toEqual({
					embeddings: [],
					usage: { promptTokens: 0, totalTokens: 0 },
				})
			})
		})

		/**
		 * Test retry logic for rate limiting and other errors
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
					"Failed to create embeddings: Authentication failed. Please check your OpenAI API key.",
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
					"Failed to create embeddings after 3 attempts: HTTP 500 - Internal server error",
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
					"Failed to create embeddings after 3 attempts: API connection failed",
				)

				expect(console.error).toHaveBeenCalledWith(
					expect.stringContaining("OpenAI embedder error"),
					expect.any(Error),
				)
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

			it("should provide specific authentication error message", async () => {
				const testTexts = ["Hello world"]
				const authError = new Error("Invalid API key")
				;(authError as any).status = 401

				mockEmbeddingsCreate.mockRejectedValue(authError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings: Authentication failed. Please check your OpenAI API key.",
				)
			})

			it("should provide detailed error message for HTTP errors", async () => {
				const testTexts = ["Hello world"]
				const httpError = new Error("Bad request")
				;(httpError as any).status = 400

				mockEmbeddingsCreate.mockRejectedValue(httpError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings after 3 attempts: HTTP 400 - Bad request",
				)
			})

			it("should handle errors without status codes", async () => {
				const testTexts = ["Hello world"]
				const networkError = new Error("Network timeout")

				mockEmbeddingsCreate.mockRejectedValue(networkError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings after 3 attempts: Network timeout",
				)
			})

			it("should handle errors without message property", async () => {
				const testTexts = ["Hello world"]
				const weirdError = { toString: () => "Custom error object" }

				mockEmbeddingsCreate.mockRejectedValue(weirdError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings after 3 attempts: Custom error object",
				)
			})

			it("should handle completely unknown error types", async () => {
				const testTexts = ["Hello world"]
				const unknownError = null

				mockEmbeddingsCreate.mockRejectedValue(unknownError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings after 3 attempts: Unknown error",
				)
			})

			it("should handle string errors", async () => {
				const testTexts = ["Hello world"]
				const stringError = "Something went wrong"

				mockEmbeddingsCreate.mockRejectedValue(stringError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings after 3 attempts: Something went wrong",
				)
			})

			it("should handle errors with failing toString method", async () => {
				const testTexts = ["Hello world"]
				const errorWithFailingToString = {
					toString: () => {
						throw new Error("toString failed")
					},
				}

				mockEmbeddingsCreate.mockRejectedValue(errorWithFailingToString)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings after 3 attempts: Unknown error",
				)
			})

			it("should handle errors from response.status property", async () => {
				const testTexts = ["Hello world"]
				const errorWithResponseStatus = {
					message: "Request failed",
					response: { status: 403 },
				}

				mockEmbeddingsCreate.mockRejectedValue(errorWithResponseStatus)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings after 3 attempts: HTTP 403 - Request failed",
				)
			})
		})
	})
})
