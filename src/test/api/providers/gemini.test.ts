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
import { ApiHandlerOptions, geminiModels } from "../../../shared/api"
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
