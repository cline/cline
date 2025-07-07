import { vitest, describe, it, expect, beforeEach } from "vitest"
import type { MockedClass } from "vitest"
import { GeminiEmbedder } from "../gemini"
import { OpenAICompatibleEmbedder } from "../openai-compatible"

// Mock the OpenAICompatibleEmbedder
vitest.mock("../openai-compatible")

const MockedOpenAICompatibleEmbedder = OpenAICompatibleEmbedder as MockedClass<typeof OpenAICompatibleEmbedder>

describe("GeminiEmbedder", () => {
	let embedder: GeminiEmbedder

	beforeEach(() => {
		vitest.clearAllMocks()
	})

	describe("constructor", () => {
		it("should create an instance with correct fixed values passed to OpenAICompatibleEmbedder", () => {
			// Arrange
			const apiKey = "test-gemini-api-key"

			// Act
			embedder = new GeminiEmbedder(apiKey)

			// Assert
			expect(MockedOpenAICompatibleEmbedder).toHaveBeenCalledWith(
				"https://generativelanguage.googleapis.com/v1beta/openai/",
				apiKey,
				"text-embedding-004",
				2048,
			)
		})

		it("should throw error when API key is not provided", () => {
			// Act & Assert
			expect(() => new GeminiEmbedder("")).toThrow("API key is required for Gemini embedder")
			expect(() => new GeminiEmbedder(null as any)).toThrow("API key is required for Gemini embedder")
			expect(() => new GeminiEmbedder(undefined as any)).toThrow("API key is required for Gemini embedder")
		})
	})

	describe("embedderInfo", () => {
		it("should return correct embedder info with dimension 768", () => {
			// Arrange
			embedder = new GeminiEmbedder("test-api-key")

			// Act
			const info = embedder.embedderInfo

			// Assert
			expect(info).toEqual({
				name: "gemini",
			})
			expect(GeminiEmbedder.dimension).toBe(768)
		})
	})

	describe("validateConfiguration", () => {
		let mockValidateConfiguration: any

		beforeEach(() => {
			mockValidateConfiguration = vitest.fn()
			MockedOpenAICompatibleEmbedder.prototype.validateConfiguration = mockValidateConfiguration
		})

		it("should delegate validation to OpenAICompatibleEmbedder", async () => {
			// Arrange
			embedder = new GeminiEmbedder("test-api-key")
			mockValidateConfiguration.mockResolvedValue({ valid: true })

			// Act
			const result = await embedder.validateConfiguration()

			// Assert
			expect(mockValidateConfiguration).toHaveBeenCalled()
			expect(result).toEqual({ valid: true })
		})

		it("should pass through validation errors from OpenAICompatibleEmbedder", async () => {
			// Arrange
			embedder = new GeminiEmbedder("test-api-key")
			mockValidateConfiguration.mockResolvedValue({
				valid: false,
				error: "embeddings:validation.authenticationFailed",
			})

			// Act
			const result = await embedder.validateConfiguration()

			// Assert
			expect(mockValidateConfiguration).toHaveBeenCalled()
			expect(result).toEqual({
				valid: false,
				error: "embeddings:validation.authenticationFailed",
			})
		})

		it("should handle validation exceptions", async () => {
			// Arrange
			embedder = new GeminiEmbedder("test-api-key")
			mockValidateConfiguration.mockRejectedValue(new Error("Validation failed"))

			// Act & Assert
			await expect(embedder.validateConfiguration()).rejects.toThrow("Validation failed")
		})
	})
})
