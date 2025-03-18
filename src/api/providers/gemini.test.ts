import { describe, it, beforeEach, afterEach } from "mocha"
import "should"
import * as sinon from "sinon"
import { Anthropic } from "@anthropic-ai/sdk"
import { GeminiHandler } from "./gemini"
import { ApiHandlerOptions, geminiModels } from "../../shared/api"
import * as geminiFormat from "../transform/gemini-format"
import { ApiStreamTextChunk, ApiStreamUsageChunk } from "../transform/stream"

describe("GeminiHandler", () => {
	const mockApiKey = "test-api-key"
	const mockSystemPrompt = "You are a helpful assistant."
	const mockMessages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Hello, how are you?" }]

	let handler: GeminiHandler
	let mockGenerativeModel: any
	let mockStreamResult: any
	let mockResponse: any
	let mockClient: any
	let convertSpy: sinon.SinonSpy
	let unescapeSpy: sinon.SinonSpy

	beforeEach(() => {
		// Set up mocks
		mockStreamResult = {
			stream: createMockStream(),
			response: {
				candidates: [{ finishReason: "STOP" }],
				usageMetadata: {
					promptTokenCount: 10,
					candidatesTokenCount: 20,
				},
			},
		}

		mockGenerativeModel = {
			generateContentStream: sinon.stub().resolves(mockStreamResult),
		}

		mockClient = {
			getGenerativeModel: sinon.stub().returns(mockGenerativeModel),
		}

		// Spy on the conversion functions
		convertSpy = sinon.spy(geminiFormat, "convertAnthropicMessageToGemini")
		unescapeSpy = sinon.spy(geminiFormat, "unescapeGeminiContent")

		// Create the handler with our mock
		const options: ApiHandlerOptions = {
			geminiApiKey: mockApiKey,
			apiModelId: "gemini-1.5-pro-002",
		}

		handler = new GeminiHandler(options)(
			// Replace the client with our mock
			handler as any,
		).client = mockClient
	})

	afterEach(() => {
		// Restore spies
		convertSpy.restore()
		unescapeSpy.restore()
		sinon.restore()
	})

	describe("constructor", () => {
		it("should throw an error if no API key is provided", () => {
			;(() => new GeminiHandler({} as ApiHandlerOptions)).should.throw("API key is required for Google Gemini")
		})

		it("should initialize with the provided API key", () => {
			const options: ApiHandlerOptions = {
				geminiApiKey: mockApiKey,
			}
			const handler = new GeminiHandler(options)
			handler.should.be.instanceOf(GeminiHandler)
		})
	})

	describe("getModel", () => {
		it("should return the specified model if valid", () => {
			const options: ApiHandlerOptions = {
				geminiApiKey: mockApiKey,
				apiModelId: "gemini-1.5-pro-002",
			}
			const handler = new GeminiHandler(options)
			const model = handler.getModel()
			model.id.should.equal("gemini-1.5-pro-002")
			model.info.should.equal(geminiModels["gemini-1.5-pro-002"])
		})

		it("should return the default model if none specified", () => {
			const options: ApiHandlerOptions = {
				geminiApiKey: mockApiKey,
			}
			const handler = new GeminiHandler(options)
			const model = handler.getModel()
			model.id.should.equal("gemini-2.0-flash-001")
			model.info.should.equal(geminiModels["gemini-2.0-flash-001"])
		})

		it("should return the default model if specified model is invalid", () => {
			const options: ApiHandlerOptions = {
				geminiApiKey: mockApiKey,
				apiModelId: "invalid-model", // This doesn't exist in geminiModels
			}
			const handler = new GeminiHandler(options)
			const model = handler.getModel()
			model.id.should.equal("gemini-2.0-flash-001")
			model.info.should.equal(geminiModels["gemini-2.0-flash-001"])
		})
	})

	describe("createMessage", () => {
		it("should convert messages using convertAnthropicMessageToGemini", async () => {
			// Call the method
			const generator = handler.createMessage(mockSystemPrompt, mockMessages)
			await consumeGenerator(generator)

			// Verify the conversion was called for each message
			convertSpy.callCount.should.equal(mockMessages.length)
			mockClient.getGenerativeModel.calledOnce.should.be.true()
			mockGenerativeModel.generateContentStream.calledOnce.should.be.true()
		})

		it("should set maxOutputTokens from model info", async () => {
			// Call the method
			const generator = handler.createMessage(mockSystemPrompt, mockMessages)
			await consumeGenerator(generator)

			// Verify the generation config uses maxOutputTokens from model info
			const callArgs = mockGenerativeModel.generateContentStream.getCall(0).args[0]
			callArgs.generationConfig.maxOutputTokens.should.equal(geminiModels["gemini-1.5-pro-002"].maxTokens)
		})

		it("should unescape content using unescapeGeminiContent", async () => {
			// Setup mock stream that returns escaped content
			const escapedText = "Hello\\nWorld"
			mockStreamResult.stream = createMockStream([escapedText])

			// Call the method
			const generator = handler.createMessage(mockSystemPrompt, mockMessages)
			const result = await consumeGenerator(generator)

			// Verify unescapeGeminiContent was called
			unescapeSpy.calledWith(escapedText).should.be.true()

			// Check that the result includes the text chunk
			const textChunks = result.filter((chunk) => chunk.type === "text") as ApiStreamTextChunk[]
			textChunks.should.have.length(1)
		})

		it("should yield usage information after completion", async () => {
			// Call the method
			const generator = handler.createMessage(mockSystemPrompt, mockMessages)
			const result = await consumeGenerator(generator)

			// Verify usage information was yielded
			const usageChunks = result.filter((chunk) => chunk.type === "usage") as ApiStreamUsageChunk[]
			usageChunks.should.have.length(1)
			usageChunks[0].inputTokens.should.equal(10)
			usageChunks[0].outputTokens.should.equal(20)
		})

		it("should handle stream errors gracefully", async () => {
			// Setup mock stream that throws an error
			mockStreamResult.stream = createMockStream([], new Error("Stream error"))

			// Call the method
			const generator = handler.createMessage(mockSystemPrompt, mockMessages)

			try {
				await consumeGenerator(generator)
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.include("Stream error")
			}
		})

		it("should handle SAFETY finish reason", async () => {
			// Setup response with SAFETY finish reason
			mockStreamResult.response.candidates[0].finishReason = "SAFETY"

			// Call the method
			const generator = handler.createMessage(mockSystemPrompt, mockMessages)

			try {
				await consumeGenerator(generator)
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Content generation was blocked for safety reasons")
			}
		})

		it("should handle RECITATION finish reason", async () => {
			// Setup response with RECITATION finish reason
			mockStreamResult.response.candidates[0].finishReason = "RECITATION"

			// Call the method
			const generator = handler.createMessage(mockSystemPrompt, mockMessages)

			try {
				await consumeGenerator(generator)
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Content generation was blocked due to potential copyright issues")
			}
		})

		it("should handle OTHER finish reason", async () => {
			// Setup response with OTHER finish reason
			mockStreamResult.response.candidates[0].finishReason = "OTHER"

			// Call the method
			const generator = handler.createMessage(mockSystemPrompt, mockMessages)

			try {
				await consumeGenerator(generator)
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Content generation was blocked for other reasons")
			}
		})

		it("should handle missing response", async () => {
			// Setup missing response
			mockStreamResult.response = null

			// Call the method
			const generator = handler.createMessage(mockSystemPrompt, mockMessages)

			try {
				await consumeGenerator(generator)
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("No response received from Gemini API")
			}
		})
	})
})

// Helper function to create a mock stream
function createMockStream(texts: string[] = ["test response"], error?: Error): AsyncIterable<any> {
	return {
		async *[Symbol.asyncIterator]() {
			if (error) {
				throw error
			}

			for (const text of texts) {
				yield {
					text: () => text,
				}
			}
		},
	}
}

// Helper function to consume a generator
async function consumeGenerator(generator: AsyncGenerator<any>) {
	const result = []
	try {
		for await (const item of generator) {
			result.push(item)
		}
	} catch (error) {
		throw error
	}
	return result
}
