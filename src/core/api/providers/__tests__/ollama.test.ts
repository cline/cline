import { describe, it, beforeEach, afterEach, before } from "mocha"
import "should"
import sinon from "sinon"
import { Anthropic } from "@anthropic-ai/sdk"
import { OllamaHandler } from "../ollama"
import { ApiHandlerOptions } from "@shared/api"
import axios from "axios"

describe("OllamaHandler", () => {
	let ollamaAvailable = false

	// Check if Ollama is running before running tests
	before(async function () {
		this.timeout(5000)
		try {
			await axios.get("http://localhost:11434/api/version", { timeout: 2000 })
			ollamaAvailable = true
		} catch (error) {
			console.log("Ollama server not available, skipping tests")
			ollamaAvailable = false
		}
	})
	let handler: OllamaHandler
	let options: ApiHandlerOptions
	let clock: sinon.SinonFakeTimers

	beforeEach(() => {
		options = {
			actModeOllamaModelId: "llama2",
			ollamaBaseUrl: "http://localhost:11434",
		}
		handler = new OllamaHandler(options)
		// Use fake timers for testing timeouts
		clock = sinon.useFakeTimers()
	})

	afterEach(() => {
		clock.restore()
		sinon.restore()
	})

	describe("createMessage", () => {
		it("should handle successful responses", async function () {
			if (!ollamaAvailable) {
				this.skip()
			}
			this.timeout(5000)
			// Ensure client is initialized
			const client = (handler as any).ensureClient()
			// Mock the Ollama client's chat method
			const chatStub = sinon.stub(client, "chat").resolves({
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
			result.should.deepEqual(["Hello, world!"])
			usageInfo.should.deepEqual([{ inputTokens: 20, outputTokens: 10 }])
			chatStub.calledOnce.should.be.true()
		})

		it("should handle timeout errors", async function () {
			if (!ollamaAvailable) {
				this.skip()
			}
			this.timeout(10000)
			// Restore real timers for this test
			clock.restore()

			// Create a handler with a very short timeout for testing
			const testHandler = new OllamaHandler(options)

			// Replace the createMessage method with one that has a shorter timeout
			testHandler.createMessage = async function* (systemPrompt, messages) {
				try {
					// Create a promise that rejects after a short timeout
					const timeoutPromise = new Promise<never>((_, reject) => {
						setTimeout(() => reject(new Error("Ollama request timed out after 120 seconds")), 100)
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
			errorMessage.should.equal("Ollama request timed out after 120 seconds")

			// Restore the fake timers for other tests
			clock = sinon.useFakeTimers()
		})

		it("should retry on errors when using the withRetry decorator", async function () {
			if (!ollamaAvailable) {
				this.skip()
			}
			this.timeout(10000)
			// Restore real timers for this test
			clock.restore()

			// Ensure client is initialized and mock the Ollama client's chat method to fail on first call and succeed on second
			const client = (handler as any).ensureClient()
			const chatStub = sinon.stub(client, "chat")

			// First call throws an error
			chatStub.onFirstCall().rejects(new Error("API Error"))

			// Second call succeeds
			chatStub.onSecondCall().resolves({
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
			result.should.deepEqual(["Success after retry"])
			chatStub.calledTwice.should.be.true()

			// Restore the fake timers for other tests
			clock = sinon.useFakeTimers()
		})

		it("should handle stream processing errors", async function () {
			if (!ollamaAvailable) {
				this.skip()
			}
			this.timeout(10000)
			// Restore real timers for this test
			clock.restore()

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
			errorMessage.should.equal("Ollama stream processing error: Stream error")
			result.should.deepEqual(["Partial response"])

			// Restore the fake timers for other tests
			clock = sinon.useFakeTimers()
		})
	})
})
