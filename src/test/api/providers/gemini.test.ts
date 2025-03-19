/**
 * Test suite for Gemini API provider integration.
 *
 * NOTE: We're using CommonJS-style imports for Mocha (require) due to VS Code's test runner
 * compatibility requirements. This is necessary because VS Code's test infrastructure
 * requires CommonJS modules even when using nodenext module resolution. The rest of the
 * codebase uses ESM imports, but tests need CommonJS for compatibility with VS Code testing.
 */
const mocha = require("mocha")
const { describe, it, beforeEach, afterEach } = mocha
const chai = require("chai")
const { expect } = chai
import "should"
import * as sinon from "sinon"
import { GeminiHandler } from "../../../api/providers/gemini"
import { ApiHandlerOptions, geminiDefaultModelId, geminiModels } from "../../../shared/api"
import * as geminiFormat from "../../../api/transform/gemini-format"
import { ApiStream } from "../../../api/transform/stream"
import { Anthropic } from "@anthropic-ai/sdk"
import {
	createMockGeminiModel,
	createMockGeminiResponse,
	createMockGeminiStream,
	createRateLimitingModel,
	createSafetyFilterModel,
	setupGeminiHandlerWithMock,
} from "../../utils/gemini-mocks"

describe("GeminiHandler", () => {
	// Setup helper to reduce test setup boilerplate
	function setupHandler(mockOptions = {}, handlerOptions = {}) {
		const handler = new GeminiHandler({
			geminiApiKey: "test-key",
			...handlerOptions,
		})

		const mockModel = createMockGeminiModel(mockOptions)

		handler["client"] = {
			getGenerativeModel: () => mockModel,
		} as any

		return handler
	}

	describe("Initialization", () => {
		it("should throw an error if no API key is provided", () => {
			expect(() => new GeminiHandler({})).to.throw()
		})

		// Table-driven test for model selection
		const modelTestCases = [
			{
				name: "should use default model when no ID is provided",
				options: {},
				expectedModel: geminiDefaultModelId,
			},
			{
				name: "should use specified model when valid ID is provided",
				options: { apiModelId: "gemini-1.5-pro-002" },
				expectedModel: "gemini-1.5-pro-002",
			},
			{
				name: "should fall back to default model when invalid ID is provided",
				options: { apiModelId: "invalid-model-id" },
				expectedModel: geminiDefaultModelId,
			},
		]

		modelTestCases.forEach((tc) => {
			it(tc.name, () => {
				const handler = new GeminiHandler({
					geminiApiKey: "test-key",
					...tc.options,
				})

				const { id } = handler.getModel()
				expect(id).to.equal(tc.expectedModel)
			})
		})

		it("should correctly pass the system prompt to model initialization", () => {
			// Arrange
			const handler = setupHandler()
			const modelSpy = sinon.stub()
			modelSpy.returns({
				generateContentStream: sinon.stub().returns(createMockGeminiStream({})),
			})

			handler["client"] = {
				getGenerativeModel: modelSpy,
			} as any

			// Act
			handler.createMessage("This is a system prompt", [{ role: "user", content: "Hi" }])

			// Assert
			expect(modelSpy.calledOnce).to.be.true
			const systemMessageParams = modelSpy.firstCall.args[0]
			expect(systemMessageParams.systemInstruction).to.equal("This is a system prompt")
		})

		it("should apply maxTokens from model configuration", () => {
			// Arrange
			const handler = setupHandler({ maxOutputTokens: 100 })
			const generateContentSpy = sinon.stub().returns(createMockGeminiStream({}))
			const modelSpy = sinon.stub()
			modelSpy.returns({
				generateContentStream: generateContentSpy,
			})

			handler["client"] = {
				getGenerativeModel: modelSpy,
			} as any

			// Act
			handler.createMessage("System prompt", [{ role: "user", content: "Hi" }])

			// Assert
			expect(generateContentSpy.calledOnce).to.be.true
			const generationConfig = generateContentSpy.firstCall.args[1]
			expect(generationConfig.maxOutputTokens).to.equal(100)
		})
	})

	describe("Text Generation", () => {
		it("should yield text chunks and usage info on a successful stream", async () => {
			// Arrange
			const handler = setupHandler({
				textChunks: ["Hello", ", world!"],
				promptTokens: 10,
				completionTokens: 5,
			})

			// Act
			const results = []
			for await (const chunk of handler.createMessage("System prompt", [{ role: "user", content: "Test message" }])) {
				results.push(chunk)
			}

			// Assert
			const textChunks = results.filter((chunk) => chunk.type === "text")
			expect(textChunks).to.have.length(2)
			expect(textChunks[0].text).to.equal("Hello")
			expect(textChunks[1].text).to.equal(", world!")

			const usageChunks = results.filter((chunk) => chunk.type === "usage")
			expect(usageChunks).to.have.length(1)
			expect(usageChunks[0].inputTokens).to.equal(10)
			expect(usageChunks[0].outputTokens).to.equal(5)
		})

		it("should convert Anthropic messages to Gemini format", async () => {
			// Arrange
			const convertSpy = sinon.spy(geminiFormat, "convertAnthropicMessageToGemini")

			const handler = setupHandler({
				textChunks: ["Response"],
				promptTokens: 5,
				completionTokens: 2,
			})

			const message = { role: "user", content: "Hello" } as Anthropic.Messages.MessageParam

			// Act
			const generator = handler.createMessage("System prompt", [message])
			await generator.next() // Just need to start the generator to trigger the conversion

			// Assert
			expect(convertSpy.calledOnce).to.be.true()
			expect(convertSpy.firstCall.args[0]).to.equal(message)

			// Cleanup
			convertSpy.restore()
		})

		it("should pass system prompt to model initialization", async () => {
			// Arrange
			const getGenerativeModelStub = sinon.stub()
			const systemPrompt = "You are a helpful assistant."

			const handler = new GeminiHandler({ geminiApiKey: "test-key" })

			handler["client"] = {
				getGenerativeModel: getGenerativeModelStub,
			} as any

			getGenerativeModelStub.returns(
				createMockGeminiModel({
					textChunks: ["Response"],
				}),
			)

			// Act
			const generator = handler.createMessage(systemPrompt, [{ role: "user", content: "Hello" }])
			await generator.next() // Start the generator to trigger model initialization

			// Assert
			expect(getGenerativeModelStub.calledOnce).to.be.true()
			expect(getGenerativeModelStub.firstCall.args[0]).to.have.property("systemInstruction", systemPrompt)
		})

		it("should apply maxTokens from model configuration", async () => {
			// Arrange
			const generateContentStreamStub = sinon.stub()
			const mockModel = {
				generateContentStream: generateContentStreamStub,
			}

			generateContentStreamStub.returns(
				createMockGeminiStream({
					textChunks: ["Response"],
					promptTokens: 5,
					completionTokens: 2,
				}),
			)

			const handler = new GeminiHandler({
				geminiApiKey: "test-key",
				apiModelId: "gemini-1.5-pro-002",
			})

			handler["client"] = {
				getGenerativeModel: () => mockModel,
			} as any

			// Act
			const generator = handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])
			await generator.next() // Start the generator to trigger configuration

			// Assert
			expect(generateContentStreamStub.calledOnce).to.be.true()
			const generationConfig = generateContentStreamStub.firstCall.args[0].generationConfig
			expect(generationConfig).to.have.property("maxOutputTokens", geminiModels["gemini-1.5-pro-002"].maxTokens)
		})

		it("should properly unescape content", async () => {
			// Arrange
			const handler = setupHandler({
				textChunks: ['Line 1\\nLine 2\\nThis is a quoted \\"string\\"'],
				promptTokens: 5,
				completionTokens: 5,
			})

			const unescapeSpy = sinon.spy(geminiFormat, "unescapeGeminiContent")

			// Act
			const results = []
			for await (const chunk of handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])) {
				if (chunk.type === "text") {
					results.push(chunk.text)
				}
			}

			// Assert
			expect(unescapeSpy.called).to.be.true()
			expect(results[0]).to.equal('Line 1\nLine 2\nThis is a quoted "string"')

			// Cleanup
			unescapeSpy.restore()
		})
	})

	describe("Error Handling", () => {
		it("should throw an error when finishReason is SAFETY", async () => {
			// Arrange
			const handler = setupHandler({
				textChunks: ["I'm sorry, I cannot fulfill that request."],
				finishReason: "SAFETY",
				promptTokens: 5,
				completionTokens: 10,
			})

			// Act & Assert
			try {
				for await (const chunk of handler.createMessage("System prompt", [{ role: "user", content: "Unsafe request" }])) {
					// Should not get all chunks
				}

				// If we get here, the test should fail
				expect(true).to.be.false("Expected an error to be thrown")
			} catch (error: any) {
				expect(error.message).to.include("safety reasons")
			}
		})

		it("should handle null response object", async () => {
			// Arrange
			const handler = setupHandler({
				textChunks: ["Partial response"],
				nullResponse: true,
			})

			// Act & Assert
			try {
				for await (const chunk of handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])) {
					// Should not get all chunks
				}

				// If we get here, the test should fail
				expect(true).to.be.false("Expected an error to be thrown")
			} catch (error: any) {
				expect(error.message).to.include("No response received")
			}
		})

		it("should retry on rate limit errors", async () => {
			// Arrange
			let attempts = 0
			const mockModelFactory = createRateLimitingModel(2, {
				textChunks: ["Success after retries"],
				promptTokens: 5,
				completionTokens: 3,
			})

			const handler = new GeminiHandler({ geminiApiKey: "test-key" })

			handler["client"] = {
				getGenerativeModel: () => mockModelFactory(attempts++),
			} as any

			// Act
			const results = []
			for await (const chunk of handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])) {
				if (chunk.type === "text") {
					results.push(chunk.text)
				}
			}

			// Assert
			expect(attempts).to.equal(3) // Initial call + 2 retries
			expect(results).to.include("Success after retries")
		})

		it("should handle text errors in stream chunks", async () => {
			// Arrange
			const mockModel = createMockGeminiModel({
				textChunks: ["Good response"],
			})

			// Create a custom text function that throws on the first call only
			let callCount = 0
			const originalStream = mockModel.generateContentStream
			mockModel.generateContentStream = async () => {
				const result = await originalStream()

				// Wrap the original stream to inject a failure
				const originalGenerator = result.stream
				result.stream = (async function* () {
					for await (const chunk of originalGenerator) {
						if (callCount++ === 0) {
							// First chunk throws, next ones succeed
							const errorChunk = {
								text: () => {
									throw new Error("Error processing chunk")
								},
							}
							yield errorChunk
						} else {
							yield chunk
						}
					}
				})()

				return result
			}

			const handler = new GeminiHandler({ geminiApiKey: "test-key" })
			handler["client"] = {
				getGenerativeModel: () => mockModel,
			} as any

			// Act & Assert
			try {
				for await (const chunk of handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])) {
					// Should throw before yielding chunks
				}

				// If we get here, the test should fail
				expect(true).to.be.false("Expected an error to be thrown")
			} catch (error: any) {
				expect(error.message).to.include("Stream processing encountered errors")
			}
		})
	})

	describe("Image Handling", () => {
		it("should correctly process a base64 encoded image", () => {
			// Arrange
			const handler = setupHandler()
			const generateContentSpy = sinon.stub().returns(createMockGeminiStream({}))
			const modelSpy = sinon.stub()
			modelSpy.returns({
				generateContentStream: generateContentSpy,
			})

			handler["client"] = {
				getGenerativeModel: modelSpy,
			} as any

			// Create an image message for testing
			const imageMessage = {
				role: "user",
				content: [
					{ type: "text", text: "What's in this image?" },
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/jpeg",
							data: "SGVsbG8gV29ybGQ=",
						},
					},
				],
			}

			// Act
			handler.createMessage("System prompt", [imageMessage as any]) // Use type assertion to bypass strict checking

			// Assert
			expect(generateContentSpy.calledOnce).to.be.true
			const content = generateContentSpy.firstCall.args[0]
			// Check if any part of the content contains inline data
			const parts = content.parts || []
			const inlineDataExists = parts.some((part: any) => part.inlineData && part.inlineData.data === "SGVsbG8gV29ybGQ=")
			expect(inlineDataExists).to.be.true
		})
	})
})
