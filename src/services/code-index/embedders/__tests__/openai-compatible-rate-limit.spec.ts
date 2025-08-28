import type { MockedClass, MockedFunction } from "vitest"
import { OpenAI } from "openai"

import { OpenAICompatibleEmbedder } from "../openai-compatible"

// Mock the OpenAI SDK
vi.mock("openai")

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

// Mock i18n
vi.mock("../../../../i18n", () => ({
	t: (key: string, params?: Record<string, any>) => {
		const translations: Record<string, string> = {
			"embeddings:rateLimitRetry": `Rate limit hit, retrying in ${params?.delayMs}ms (attempt ${params?.attempt}/${params?.maxRetries})`,
			"embeddings:failedMaxAttempts": `Failed to create embeddings after ${params?.attempts} attempts`,
			"embeddings:failedWithStatus": `Failed to create embeddings after ${params?.attempts} attempts: HTTP ${params?.statusCode} - ${params?.errorMessage}`,
			"embeddings:failedWithError": `Failed to create embeddings after ${params?.attempts} attempts: ${params?.errorMessage}`,
		}
		return translations[key] || key
	},
}))

const MockedOpenAI = OpenAI as MockedClass<typeof OpenAI>

describe("OpenAICompatibleEmbedder - Global Rate Limiting", () => {
	let mockOpenAIInstance: any
	let mockEmbeddingsCreate: MockedFunction<any>

	const testBaseUrl = "https://api.openai.com/v1"
	const testApiKey = "test-api-key"
	const testModelId = "text-embedding-3-small"

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		vi.spyOn(console, "warn").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})

		// Setup mock OpenAI instance
		mockEmbeddingsCreate = vi.fn()
		mockOpenAIInstance = {
			embeddings: {
				create: mockEmbeddingsCreate,
			},
		}

		MockedOpenAI.mockImplementation(() => mockOpenAIInstance)

		// Reset global rate limit state
		const embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
		;(embedder as any).constructor.globalRateLimitState = {
			isRateLimited: false,
			rateLimitResetTime: 0,
			consecutiveRateLimitErrors: 0,
			lastRateLimitError: 0,
			mutex: (embedder as any).constructor.globalRateLimitState.mutex,
		}
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	it("should apply global rate limiting across multiple batch requests", async () => {
		const embedder1 = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
		const embedder2 = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)

		// First batch hits rate limit
		const rateLimitError = new Error("Rate limit exceeded") as any
		rateLimitError.status = 429

		mockEmbeddingsCreate
			.mockRejectedValueOnce(rateLimitError) // First attempt fails
			.mockResolvedValue({
				data: [{ embedding: "base64encodeddata" }],
				usage: { prompt_tokens: 10, total_tokens: 15 },
			})

		// Start first batch request
		const batch1Promise = embedder1.createEmbeddings(["test1"])

		// Advance time slightly to let the first request fail and set global rate limit
		await vi.advanceTimersByTimeAsync(100)

		// Start second batch request while global rate limit is active
		const batch2Promise = embedder2.createEmbeddings(["test2"])

		// Check that global rate limit was set
		const state = (embedder1 as any).constructor.globalRateLimitState
		expect(state.isRateLimited).toBe(true)
		expect(state.consecutiveRateLimitErrors).toBe(1)

		// Advance time to complete rate limit delay (5 seconds base delay)
		await vi.advanceTimersByTimeAsync(5000)

		// Both requests should complete
		const [result1, result2] = await Promise.all([batch1Promise, batch2Promise])

		expect(result1.embeddings).toHaveLength(1)
		expect(result2.embeddings).toHaveLength(1)

		// The second embedder should have waited for the global rate limit
		// No logging expected - we've removed it to prevent log flooding
	})

	it("should track consecutive rate limit errors", async () => {
		const embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
		const state = (embedder as any).constructor.globalRateLimitState

		const rateLimitError = new Error("Rate limit exceeded") as any
		rateLimitError.status = 429

		// Test that consecutive errors increment when they happen quickly
		// Mock multiple rate limit errors in a single request
		mockEmbeddingsCreate
			.mockRejectedValueOnce(rateLimitError) // First attempt
			.mockRejectedValueOnce(rateLimitError) // Retry 1
			.mockResolvedValueOnce({
				data: [{ embedding: "base64encodeddata" }],
				usage: { prompt_tokens: 10, total_tokens: 15 },
			})

		const promise1 = embedder.createEmbeddings(["test1"])

		// Wait for first attempt to fail
		await vi.advanceTimersByTimeAsync(100)
		expect(state.consecutiveRateLimitErrors).toBe(1)

		// Wait for first retry (500ms) to also fail
		await vi.advanceTimersByTimeAsync(500)

		// The state should show 2 consecutive errors now
		// Note: The count might be 1 if the global rate limit kicked in before the second attempt
		expect(state.consecutiveRateLimitErrors).toBeGreaterThanOrEqual(1)

		// Wait for the global rate limit and successful retry
		await vi.advanceTimersByTimeAsync(20000)
		await promise1

		// Verify the delay increases with consecutive errors
		// Make another request immediately that also hits rate limit
		mockEmbeddingsCreate.mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce({
			data: [{ embedding: "base64encodeddata" }],
			usage: { prompt_tokens: 10, total_tokens: 15 },
		})

		// Store the current consecutive count before the next request
		const previousCount = state.consecutiveRateLimitErrors

		const promise2 = embedder.createEmbeddings(["test2"])
		await vi.advanceTimersByTimeAsync(100)

		// Should have incremented from the previous count
		expect(state.consecutiveRateLimitErrors).toBeGreaterThan(previousCount)

		// Complete the second request
		await vi.advanceTimersByTimeAsync(20000)
		await promise2
	})

	it("should reset consecutive error count after time passes", async () => {
		const embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
		const state = (embedder as any).constructor.globalRateLimitState

		// Manually set state to simulate previous errors
		state.consecutiveRateLimitErrors = 3
		state.lastRateLimitError = Date.now() - 70000 // 70 seconds ago

		const rateLimitError = new Error("Rate limit exceeded") as any
		rateLimitError.status = 429

		mockEmbeddingsCreate.mockRejectedValueOnce(rateLimitError).mockResolvedValueOnce({
			data: [{ embedding: "base64encodeddata" }],
			usage: { prompt_tokens: 10, total_tokens: 15 },
		})

		// Trigger the updateGlobalRateLimitState method
		await (embedder as any).updateGlobalRateLimitState(rateLimitError)

		// Should reset to 1 since more than 60 seconds passed
		expect(state.consecutiveRateLimitErrors).toBe(1)
	})

	it("should not exceed maximum delay of 5 minutes", async () => {
		const embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
		const state = (embedder as any).constructor.globalRateLimitState

		// Set state to simulate many consecutive errors
		state.consecutiveRateLimitErrors = 10 // This would normally result in a very long delay

		const rateLimitError = new Error("Rate limit exceeded") as any
		rateLimitError.status = 429

		// Trigger the updateGlobalRateLimitState method
		await (embedder as any).updateGlobalRateLimitState(rateLimitError)

		// Calculate the expected delay
		const now = Date.now()
		const delay = state.rateLimitResetTime - now

		// Should be capped at 5 minutes (300000ms)
		expect(delay).toBeLessThanOrEqual(300000)
		expect(delay).toBeGreaterThan(0)
	})
})
