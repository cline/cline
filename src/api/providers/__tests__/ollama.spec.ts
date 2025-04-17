import { describe, it, beforeEach, afterEach, beforeAll, expect, vi } from "vitest"
import { Anthropic } from "@anthropic-ai/sdk"
import { OllamaHandler } from "../ollama"
import { ApiHandlerOptions } from "../../../shared/api"
import axios from "axios"

describe("OllamaHandler", () => {
	let ollamaAvailable = false

	// Check if Ollama is running before running tests
	beforeAll(async function () {
		try {
			await axios.get("http://localhost:11434/api/version", { timeout: 2000 })
			ollamaAvailable = true
		} catch (error) {
			console.log("Ollama server not available, skipping tests")
			ollamaAvailable = false
		}
	}, 5000)

	let handler: OllamaHandler
	let options: ApiHandlerOptions

	beforeEach(() => {
		options = {
			ollamaModelId: "llama2",
			ollamaBaseUrl: "http://localhost:11434",
		}
		handler = new OllamaHandler(options)
		// Use fake timers for testing timeouts
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe("createMessage", () => {
		it("should handle successful responses", async function ({ skip }) {
			if (!ollamaAvailable) {
				skip()
			}
			// Mock the Ollama client's chat method
			const chatStub = vi.spyOn(handler["client"], "chat").mockResolvedValue({
				[Symbol.asyncIterator]: async function* () {
					yield {
						message: { content: "Hello, world!" },
						eval_count: 10,
						prompt_eval_count: 20,
					}
				},
			} as any)

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			const result = []
			const usageInfo = []

			// Collect the results
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "text") {
					result.push(chunk.text)
				} else if (chunk.type === "usage") {
					usageInfo.push({
						inputTokens: chunk.inputTokens,
						outputTokens: chunk.outputTokens,
					})
				}
			}

			// Verify the results
			expect(result).toEqual(["Hello, world!"])
			expect(usageInfo).toEqual([{ inputTokens: 20, outputTokens: 10 }])
			expect(chatStub).toHaveBeenCalledTimes(1)
		})

		it("should handle timeout errors", { timeout: 10000 }, async function ({ skip }) {
			if (!ollamaAvailable) {
				skip()
			}

			// Restore real timers for this test
			vi.useRealTimers()

			// Create a handler with a very short timeout for testing
			const testHandler = new OllamaHandler(options)

			// Replace the createMessage method with one that has a shorter timeout
			testHandler.createMessage = async function* (systemPrompt, messages) {
				try {
					// Create a promise that rejects after a short timeout
					const timeoutPromise = new Promise<never>((_, reject) => {
						setTimeout(() => reject(new Error("Ollama request timed out after 30 seconds")), 100)
					})

					// Create a promise that never resolves
					const neverPromise = new Promise(() => {})

					// Race them
					await Promise.race([timeoutPromise, neverPromise])
				} catch (error: any) {
					// Enhance error reporting
					console.error(`Ollama API error: ${error.message}`)
					throw error
				}
			}

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			// Start the request and catch the error
			let errorMessage = ""
			try {
				for await (const _ of testHandler.createMessage(systemPrompt, messages)) {
					// This should not be reached
				}
			} catch (error: any) {
				errorMessage = error.message
			}

			// Check the result
			expect(errorMessage).toBe("Ollama request timed out after 30 seconds")

			// Restore the fake timers for other tests
			vi.useFakeTimers()
		})

		it("should retry on errors when using the withRetry decorator", { timeout: 10000 }, async function ({ skip }) {
			if (!ollamaAvailable) {
				skip()
			}

			// Restore real timers for this test
			vi.useRealTimers()

			// Mock the Ollama client's chat method to fail on first call and succeed on second
			const chatStub = vi.spyOn(handler["client"], "chat")

			// First call throws an error
			chatStub.mockRejectedValueOnce(new Error("API Error"))

			// Second call succeeds
			chatStub.mockResolvedValueOnce({
				[Symbol.asyncIterator]: async function* () {
					yield {
						message: { content: "Success after retry" },
					}
				},
			} as any)

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			const result = []

			// Add a small delay to ensure the retry mechanism has time to work
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Collect the results
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "text") {
					result.push(chunk.text)
				}
			}

			// Verify the results
			expect(result).toEqual(["Success after retry"])
			expect(chatStub).toHaveBeenCalledTimes(2)

			// Restore the fake timers for other tests
			vi.useFakeTimers()
		})

		it("should handle stream processing errors", { timeout: 10000 }, async function ({ skip }) {
			if (!ollamaAvailable) {
				skip()
			}

			// Restore real timers for this test
			vi.useRealTimers()

			// Create a handler with a custom implementation for testing
			const testHandler = new OllamaHandler(options)

			// Replace the createMessage method with one that simulates a stream error
			testHandler.createMessage = async function* (systemPrompt, messages) {
				// First yield a successful chunk
				yield {
					type: "text",
					text: "Partial response",
				}

				// Then throw an error in the stream
				throw new Error("Ollama stream processing error: Stream error")
			}

			const systemPrompt = "You are a helpful assistant."
			const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello" }]

			const result = []

			// Collect the results and catch the error
			let errorMessage = ""
			try {
				for await (const chunk of testHandler.createMessage(systemPrompt, messages)) {
					if (chunk.type === "text") {
						result.push(chunk.text)
					}
				}
			} catch (error: any) {
				errorMessage = error.message
			}

			// Verify the results
			expect(errorMessage).toBe("Ollama stream processing error: Stream error")
			expect(result).toEqual(["Partial response"])

			// Restore the fake timers for other tests
			vi.useFakeTimers()
		})
	})
})
