// npx vitest run src/services/code-index/embedders/__tests__/vercel-ai-gateway.spec.ts

import { VercelAiGatewayEmbedder } from "../vercel-ai-gateway"
import { OpenAICompatibleEmbedder } from "../openai-compatible"

// Mock the OpenAICompatibleEmbedder
vi.mock("../openai-compatible", () => ({
	OpenAICompatibleEmbedder: vi.fn(),
}))

// Mock the TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

const MockedOpenAICompatibleEmbedder = vi.mocked(OpenAICompatibleEmbedder)

describe("VercelAiGatewayEmbedder", () => {
	let embedder: VercelAiGatewayEmbedder
	let mockOpenAICompatibleEmbedder: any

	beforeEach(() => {
		vi.clearAllMocks()
		mockOpenAICompatibleEmbedder = {
			createEmbeddings: vi.fn(),
			validateConfiguration: vi.fn(),
		}
		MockedOpenAICompatibleEmbedder.mockImplementation(() => mockOpenAICompatibleEmbedder)
	})

	describe("constructor", () => {
		it("should create VercelAiGatewayEmbedder with default model", () => {
			// Arrange
			const apiKey = "test-vercel-api-key"

			// Act
			embedder = new VercelAiGatewayEmbedder(apiKey)

			// Assert
			expect(MockedOpenAICompatibleEmbedder).toHaveBeenCalledWith(
				"https://ai-gateway.vercel.sh/v1",
				apiKey,
				"openai/text-embedding-3-large",
				8191,
			)
		})

		it("should create VercelAiGatewayEmbedder with custom model", () => {
			// Arrange
			const apiKey = "test-vercel-api-key"
			const modelId = "openai/text-embedding-3-small"

			// Act
			embedder = new VercelAiGatewayEmbedder(apiKey, modelId)

			// Assert
			expect(MockedOpenAICompatibleEmbedder).toHaveBeenCalledWith(
				"https://ai-gateway.vercel.sh/v1",
				apiKey,
				"openai/text-embedding-3-small",
				8191,
			)
		})

		it("should throw error when API key is missing", () => {
			// Act & Assert
			expect(() => new VercelAiGatewayEmbedder("")).toThrow("validation.apiKeyRequired")
		})
	})

	describe("createEmbeddings", () => {
		beforeEach(() => {
			embedder = new VercelAiGatewayEmbedder("test-api-key")
		})

		it("should delegate to OpenAICompatibleEmbedder with default model", async () => {
			// Arrange
			const texts = ["test text 1", "test text 2"]
			const expectedResponse = {
				embeddings: [
					[0.1, 0.2],
					[0.3, 0.4],
				],
			}
			mockOpenAICompatibleEmbedder.createEmbeddings.mockResolvedValue(expectedResponse)

			// Act
			const result = await embedder.createEmbeddings(texts)

			// Assert
			expect(mockOpenAICompatibleEmbedder.createEmbeddings).toHaveBeenCalledWith(
				texts,
				"openai/text-embedding-3-large",
			)
			expect(result).toBe(expectedResponse)
		})

		it("should delegate to OpenAICompatibleEmbedder with custom model", async () => {
			// Arrange
			const texts = ["test text"]
			const customModel = "google/gemini-embedding-001"
			const expectedResponse = { embeddings: [[0.1, 0.2, 0.3]] }
			mockOpenAICompatibleEmbedder.createEmbeddings.mockResolvedValue(expectedResponse)

			// Act
			const result = await embedder.createEmbeddings(texts, customModel)

			// Assert
			expect(mockOpenAICompatibleEmbedder.createEmbeddings).toHaveBeenCalledWith(texts, customModel)
			expect(result).toBe(expectedResponse)
		})

		it("should handle errors from OpenAICompatibleEmbedder", async () => {
			// Arrange
			const texts = ["test text"]
			const error = new Error("API request failed")
			mockOpenAICompatibleEmbedder.createEmbeddings.mockRejectedValue(error)

			// Act & Assert
			await expect(embedder.createEmbeddings(texts)).rejects.toThrow("API request failed")
			expect(mockOpenAICompatibleEmbedder.createEmbeddings).toHaveBeenCalledWith(
				texts,
				"openai/text-embedding-3-large",
			)
		})
	})

	describe("validateConfiguration", () => {
		beforeEach(() => {
			embedder = new VercelAiGatewayEmbedder("test-api-key")
		})

		it("should delegate to OpenAICompatibleEmbedder", async () => {
			// Arrange
			const expectedResult = { valid: true }
			mockOpenAICompatibleEmbedder.validateConfiguration.mockResolvedValue(expectedResult)

			// Act
			const result = await embedder.validateConfiguration()

			// Assert
			expect(mockOpenAICompatibleEmbedder.validateConfiguration).toHaveBeenCalled()
			expect(result).toBe(expectedResult)
		})

		it("should handle validation errors", async () => {
			// Arrange
			const error = new Error("Validation failed")
			mockOpenAICompatibleEmbedder.validateConfiguration.mockRejectedValue(error)

			// Act & Assert
			await expect(embedder.validateConfiguration()).rejects.toThrow("Validation failed")
			expect(mockOpenAICompatibleEmbedder.validateConfiguration).toHaveBeenCalled()
		})
	})

	describe("embedderInfo", () => {
		it("should return correct embedder info", () => {
			// Arrange
			embedder = new VercelAiGatewayEmbedder("test-api-key")

			// Act
			const info = embedder.embedderInfo

			// Assert
			expect(info).toEqual({
				name: "vercel-ai-gateway",
			})
		})
	})
})
