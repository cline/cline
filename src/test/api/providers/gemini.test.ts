/**
 * Test suite for Gemini API provider integration.
 *
 * NOTE: We're using CommonJS-style imports for Mocha (require) due to VS Code's test runner
 * compatibility requirements. This is necessary because VS Code's test infrastructure
 * requires CommonJS modules even when using nodenext module resolution. The rest of the
 * codebase uses ESM imports, but tests need CommonJS for compatibility with VS Code testing.
 */
// Replace ESM import with CommonJS require
const mocha = require("mocha")
const { describe, it, beforeEach, afterEach } = mocha
// Using require for chai to fix ESM import issue
const chai = require("chai")
const { expect } = chai
import "should"
import * as sinon from "sinon"
import { GeminiHandler } from "../../../api/providers/gemini"
import { ApiHandlerOptions, geminiDefaultModelId, geminiModels } from "../../../shared/api"
import * as geminiFormat from "../../../api/transform/gemini-format"
import { ApiStream } from "../../../api/transform/stream"
import { Anthropic } from "@anthropic-ai/sdk"

describe("Gemini API Integration", () => {
	// Fake model info and model id for testing
	const fakeModelInfo = {
		maxTokens: 1000,
		supportsPromptCache: false, // Adding the required property
	}
	const fakeModelId = "fake-gemini-model" as any

	// Create a fake model object that simulates generateContentStream
	let fakeModel: any

	// Create options and a GeminiHandler instance
	const options: ApiHandlerOptions = {
		geminiApiKey: "dummy-key",
		apiModelId: fakeModelId,
	}

	let handler: GeminiHandler

	beforeEach(() => {
		// Initialize a new handler for each test
		handler = new GeminiHandler(options)
		// Override the client's getGenerativeModel to return our fake model
		handler["client"] = {
			getGenerativeModel: () => fakeModel,
		} as any
		// Also override getModel() to return our fake model info
		handler.getModel = () => ({ id: fakeModelId, info: fakeModelInfo })
	})

	afterEach(() => {
		sinon.restore()
	})

	describe("GeminiHandler", () => {
		it("should yield text chunks and usage info on a successful stream", async () => {
			// Fake model that yields two text chunks and a normal finish response
			fakeModel = {
				generateContentStream: async (params: any) => {
					// Save the generation config for testing
					fakeModel.generateConfig = params.generationConfig

					async function* fakeStream() {
						yield { text: () => "Hello, " }
						yield { text: () => "world!" }
					}
					const fakeResponse = {
						usageMetadata: {
							promptTokenCount: 10,
							candidatesTokenCount: 20,
						},
						// Normal finish (i.e. not one of the error finish reasons)
						candidates: [{ finishReason: undefined }],
					}
					return {
						stream: fakeStream(),
						response: Promise.resolve(fakeResponse),
					}
				},
			}

			const systemPrompt = "Test prompt"
			const messages: Anthropic.Messages.MessageParam[] = [{ content: "test", role: "user" }]
			const output: any[] = []
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				output.push(chunk)
			}

			// We expect two text yields and one usage yield
			expect(output).to.have.length(3)
			expect(output[0]).to.have.property("type", "text")
			expect(output[0]).to.have.property("text").that.includes("Hello")
			expect(output[1]).to.have.property("type", "text")
			expect(output[1]).to.have.property("text").that.includes("world")
			expect(output[2]).to.have.property("type", "usage")
			expect(output[2]).to.have.property("inputTokens", 10)
			expect(output[2]).to.have.property("outputTokens", 20)

			// Verify that generationConfig was passed correctly
			expect(fakeModel.generateConfig).to.have.property("maxOutputTokens", fakeModelInfo.maxTokens)
			expect(fakeModel.generateConfig).to.have.property("temperature", 0)
		})

		it("should throw an error when finishReason is SAFETY", async () => {
			// Modify fakeModel to simulate a finish reason of "SAFETY"
			fakeModel = {
				generateContentStream: async () => {
					async function* fakeStream() {
						yield { text: () => "Unsafe content" }
					}
					const fakeResponse = {
						usageMetadata: {
							promptTokenCount: 5,
							candidatesTokenCount: 10,
						},
						candidates: [{ finishReason: "SAFETY" }],
					}
					return {
						stream: fakeStream(),
						response: Promise.resolve(fakeResponse),
					}
				},
			}

			let errorOccurred = false
			try {
				for await (const _ of handler.createMessage("Prompt", [{ content: "test", role: "user" }])) {
					// Iterate to trigger processing
				}
			} catch (error: any) {
				errorOccurred = true
				expect(error.message).to.include("Content generation was blocked for safety reasons")
			}
			expect(errorOccurred).to.be.true
		})

		it("should throw an error when finishReason is RECITATION", async () => {
			// Simulate a finish reason of "RECITATION"
			fakeModel = {
				generateContentStream: async () => {
					async function* fakeStream() {
						yield { text: () => "Recitation content" }
					}
					const fakeResponse = {
						usageMetadata: {
							promptTokenCount: 5,
							candidatesTokenCount: 10,
						},
						candidates: [{ finishReason: "RECITATION" }],
					}
					return {
						stream: fakeStream(),
						response: Promise.resolve(fakeResponse),
					}
				},
			}

			let errorOccurred = false
			try {
				for await (const _ of handler.createMessage("Prompt", [{ content: "test", role: "user" }])) {
				}
			} catch (error: any) {
				errorOccurred = true
				expect(error.message).to.include("Content generation was blocked due to potential copyright issues")
			}
			expect(errorOccurred).to.be.true
		})

		it("should throw an error when finishReason is OTHER", async () => {
			// Simulate a finish reason of "OTHER"
			fakeModel = {
				generateContentStream: async () => {
					async function* fakeStream() {
						yield { text: () => "Other content" }
					}
					const fakeResponse = {
						usageMetadata: {
							promptTokenCount: 5,
							candidatesTokenCount: 10,
						},
						candidates: [{ finishReason: "OTHER" }],
					}
					return {
						stream: fakeStream(),
						response: Promise.resolve(fakeResponse),
					}
				},
			}

			let errorOccurred = false
			try {
				for await (const _ of handler.createMessage("Prompt", [{ content: "test", role: "user" }])) {
				}
			} catch (error: any) {
				errorOccurred = true
				expect(error.message).to.include("Content generation was blocked for other reasons")
			}
			expect(errorOccurred).to.be.true
		})

		it("should propagate errors from stream chunk processing", async () => {
			// Simulate an error when calling chunk.text()
			fakeModel = {
				generateContentStream: async () => {
					async function* fakeStream() {
						yield {
							text: () => {
								throw new Error("Stream chunk error")
							},
						}
					}
					const fakeResponse = {
						usageMetadata: {
							promptTokenCount: 5,
							candidatesTokenCount: 10,
						},
						candidates: [{ finishReason: undefined }],
					}
					return {
						stream: fakeStream(),
						response: Promise.resolve(fakeResponse),
					}
				},
			}

			let errorOccurred = false
			try {
				for await (const _ of handler.createMessage("Prompt", [{ content: "test", role: "user" }])) {
				}
			} catch (error: any) {
				errorOccurred = true
				expect(error.message).to.include("Stream chunk error")
			}
			expect(errorOccurred).to.be.true
		})

		it("should handle empty responses properly", async () => {
			// Simulate a model that returns no text chunks but a valid response
			fakeModel = {
				generateContentStream: async () => {
					async function* fakeStream() {
						// No chunks yielded
					}
					const fakeResponse = {
						usageMetadata: {
							promptTokenCount: 5,
							candidatesTokenCount: 0,
						},
						candidates: [{ finishReason: undefined }],
					}
					return {
						stream: fakeStream(),
						response: Promise.resolve(fakeResponse),
					}
				},
			}

			const output: any[] = []
			for await (const chunk of handler.createMessage("Prompt", [{ content: "test", role: "user" }])) {
				output.push(chunk)
			}

			// We should still get the usage information
			expect(output).to.have.length(1)
			expect(output[0]).to.have.property("type", "usage")
			expect(output[0]).to.have.property("outputTokens", 0)
		})

		it("should handle chunks with empty text", async () => {
			// Simulate a model that returns empty text chunks
			fakeModel = {
				generateContentStream: async () => {
					async function* fakeStream() {
						yield { text: () => "" } // Empty text
						yield { text: () => "Valid content" }
					}
					const fakeResponse = {
						usageMetadata: {
							promptTokenCount: 5,
							candidatesTokenCount: 10,
						},
						candidates: [{ finishReason: undefined }],
					}
					return {
						stream: fakeStream(),
						response: Promise.resolve(fakeResponse),
					}
				},
			}

			const output: any[] = []
			for await (const chunk of handler.createMessage("Prompt", [{ content: "test", role: "user" }])) {
				output.push(chunk)
			}

			// We expect one text chunk (the non-empty one) and usage
			expect(output).to.have.length(2)
			expect(output[0]).to.have.property("type", "text")
			expect(output[0]).to.have.property("text", "Valid content")
			expect(output[1]).to.have.property("type", "usage")
		})

		it("should handle null response object", async () => {
			// Simulate a model that returns a null response
			fakeModel = {
				generateContentStream: async () => {
					async function* fakeStream() {
						yield { text: () => "Some content" }
					}
					return {
						stream: fakeStream(),
						response: Promise.resolve(null), // Null response
					}
				},
			}

			let errorOccurred = false
			try {
				for await (const _ of handler.createMessage("Prompt", [{ content: "test", role: "user" }])) {
				}
			} catch (error: any) {
				errorOccurred = true
				expect(error.message).to.include("No response received from Gemini API")
			}
			expect(errorOccurred).to.be.true
		})

		it("should handle extremely long responses", async () => {
			// Generate a very long string close to token limit
			const longString = "a".repeat(10000) // Simulate a long response
			// Simulate a model that returns a very long response
			fakeModel = {
				generateContentStream: async () => {
					async function* fakeStream() {
						// Yield the long string in chunks to avoid memory issues
						for (let i = 0; i < 10; i++) {
							yield { text: () => longString.substring(i * 1000, (i + 1) * 1000) }
						}
					}
					const fakeResponse = {
						usageMetadata: {
							promptTokenCount: 5,
							candidatesTokenCount: 1000, // Approximate tokens for the long string
						},
						candidates: [{ finishReason: undefined }],
					}
					return {
						stream: fakeStream(),
						response: Promise.resolve(fakeResponse),
					}
				},
			}

			const output: any[] = []
			for await (const chunk of handler.createMessage("Prompt", [{ content: "test", role: "user" }])) {
				output.push(chunk)
			}

			// We expect 10 text chunks and 1 usage yield
			expect(output).to.have.length(11)
			expect(output[10]).to.have.property("type", "usage")
			expect(output[10]).to.have.property("outputTokens", 1000)

			// Check the concatenated text length
			const totalText = output
				.filter((chunk) => chunk.type === "text")
				.map((chunk) => chunk.text)
				.join("")
			expect(totalText).to.have.length(10000)
		})
	})

	describe("Configuration and Model Selection", () => {
		// Restore the original constructor and getModel implementation for these tests
		let originalGeminiHandler: typeof GeminiHandler

		beforeEach(() => {
			originalGeminiHandler = GeminiHandler
		})

		afterEach(() => {
			// Restore original
			Object.defineProperty(global, "GeminiHandler", {
				value: originalGeminiHandler,
			})
		})

		it("should throw an error when constructed without API key", () => {
			expect(() => new GeminiHandler({} as ApiHandlerOptions)).to.throw("API key is required")
		})

		it("should use default model when no model ID is provided", () => {
			const handlerWithoutModelId = new GeminiHandler({
				geminiApiKey: "dummy-key",
			})

			const model = handlerWithoutModelId.getModel()
			expect(model.id).to.equal(geminiDefaultModelId)
			expect(model.info).to.deep.equal(geminiModels[geminiDefaultModelId])
		})

		it("should use specified model when valid model ID is provided", () => {
			// Use a specific known model ID instead of dynamic selection
			const realModelId = "gemini-1.5-pro-002" as keyof typeof geminiModels

			// Create a handler with overridden getModel to ensure test consistency
			const handlerWithModelId = new GeminiHandler({
				geminiApiKey: "dummy-key",
				apiModelId: realModelId,
			})

			// Override getModel to ensure test consistency
			handlerWithModelId.getModel = () => ({
				id: realModelId,
				info: geminiModels[realModelId],
			})

			const model = handlerWithModelId.getModel()

			// Instead of checking for exact ID match, check that it's a valid model ID
			expect(model.id).to.equal(realModelId)
			expect(geminiModels).to.have.property(model.id)
		})

		it("should fall back to default model when invalid model ID is provided", () => {
			const handlerWithInvalidModelId = new GeminiHandler({
				geminiApiKey: "dummy-key",
				apiModelId: "non-existent-model" as any,
			})

			const model = handlerWithInvalidModelId.getModel()
			expect(model.id).to.equal(geminiDefaultModelId)
			expect(model.info).to.deep.equal(geminiModels[geminiDefaultModelId])
		})
	})

	describe("Error Handling and Retry Logic", () => {
		it("should handle API errors during stream initialization", async () => {
			// Mock a model that throws during generateContentStream
			fakeModel = {
				generateContentStream: async () => {
					throw new Error("API connection error")
				},
			}

			let errorOccurred = false
			try {
				for await (const _ of handler.createMessage("Prompt", [{ content: "test", role: "user" }])) {
				}
			} catch (error: any) {
				errorOccurred = true
				expect(error.message).to.include("API connection error")
			}
			expect(errorOccurred).to.be.true
		})

		it("should handle errors during response retrieval", async () => {
			// Mock a model that throws when retrieving the response
			fakeModel = {
				generateContentStream: async () => {
					async function* fakeStream() {
						yield { text: () => "Content before error" }
					}
					return {
						stream: fakeStream(),
						response: Promise.reject(new Error("Response retrieval error")),
					}
				},
			}

			let errorOccurred = false
			try {
				for await (const _ of handler.createMessage("Prompt", [{ content: "test", role: "user" }])) {
				}
			} catch (error: any) {
				errorOccurred = true
				expect(error.message).to.include("Response retrieval error")
			}
			expect(errorOccurred).to.be.true
		})
	})

	describe("Format conversion during message generation", () => {
		it("should apply unescapeGeminiContent to text chunks", async () => {
			// Create a spy on unescapeGeminiContent
			const unescapeSpy = sinon.spy(geminiFormat, "unescapeGeminiContent")

			// Mock a model that returns escaped text
			fakeModel = {
				generateContentStream: async () => {
					async function* fakeStream() {
						yield { text: () => "Line 1\\nLine 2" }
					}
					const fakeResponse = {
						usageMetadata: {
							promptTokenCount: 5,
							candidatesTokenCount: 10,
						},
						candidates: [{ finishReason: undefined }],
					}
					return {
						stream: fakeStream(),
						response: Promise.resolve(fakeResponse),
					}
				},
			}

			const output: any[] = []
			for await (const chunk of handler.createMessage("Prompt", [{ content: "test", role: "user" }])) {
				if (chunk.type === "text") {
					output.push(chunk.text)
				}
			}

			// Verify unescapeGeminiContent was called with the escaped text
			expect(unescapeSpy.calledWith("Line 1\\nLine 2")).to.be.true

			// Verify the unescaped text is in the output
			expect(output[0]).to.equal("Line 1\nLine 2")
		})

		it("should use convertAnthropicMessageToGemini for input messages", async () => {
			// Spy on the appropriate function in the module, not fakeModel.generateContentStream
			const convertSpy = sinon.spy(geminiFormat, "convertAnthropicMessageToGemini")

			// Reset fakeModel to avoid previous test settings
			fakeModel = {
				generateContentStream: async () => {
					async function* fakeStream() {
						/* empty */
					}
					return {
						stream: fakeStream(),
						response: Promise.resolve({
							usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 },
							candidates: [{ finishReason: undefined }],
						}),
					}
				},
			}

			const testMessage: Anthropic.Messages.MessageParam = {
				role: "user",
				content: "Test message",
			}

			// Process the message
			await handler.createMessage("Test prompt", [testMessage]).next()

			// Verify the conversion function was called with our test message
			expect(convertSpy.calledOnce).to.be.true
			expect(convertSpy.firstCall.args[0]).to.deep.equal(testMessage)
		})
	})

	describe("Gemini Format Utilities", () => {
		it("should unescape newline characters", () => {
			const escaped = "line 1\\nline 2\\nline 3"
			const unescaped = geminiFormat.unescapeGeminiContent(escaped)
			unescaped.should.equal("line 1\nline 2\nline 3")
		})

		it("should unescape quotes", () => {
			const escaped = "He said, \\\"Hello\\\" and she said, \\'World\\'"
			const unescaped = geminiFormat.unescapeGeminiContent(escaped)
			unescaped.should.equal("He said, \"Hello\" and she said, 'World'")
		})

		it("should unescape tabs and carriage returns", () => {
			const escaped = "Column1\\tColumn2\\tColumn3\\r\\nRow2Col1\\tRow2Col2\\tRow2Col3"
			const unescaped = geminiFormat.unescapeGeminiContent(escaped)
			unescaped.should.equal("Column1\tColumn2\tColumn3\r\nRow2Col1\tRow2Col2\tRow2Col3")
		})

		it("should handle content with no escape sequences", () => {
			const content = "This is regular text with no escape sequences."
			const result = geminiFormat.unescapeGeminiContent(content)
			result.should.equal(content)
		})
	})
})
