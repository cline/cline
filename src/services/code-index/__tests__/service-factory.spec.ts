import type { MockedClass, MockedFunction } from "vitest"
import { CodeIndexServiceFactory } from "../service-factory"
import { OpenAiEmbedder } from "../embedders/openai"
import { CodeIndexOllamaEmbedder } from "../embedders/ollama"
import { OpenAICompatibleEmbedder } from "../embedders/openai-compatible"
import { GeminiEmbedder } from "../embedders/gemini"
import { QdrantVectorStore } from "../vector-store/qdrant-client"

// Mock the embedders and vector store
vitest.mock("../embedders/openai")
vitest.mock("../embedders/ollama")
vitest.mock("../embedders/openai-compatible")
vitest.mock("../embedders/gemini")
vitest.mock("../vector-store/qdrant-client")

// Mock the embedding models module
vitest.mock("../../../shared/embeddingModels", () => ({
	getDefaultModelId: vitest.fn(),
	getModelDimension: vitest.fn(),
}))

const MockedOpenAiEmbedder = OpenAiEmbedder as MockedClass<typeof OpenAiEmbedder>
const MockedCodeIndexOllamaEmbedder = CodeIndexOllamaEmbedder as MockedClass<typeof CodeIndexOllamaEmbedder>
const MockedOpenAICompatibleEmbedder = OpenAICompatibleEmbedder as MockedClass<typeof OpenAICompatibleEmbedder>
const MockedGeminiEmbedder = GeminiEmbedder as MockedClass<typeof GeminiEmbedder>
const MockedQdrantVectorStore = QdrantVectorStore as MockedClass<typeof QdrantVectorStore>

// Import the mocked functions
import { getDefaultModelId, getModelDimension } from "../../../shared/embeddingModels"
const mockGetDefaultModelId = getDefaultModelId as MockedFunction<typeof getDefaultModelId>
const mockGetModelDimension = getModelDimension as MockedFunction<typeof getModelDimension>

describe("CodeIndexServiceFactory", () => {
	let factory: CodeIndexServiceFactory
	let mockConfigManager: any
	let mockCacheManager: any

	beforeEach(() => {
		vitest.clearAllMocks()

		mockConfigManager = {
			getConfig: vitest.fn(),
		}

		mockCacheManager = {}

		factory = new CodeIndexServiceFactory(mockConfigManager, "/test/workspace", mockCacheManager)
	})

	describe("createEmbedder", () => {
		it("should pass model ID to OpenAI embedder when using OpenAI provider", () => {
			// Arrange
			const testModelId = "text-embedding-3-large"
			const testConfig = {
				embedderProvider: "openai",
				modelId: testModelId,
				openAiOptions: {
					openAiNativeApiKey: "test-api-key",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act
			factory.createEmbedder()

			// Assert
			expect(MockedOpenAiEmbedder).toHaveBeenCalledWith({
				openAiNativeApiKey: "test-api-key",
				openAiEmbeddingModelId: testModelId,
			})
		})

		it("should pass model ID to Ollama embedder when using Ollama provider", () => {
			// Arrange
			const testModelId = "nomic-embed-text:latest"
			const testConfig = {
				embedderProvider: "ollama",
				modelId: testModelId,
				ollamaOptions: {
					ollamaBaseUrl: "http://localhost:11434",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act
			factory.createEmbedder()

			// Assert
			expect(MockedCodeIndexOllamaEmbedder).toHaveBeenCalledWith({
				ollamaBaseUrl: "http://localhost:11434",
				ollamaModelId: testModelId,
			})
		})

		it("should handle undefined model ID for OpenAI embedder", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai",
				modelId: undefined,
				openAiOptions: {
					openAiNativeApiKey: "test-api-key",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act
			factory.createEmbedder()

			// Assert
			expect(MockedOpenAiEmbedder).toHaveBeenCalledWith({
				openAiNativeApiKey: "test-api-key",
				openAiEmbeddingModelId: undefined,
			})
		})

		it("should handle undefined model ID for Ollama embedder", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "ollama",
				modelId: undefined,
				ollamaOptions: {
					ollamaBaseUrl: "http://localhost:11434",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act
			factory.createEmbedder()

			// Assert
			expect(MockedCodeIndexOllamaEmbedder).toHaveBeenCalledWith({
				ollamaBaseUrl: "http://localhost:11434",
				ollamaModelId: undefined,
			})
		})

		it("should throw error when OpenAI API key is missing", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai",
				modelId: "text-embedding-3-large",
				openAiOptions: {
					openAiNativeApiKey: undefined,
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act & Assert
			expect(() => factory.createEmbedder()).toThrow("serviceFactory.openAiConfigMissing")
		})

		it("should throw error when Ollama base URL is missing", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "ollama",
				modelId: "nomic-embed-text:latest",
				ollamaOptions: {
					ollamaBaseUrl: undefined,
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act & Assert
			expect(() => factory.createEmbedder()).toThrow("serviceFactory.ollamaConfigMissing")
		})

		it("should pass model ID to OpenAI Compatible embedder when using OpenAI Compatible provider", () => {
			// Arrange
			const testModelId = "text-embedding-3-large"
			const testConfig = {
				embedderProvider: "openai-compatible",
				modelId: testModelId,
				openAiCompatibleOptions: {
					baseUrl: "https://api.example.com/v1",
					apiKey: "test-api-key",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act
			factory.createEmbedder()

			// Assert
			expect(MockedOpenAICompatibleEmbedder).toHaveBeenCalledWith(
				"https://api.example.com/v1",
				"test-api-key",
				testModelId,
			)
		})

		it("should handle undefined model ID for OpenAI Compatible embedder", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai-compatible",
				modelId: undefined,
				openAiCompatibleOptions: {
					baseUrl: "https://api.example.com/v1",
					apiKey: "test-api-key",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act
			factory.createEmbedder()

			// Assert
			expect(MockedOpenAICompatibleEmbedder).toHaveBeenCalledWith(
				"https://api.example.com/v1",
				"test-api-key",
				undefined,
			)
		})

		it("should throw error when OpenAI Compatible base URL is missing", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai-compatible",
				modelId: "text-embedding-3-large",
				openAiCompatibleOptions: {
					baseUrl: undefined,
					apiKey: "test-api-key",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act & Assert
			expect(() => factory.createEmbedder()).toThrow("serviceFactory.openAiCompatibleConfigMissing")
		})

		it("should throw error when OpenAI Compatible API key is missing", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai-compatible",
				modelId: "text-embedding-3-large",
				openAiCompatibleOptions: {
					baseUrl: "https://api.example.com/v1",
					apiKey: undefined,
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act & Assert
			expect(() => factory.createEmbedder()).toThrow("serviceFactory.openAiCompatibleConfigMissing")
		})

		it("should throw error when OpenAI Compatible options are missing", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai-compatible",
				modelId: "text-embedding-3-large",
				openAiCompatibleOptions: undefined,
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act & Assert
			expect(() => factory.createEmbedder()).toThrow("serviceFactory.openAiCompatibleConfigMissing")
		})

		it("should create GeminiEmbedder when using Gemini provider", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "gemini",
				geminiOptions: {
					apiKey: "test-gemini-api-key",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act
			factory.createEmbedder()

			// Assert
			expect(MockedGeminiEmbedder).toHaveBeenCalledWith("test-gemini-api-key")
		})

		it("should throw error when Gemini API key is missing", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "gemini",
				geminiOptions: {
					apiKey: undefined,
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act & Assert
			expect(() => factory.createEmbedder()).toThrow("serviceFactory.geminiConfigMissing")
		})

		it("should throw error when Gemini options are missing", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "gemini",
				geminiOptions: undefined,
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act & Assert
			expect(() => factory.createEmbedder()).toThrow("serviceFactory.geminiConfigMissing")
		})

		it("should throw error for invalid embedder provider", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "invalid-provider",
				modelId: "some-model",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act & Assert
			expect(() => factory.createEmbedder()).toThrow("serviceFactory.invalidEmbedderType")
		})
	})

	describe("createVectorStore", () => {
		beforeEach(() => {
			vitest.clearAllMocks()
			mockGetDefaultModelId.mockReturnValue("default-model")
		})

		it("should use config.modelId for OpenAI provider", () => {
			// Arrange
			const testModelId = "text-embedding-3-large"
			const testConfig = {
				embedderProvider: "openai",
				modelId: testModelId,
				qdrantUrl: "http://localhost:6333",
				qdrantApiKey: "test-key",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			mockGetModelDimension.mockReturnValue(3072)

			// Act
			factory.createVectorStore()

			// Assert
			expect(mockGetModelDimension).toHaveBeenCalledWith("openai", testModelId)
			expect(MockedQdrantVectorStore).toHaveBeenCalledWith(
				"/test/workspace",
				"http://localhost:6333",
				3072,
				"test-key",
			)
		})

		it("should use config.modelId for Ollama provider", () => {
			// Arrange
			const testModelId = "nomic-embed-text:latest"
			const testConfig = {
				embedderProvider: "ollama",
				modelId: testModelId,
				qdrantUrl: "http://localhost:6333",
				qdrantApiKey: "test-key",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			mockGetModelDimension.mockReturnValue(768)

			// Act
			factory.createVectorStore()

			// Assert
			expect(mockGetModelDimension).toHaveBeenCalledWith("ollama", testModelId)
			expect(MockedQdrantVectorStore).toHaveBeenCalledWith(
				"/test/workspace",
				"http://localhost:6333",
				768,
				"test-key",
			)
		})

		it("should use config.modelId for OpenAI Compatible provider", () => {
			// Arrange
			const testModelId = "text-embedding-3-large"
			const testConfig = {
				embedderProvider: "openai-compatible",
				modelId: testModelId,
				qdrantUrl: "http://localhost:6333",
				qdrantApiKey: "test-key",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			mockGetModelDimension.mockReturnValue(3072)

			// Act
			factory.createVectorStore()

			// Assert
			expect(mockGetModelDimension).toHaveBeenCalledWith("openai-compatible", testModelId)
			expect(MockedQdrantVectorStore).toHaveBeenCalledWith(
				"/test/workspace",
				"http://localhost:6333",
				3072,
				"test-key",
			)
		})

		it("should prioritize manual modelDimension over getModelDimension for OpenAI Compatible provider", () => {
			// Arrange
			const testModelId = "custom-model"
			const manualDimension = 1024
			const testConfig = {
				embedderProvider: "openai-compatible",
				modelId: testModelId,
				modelDimension: manualDimension,
				openAiCompatibleOptions: {
					baseUrl: "https://api.example.com/v1",
					apiKey: "test-api-key",
				},
				qdrantUrl: "http://localhost:6333",
				qdrantApiKey: "test-key",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			mockGetModelDimension.mockReturnValue(768) // This should be ignored

			// Act
			factory.createVectorStore()

			// Assert
			expect(mockGetModelDimension).not.toHaveBeenCalled()
			expect(MockedQdrantVectorStore).toHaveBeenCalledWith(
				"/test/workspace",
				"http://localhost:6333",
				manualDimension,
				"test-key",
			)
		})

		it("should fall back to getModelDimension when manual modelDimension is not set for OpenAI Compatible", () => {
			// Arrange
			const testModelId = "custom-model"
			const testConfig = {
				embedderProvider: "openai-compatible",
				modelId: testModelId,
				openAiCompatibleOptions: {
					baseUrl: "https://api.example.com/v1",
					apiKey: "test-key",
				},
				qdrantUrl: "http://localhost:6333",
				qdrantApiKey: "test-key",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			mockGetModelDimension.mockReturnValue(768)

			// Act
			factory.createVectorStore()

			// Assert
			expect(mockGetModelDimension).toHaveBeenCalledWith("openai-compatible", testModelId)
			expect(MockedQdrantVectorStore).toHaveBeenCalledWith(
				"/test/workspace",
				"http://localhost:6333",
				768,
				"test-key",
			)
		})

		it("should throw error when manual modelDimension is invalid for OpenAI Compatible", () => {
			// Arrange
			const testModelId = "custom-model"
			const testConfig = {
				embedderProvider: "openai-compatible",
				modelId: testModelId,
				modelDimension: 0, // Invalid dimension
				openAiCompatibleOptions: {
					baseUrl: "https://api.example.com/v1",
					apiKey: "test-api-key",
				},
				qdrantUrl: "http://localhost:6333",
				qdrantApiKey: "test-key",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			mockGetModelDimension.mockReturnValue(undefined)

			// Act & Assert
			expect(() => factory.createVectorStore()).toThrow(
				"serviceFactory.vectorDimensionNotDeterminedOpenAiCompatible",
			)
		})

		it("should throw error when both manual dimension and getModelDimension fail for OpenAI Compatible", () => {
			// Arrange
			const testModelId = "unknown-model"
			const testConfig = {
				embedderProvider: "openai-compatible",
				modelId: testModelId,
				openAiCompatibleOptions: {
					baseUrl: "https://api.example.com/v1",
					apiKey: "test-key",
				},
				qdrantUrl: "http://localhost:6333",
				qdrantApiKey: "test-key",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			mockGetModelDimension.mockReturnValue(undefined)

			// Act & Assert
			expect(() => factory.createVectorStore()).toThrow(
				"serviceFactory.vectorDimensionNotDeterminedOpenAiCompatible",
			)
		})

		it("should use fixed dimension 768 for Gemini provider", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "gemini",
				modelId: "text-embedding-004", // This is ignored by Gemini
				qdrantUrl: "http://localhost:6333",
				qdrantApiKey: "test-key",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act
			factory.createVectorStore()

			// Assert
			// getModelDimension should not be called for Gemini
			expect(mockGetModelDimension).not.toHaveBeenCalled()
			expect(MockedQdrantVectorStore).toHaveBeenCalledWith(
				"/test/workspace",
				"http://localhost:6333",
				768, // Fixed dimension for Gemini
				"test-key",
			)
		})

		it("should use default model when config.modelId is undefined", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai",
				modelId: undefined,
				qdrantUrl: "http://localhost:6333",
				qdrantApiKey: "test-key",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			mockGetModelDimension.mockReturnValue(1536)

			// Act
			factory.createVectorStore()

			// Assert
			expect(mockGetModelDimension).toHaveBeenCalledWith("openai", "default-model")
			expect(MockedQdrantVectorStore).toHaveBeenCalledWith(
				"/test/workspace",
				"http://localhost:6333",
				1536,
				"test-key",
			)
		})

		it("should throw error when vector dimension cannot be determined", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai",
				modelId: "unknown-model",
				qdrantUrl: "http://localhost:6333",
				qdrantApiKey: "test-key",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			mockGetModelDimension.mockReturnValue(undefined)

			// Act & Assert
			expect(() => factory.createVectorStore()).toThrow("serviceFactory.vectorDimensionNotDetermined")
		})

		it("should throw error when Qdrant URL is missing", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai",
				modelId: "text-embedding-3-small",
				qdrantUrl: undefined,
				qdrantApiKey: "test-key",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			mockGetModelDimension.mockReturnValue(1536)

			// Act & Assert
			expect(() => factory.createVectorStore()).toThrow("serviceFactory.qdrantUrlMissing")
		})
	})

	describe("validateEmbedder", () => {
		let mockEmbedderInstance: any

		beforeEach(() => {
			mockEmbedderInstance = {
				validateConfiguration: vitest.fn(),
			}
		})

		it("should validate OpenAI embedder successfully", async () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai",
				modelId: "text-embedding-3-small",
				openAiOptions: {
					openAiNativeApiKey: "test-api-key",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			MockedOpenAiEmbedder.mockImplementation(() => mockEmbedderInstance)
			mockEmbedderInstance.validateConfiguration.mockResolvedValue({ valid: true })

			// Act
			const embedder = factory.createEmbedder()
			const result = await factory.validateEmbedder(embedder)

			// Assert
			expect(result).toEqual({ valid: true })
			expect(mockEmbedderInstance.validateConfiguration).toHaveBeenCalled()
		})

		it("should return validation error from OpenAI embedder", async () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai",
				modelId: "text-embedding-3-small",
				openAiOptions: {
					openAiNativeApiKey: "invalid-key",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			MockedOpenAiEmbedder.mockImplementation(() => mockEmbedderInstance)
			mockEmbedderInstance.validateConfiguration.mockResolvedValue({
				valid: false,
				error: "embeddings:validation.authenticationFailed",
			})

			// Act
			const embedder = factory.createEmbedder()
			const result = await factory.validateEmbedder(embedder)

			// Assert
			expect(result).toEqual({
				valid: false,
				error: "embeddings:validation.authenticationFailed",
			})
		})

		it("should validate Ollama embedder successfully", async () => {
			// Arrange
			const testConfig = {
				embedderProvider: "ollama",
				modelId: "nomic-embed-text",
				ollamaOptions: {
					ollamaBaseUrl: "http://localhost:11434",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			MockedCodeIndexOllamaEmbedder.mockImplementation(() => mockEmbedderInstance)
			mockEmbedderInstance.validateConfiguration.mockResolvedValue({ valid: true })

			// Act
			const embedder = factory.createEmbedder()
			const result = await factory.validateEmbedder(embedder)

			// Assert
			expect(result).toEqual({ valid: true })
			expect(mockEmbedderInstance.validateConfiguration).toHaveBeenCalled()
		})

		it("should validate OpenAI Compatible embedder successfully", async () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai-compatible",
				modelId: "custom-model",
				openAiCompatibleOptions: {
					baseUrl: "https://api.example.com/v1",
					apiKey: "test-api-key",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			MockedOpenAICompatibleEmbedder.mockImplementation(() => mockEmbedderInstance)
			mockEmbedderInstance.validateConfiguration.mockResolvedValue({ valid: true })

			// Act
			const embedder = factory.createEmbedder()
			const result = await factory.validateEmbedder(embedder)

			// Assert
			expect(result).toEqual({ valid: true })
			expect(mockEmbedderInstance.validateConfiguration).toHaveBeenCalled()
		})

		it("should validate Gemini embedder successfully", async () => {
			// Arrange
			const testConfig = {
				embedderProvider: "gemini",
				geminiOptions: {
					apiKey: "test-gemini-api-key",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			MockedGeminiEmbedder.mockImplementation(() => mockEmbedderInstance)
			mockEmbedderInstance.validateConfiguration.mockResolvedValue({ valid: true })

			// Act
			const embedder = factory.createEmbedder()
			const result = await factory.validateEmbedder(embedder)

			// Assert
			expect(result).toEqual({ valid: true })
			expect(mockEmbedderInstance.validateConfiguration).toHaveBeenCalled()
		})

		it("should handle validation exceptions", async () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai",
				modelId: "text-embedding-3-small",
				openAiOptions: {
					openAiNativeApiKey: "test-api-key",
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)
			MockedOpenAiEmbedder.mockImplementation(() => mockEmbedderInstance)
			const networkError = new Error("Network error")
			mockEmbedderInstance.validateConfiguration.mockRejectedValue(networkError)

			// Act
			const embedder = factory.createEmbedder()
			const result = await factory.validateEmbedder(embedder)

			// Assert
			expect(result).toEqual({
				valid: false,
				error: "Network error",
			})
			expect(mockEmbedderInstance.validateConfiguration).toHaveBeenCalled()
		})

		it("should return error for invalid embedder configuration", async () => {
			// Arrange
			const testConfig = {
				embedderProvider: "openai",
				modelId: "text-embedding-3-small",
				openAiOptions: {
					openAiNativeApiKey: undefined, // Missing API key
				},
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act & Assert
			// This should throw when trying to create the embedder
			await expect(async () => {
				const embedder = factory.createEmbedder()
				await factory.validateEmbedder(embedder)
			}).rejects.toThrow("serviceFactory.openAiConfigMissing")
		})

		it("should return error for unknown embedder provider", async () => {
			// Arrange
			const testConfig = {
				embedderProvider: "unknown-provider",
				modelId: "some-model",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act & Assert
			// This should throw when trying to create the embedder
			expect(() => factory.createEmbedder()).toThrow("serviceFactory.invalidEmbedderType")
		})
	})
})
