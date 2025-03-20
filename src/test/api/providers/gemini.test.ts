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

		it("should correctly pass the system prompt to model initialization", () => {
			// Create a handler directly
			const handler = new GeminiHandler({ geminiApiKey: "test-key" })

			// Create a mock for the GoogleGenerativeAI client
			const getGenerativeModelMock = sandbox.stub()

			// Set up expected arguments
			const expectedSystemPrompt = "This is a system prompt"

			// Replace the client with our stubbed version
			handler["client"] = {
				getGenerativeModel: getGenerativeModelMock,
			} as any

			// Set up the stub to return a mock model when called
			const mockModel = createMockGeminiModel({})
			getGenerativeModelMock.returns(mockModel)

			// Call the method being tested (but don't consume the generator)
			const messageGenerator = handler.createMessage(expectedSystemPrompt, [{ role: "user", content: "Hi" }])

			// We just need to start the generator to trigger the function
			messageGenerator.next().catch(() => {
				/* Ignore errors */
			})

			// Verify the system prompt is passed correctly
			sinon.assert.calledOnce(getGenerativeModelMock)
			const actualArgs = getGenerativeModelMock.firstCall.args[0]
			expect(actualArgs).to.have.property("systemInstruction", expectedSystemPrompt)
		})

		it("should apply maxTokens from model configuration", () => {
			// Create a handler with a specific model that has maxTokens defined
			const specificModelId = "gemini-1.5-pro-002"
			const handler = new GeminiHandler({
				geminiApiKey: "test-key",
				apiModelId: specificModelId,
			})

			// Set up mocks
			const generateContentStreamMock = sandbox.stub().returns(createMockGeminiStream({}))
			const mockModel = {
				generateContentStream: generateContentStreamMock,
			}
			const getGenerativeModelMock = sandbox.stub().returns(mockModel)

			// Replace the client
			handler["client"] = {
				getGenerativeModel: getGenerativeModelMock,
			} as any

			// Call the method being tested
			const messageGenerator = handler.createMessage("System prompt", [{ role: "user", content: "Hi" }])

			// Start the generator to trigger the function
			messageGenerator.next().catch(() => {
				/* Ignore errors */
			})

			// Verify maxTokens is set correctly
			sinon.assert.calledOnce(generateContentStreamMock)
			const generationArgs = generateContentStreamMock.firstCall.args[0]
			expect(generationArgs).to.have.property("generationConfig")
			expect(generationArgs.generationConfig).to.have.property("maxOutputTokens", geminiModels[specificModelId].maxTokens)
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

		it("should convert Anthropic messages to Gemini format", () => {
			// Stub the conversion function to track calls
			const convertStub = sandbox.stub(geminiFormat, "convertAnthropicMessageToGemini").callThrough()

			// Set up the handler
			const generateContentStreamMock = sandbox.stub().returns(createMockGeminiStream({}))
			const mockModel = {
				generateContentStream: generateContentStreamMock,
			}
			const getGenerativeModelMock = sandbox.stub().returns(mockModel)

			const handler = new GeminiHandler({ geminiApiKey: "test-key" })
			handler["client"] = {
				getGenerativeModel: getGenerativeModelMock,
			} as any

			// Create test messages
			const testMessage = { role: "user" as const, content: "Hello world" }
			const messages = [testMessage]

			// Start the generator
			const messageGenerator = handler.createMessage("System prompt", messages)
			messageGenerator.next().catch(() => {
				/* Ignore errors */
			})

			// Verify the conversion function was called with our message
			sinon.assert.called(convertStub)
			expect(convertStub.calledWith(testMessage)).to.be.true

			// Also verify the model was called with the converted content
			sinon.assert.calledOnce(generateContentStreamMock)
			const args = generateContentStreamMock.firstCall.args[0]
			expect(args).to.have.property("contents").that.is.an("array")
		})

		it("should pass system prompt to model initialization", () => {
			// Create a handler
			const handler = new GeminiHandler({ geminiApiKey: "test-key" })

			// Create mocks
			const generateContentStreamMock = sandbox.stub().returns(createMockGeminiStream({}))
			const mockModel = {
				generateContentStream: generateContentStreamMock,
			}
			const getGenerativeModelMock = sandbox.stub().returns(mockModel)

			// Replace the client
			handler["client"] = {
				getGenerativeModel: getGenerativeModelMock,
			} as any

			// Set up expected system prompt
			const systemPrompt = "Act as a helpful assistant"

			// Call the method
			const messageGenerator = handler.createMessage(systemPrompt, [{ role: "user", content: "Hi" }])
			messageGenerator.next().catch(() => {
				/* Ignore errors */
			})

			// Verify system prompt is passed correctly
			sinon.assert.calledOnce(getGenerativeModelMock)
			const modelParams = getGenerativeModelMock.firstCall.args[0]
			expect(modelParams).to.have.property("systemInstruction", systemPrompt)
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
		it("should correctly process a base64 encoded image", () => {
			// Create stubs with sinon sandbox for proper cleanup
			const generateContentStreamMock = sandbox.stub().returns(createMockGeminiStream({}))
			const mockModel = {
				generateContentStream: generateContentStreamMock,
			}
			const getGenerativeModelMock = sandbox.stub().returns(mockModel)

			// Set up handler
			const handler = new GeminiHandler({ geminiApiKey: "test-key" })
			handler["client"] = {
				getGenerativeModel: getGenerativeModelMock,
			} as any

			// Create a sample image message with proper typing
			const imageMessage = {
				role: "user" as const,
				content: [
					{ type: "text" as const, text: "What's in this image?" },
					{
						type: "image" as const,
						source: {
							type: "base64" as const,
							media_type: "image/jpeg" as const,
							data: "SGVsbG8gV29ybGQ=", // "Hello World" in base64
						},
					},
				],
			} as Anthropic.Messages.MessageParam

			// Start the generator to trigger the function
			const messageGenerator = handler.createMessage("System prompt", [imageMessage])
			messageGenerator.next().catch(() => {
				/* Ignore errors */
			})

			// Verify the model was called with the right content
			sinon.assert.calledOnce(generateContentStreamMock)

			// Get the generate content args to check image data
			const generateArgs = generateContentStreamMock.firstCall.args[0]
			expect(generateArgs).to.have.property("contents").that.is.an("array")

			// Deep check for image data in content parts
			let foundImageData = false
			for (const content of generateArgs.contents) {
				if (content.parts) {
					for (const part of content.parts) {
						if (part.inlineData && part.inlineData.data === "SGVsbG8gV29ybGQ=") {
							foundImageData = true
							break
						}
					}
				}
			}

			expect(foundImageData).to.be.true
		})
	})
})
