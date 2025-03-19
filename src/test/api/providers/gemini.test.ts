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
	let sandbox: sinon.SinonSandbox

	beforeEach(() => {
		sandbox = sinon.createSandbox()
	})

	afterEach(() => {
		sandbox.restore()
	})

	// Setup helper to reduce test setup boilerplate
	function setupHandler(mockOptions = {}, handlerOptions = {}) {
		const handler = new GeminiHandler({
			geminiApiKey: "test-key",
			...handlerOptions,
		})

		const mockModel = createMockGeminiModel(mockOptions)

		// Use sandbox for consistent cleanup
		const clientStub = {
			getGenerativeModel: sandbox.stub().returns(mockModel),
		}

		handler["client"] = clientStub as any

		return {
			handler,
			clientStub,
			mockModel,
		}
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

		it.skip("should correctly pass the system prompt to model initialization", () => {
			// Create stubs controlled by sandbox
			const generateContentStub = sandbox.stub().returns(createMockGeminiStream({}))
			const modelStub = { generateContentStream: generateContentStub }
			const getModelStub = sandbox.stub().returns(modelStub)

			// Set up handler
			const handler = new GeminiHandler({ geminiApiKey: "test-key" })
			handler["client"] = { getGenerativeModel: getModelStub } as any

			// Act
			handler.createMessage("This is a system prompt", [{ role: "user", content: "Hi" }])

			// Assert
			expect(getModelStub.calledOnce).to.be.true
			const modelParams = getModelStub.firstCall.args[0]
			expect(modelParams).to.have.property("systemInstruction", "This is a system prompt")
		})

		it.skip("should apply maxTokens from model configuration", () => {
			// Create stubs controlled by sandbox
			const generateContentStub = sandbox.stub().returns(createMockGeminiStream({}))
			const modelStub = { generateContentStream: generateContentStub }
			const getModelStub = sandbox.stub().returns(modelStub)

			// Set up handler with a specific model configuration that has maxTokens
			const handler = new GeminiHandler({
				geminiApiKey: "test-key",
				apiModelId: "gemini-1.5-pro-002", // This model has a defined maxTokens value
			})
			handler["client"] = { getGenerativeModel: getModelStub } as any

			// Act
			handler.createMessage("System prompt", [{ role: "user", content: "Hi" }])

			// Assert
			expect(generateContentStub.calledOnce).to.be.true
			const params = generateContentStub.firstCall.args[0]
			expect(params).to.have.property("generationConfig")
			expect(params.generationConfig).to.have.property("maxOutputTokens", geminiModels["gemini-1.5-pro-002"].maxTokens)
		})
	})

	describe("Text Generation", () => {
		it("should yield text chunks and usage info on a successful stream", async () => {
			// Arrange
			const { handler } = setupHandler({
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

		it.skip("should convert Anthropic messages to Gemini format", () => {
			// Arrange
			const convertStub = sandbox.stub(geminiFormat, "convertAnthropicMessageToGemini").callThrough() // Make sure it still performs the actual conversion

			const { handler } = setupHandler()
			const message = { role: "user" as const, content: "Hello" }

			// Act
			handler.createMessage("System prompt", [message])

			// Assert
			expect(convertStub.called).to.be.true
			expect(convertStub.firstCall.args[0]).to.equal(message)
		})

		it.skip("should pass system prompt to model initialization", () => {
			// Create stubs controlled by sandbox
			const generateContentStub = sandbox.stub().returns(createMockGeminiStream({}))
			const modelStub = { generateContentStream: generateContentStub }
			const getModelStub = sandbox.stub().returns(modelStub)

			// Set up handler
			const handler = new GeminiHandler({ geminiApiKey: "test-key" })
			handler["client"] = { getGenerativeModel: getModelStub } as any

			// Act
			const systemPrompt = "Act as a helpful assistant"
			handler.createMessage(systemPrompt, [{ role: "user", content: "Hi" }])

			// Assert
			expect(getModelStub.called).to.be.true
			const modelParams = getModelStub.firstCall.args[0]
			expect(modelParams).to.have.property("systemInstruction", systemPrompt)
		})

		it.skip("should apply maxTokens from model configuration", () => {
			// Create stubs controlled by sandbox
			const generateContentStub = sandbox.stub().returns(createMockGeminiStream({}))
			const modelStub = { generateContentStream: generateContentStub }
			const getModelStub = sandbox.stub().returns(modelStub)

			// Set up handler with a specific model configuration that has maxTokens
			const handler = new GeminiHandler({
				geminiApiKey: "test-key",
				apiModelId: "gemini-1.5-pro-002", // This model has a defined maxTokens value
			})
			handler["client"] = { getGenerativeModel: getModelStub } as any

			// Act
			handler.createMessage("System prompt", [{ role: "user", content: "Hi" }])

			// Assert
			expect(generateContentStub.called).to.be.true
			const params = generateContentStub.firstCall.args[0]
			expect(params).to.have.property("generationConfig")
			expect(params.generationConfig).to.have.property("maxOutputTokens", geminiModels["gemini-1.5-pro-002"].maxTokens)
		})

		it("should properly unescape content", async () => {
			// Arrange
			const unescapeStub = sandbox.stub(geminiFormat, "unescapeGeminiContent").callThrough() // Make sure it still performs the actual unescaping

			const { handler } = setupHandler({
				textChunks: ['Line 1\\nLine 2\\nThis is a quoted \\"string\\"'],
			})

			// Act
			const generator = handler.createMessage("System", [{ role: "user", content: "Hi" }])
			const results = []
			for await (const chunk of generator) {
				if (chunk.type === "text") {
					results.push(chunk.text)
				}
			}

			// Assert
			expect(unescapeStub.called).to.be.true
			expect(results[0]).to.equal('Line 1\nLine 2\nThis is a quoted "string"')
		})
	})

	describe("Error Handling", () => {
		it("should throw an error when finishReason is SAFETY", async () => {
			// Arrange
			const { handler } = setupHandler({
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
				expect.fail("Expected an error to be thrown")
			} catch (error: any) {
				expect(error.message).to.include("safety reasons")
			}
		})

		it("should handle null response object", async () => {
			// Arrange
			const { handler } = setupHandler({
				textChunks: ["Partial response"],
				nullResponse: true,
			})

			// Act & Assert
			try {
				for await (const chunk of handler.createMessage("System prompt", [{ role: "user", content: "Hello" }])) {
					// Should not get all chunks
				}

				// If we get here, the test should fail
				expect.fail("Expected an error to be thrown")
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
			const { handler } = setupHandler()
			const mockStream = {
				stream: {
					async *[Symbol.asyncIterator]() {
						yield {
							text: () => {
								throw new Error("Error processing chunk")
							},
						}
					},
				},
				response: Promise.resolve(null),
			}

			const mockModel = {
				generateContentStream: () => mockStream,
			}

			handler["client"] = {
				getGenerativeModel: () => mockModel,
			} as any

			// Act & Assert
			try {
				const generator = handler.createMessage("System", [{ role: "user", content: "Hi" }])
				await generator.next()
				expect.fail("Should have thrown an error")
			} catch (error: any) {
				expect(error.message).to.include("Error processing chunk")
			}
		})
	})

	describe("Image Handling", () => {
		it.skip("should correctly process a base64 encoded image", () => {
			// Create stubs controlled by sandbox
			const generateContentStub = sandbox.stub().returns(createMockGeminiStream({}))
			const modelStub = { generateContentStream: generateContentStub }
			const getModelStub = sandbox.stub().returns(modelStub)

			// Set up handler
			const handler = new GeminiHandler({ geminiApiKey: "test-key" })
			handler["client"] = { getGenerativeModel: getModelStub } as any

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
			} as Anthropic.Messages.MessageParam

			// Act
			handler.createMessage("System prompt", [imageMessage])

			// Assert - verify that the generateContentStream was called with an object
			// containing a part with inlineData matching our image
			expect(generateContentStub.calledOnce).to.be.true

			// Get the contents array from the first argument passed to generateContentStream
			const params = generateContentStub.firstCall.args[0]
			expect(params).to.have.property("contents").that.is.an("array")

			// Check if any content item has a part with our image data
			const contentWithImage = params.contents.find(
				(content: any) =>
					content.parts &&
					content.parts.some((part: any) => part.inlineData && part.inlineData.data === "SGVsbG8gV29ybGQ="),
			)

			expect(contentWithImage).to.exist
		})
	})
})
