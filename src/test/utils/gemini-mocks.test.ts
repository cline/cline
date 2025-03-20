/**
 * Tests for Gemini mock utilities.
 * Demonstrates how to use the mock factories in test suites.
 */

// Replace ESM import with CommonJS require for Mocha compatibility in VS Code's test runner
const mocha = require("mocha")
const { describe, it } = mocha
// Using require for chai to fix ESM import issue
const chai = require("chai")
const { expect } = chai
import { createMockGeminiResponse, createMockGeminiStream, createMockApiStream, createMockGeminiModel } from "./gemini-mocks"

describe("Gemini Mock Utilities", () => {
	describe("createMockGeminiResponse", () => {
		it("should create a basic response", () => {
			const response = createMockGeminiResponse({
				text: "Hello, world!",
				promptTokens: 10,
				completionTokens: 5,
			})

			expect(response.text()).to.equal("Hello, world!")
			expect(response.usageMetadata?.promptTokenCount).to.equal(10)
			expect(response.usageMetadata?.candidatesTokenCount).to.equal(5)
		})

		it("should support finish reasons", () => {
			const response = createMockGeminiResponse({
				text: "Sorry, I can't continue",
				finishReason: "SAFETY",
			})

			expect(response.candidates?.[0]?.finishReason).to.equal("SAFETY")
		})

		it("should handle text errors", async () => {
			const response = createMockGeminiResponse({
				textError: true,
			})

			expect(() => response.text()).to.throw("Simulated text error")
		})
	})

	describe("createMockGeminiStream", () => {
		it("should create a streaming response", async () => {
			const mockStream = createMockGeminiStream({
				textChunks: ["Hello, ", "world!"],
				promptTokens: 5,
				completionTokens: 2,
			})

			// Collect all text chunks
			const chunks = []
			for await (const chunk of mockStream.stream) {
				chunks.push(chunk.text())
			}

			// Verify stream chunks
			expect(chunks).to.deep.equal(["Hello, ", "world!"])

			// Verify response
			const response = await mockStream.response
			expect(response).to.not.be.null
			expect(response?.usageMetadata?.promptTokenCount).to.equal(5)
			expect(response?.usageMetadata?.candidatesTokenCount).to.equal(2)
		})

		it("should handle errors in stream", async () => {
			try {
				createMockGeminiStream({
					streamError: new Error("Stream creation failed"),
				})
				expect.fail("Should have thrown an error")
			} catch (error: any) {
				expect(error.message).to.equal("Stream creation failed")
			}
		})

		it("should handle response errors", async () => {
			const mockStream = createMockGeminiStream({
				textChunks: ["Partial content"],
				responseError: new Error("Response retrieval failed"),
			})

			// We can still consume the stream
			const chunks = []
			for await (const chunk of mockStream.stream) {
				chunks.push(chunk.text())
			}
			expect(chunks).to.deep.equal(["Partial content"])

			// But response will fail
			try {
				await mockStream.response
				expect.fail("Should have rejected")
			} catch (error: any) {
				expect(error.message).to.equal("Response retrieval failed")
			}
		})

		it("should support null responses", async () => {
			const mockStream = createMockGeminiStream({
				textChunks: ["Content"],
				nullResponse: true,
			})

			const response = await mockStream.response
			expect(response).to.be.null
		})
	})

	describe("createMockApiStream", () => {
		it("should yield the provided chunks", async () => {
			const chunks = [
				{ type: "text", text: "Hello" } as const,
				{ type: "text", text: ", world!" } as const,
				{ type: "usage", inputTokens: 5, outputTokens: 2 } as const,
			]

			const stream = createMockApiStream(chunks)

			const collected = []
			for await (const chunk of stream) {
				collected.push(chunk)
			}

			expect(collected).to.deep.equal(chunks)
		})

		it("should throw the provided error", async () => {
			const chunks = [{ type: "text", text: "Start" } as const]
			const error = new Error("Stream failed")

			const stream = createMockApiStream(chunks, error)

			try {
				// Start consuming the stream
				await stream.next()
				expect.fail("Should have thrown an error")
			} catch (e: any) {
				expect(e.message).to.equal("Stream failed")
			}
		})
	})

	describe("createMockGeminiModel", () => {
		it("should create a model with the generateContentStream method", async () => {
			const model = createMockGeminiModel({
				textChunks: ["Model ", "response"],
				promptTokens: 10,
				completionTokens: 2,
			})

			// Check that the model has the expected method
			expect(model).to.have.property("generateContentStream").that.is.a("function")

			// Test the streaming method
			const streamResult = await model.generateContentStream()

			const chunks = []
			for await (const chunk of streamResult.stream) {
				chunks.push(chunk.text())
			}

			expect(chunks).to.deep.equal(["Model ", "response"])

			// Test the response
			const response = await streamResult.response
			expect(response?.text()).to.equal("Model response")
		})

		it("should support the generateContent method", async () => {
			const model = createMockGeminiModel({
				textChunks: ["Complete response"],
				promptTokens: 5,
				completionTokens: 2,
			})

			// Check that the model has the generateContent method
			expect(model).to.have.property("generateContent").that.is.a("function")

			// Test the method
			const response = await model.generateContent()
			expect(response.text()).to.equal("Complete response")
		})
	})
})
