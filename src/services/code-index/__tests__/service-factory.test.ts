import { CodeIndexServiceFactory } from "../service-factory"
import { CodeIndexConfigManager } from "../config-manager"
import { CacheManager } from "../cache-manager"
import { OpenAiEmbedder } from "../embedders/openai"
import { CodeIndexOllamaEmbedder } from "../embedders/ollama"
import { QdrantVectorStore } from "../vector-store/qdrant-client"

// Mock the embedders and vector store
jest.mock("../embedders/openai")
jest.mock("../embedders/ollama")
jest.mock("../vector-store/qdrant-client")

// Mock the embedding models module
jest.mock("../../../shared/embeddingModels", () => ({
	getDefaultModelId: jest.fn(),
	getModelDimension: jest.fn(),
}))

const MockedOpenAiEmbedder = OpenAiEmbedder as jest.MockedClass<typeof OpenAiEmbedder>
const MockedCodeIndexOllamaEmbedder = CodeIndexOllamaEmbedder as jest.MockedClass<typeof CodeIndexOllamaEmbedder>
const MockedQdrantVectorStore = QdrantVectorStore as jest.MockedClass<typeof QdrantVectorStore>

// Import the mocked functions
import { getDefaultModelId, getModelDimension } from "../../../shared/embeddingModels"
const mockGetDefaultModelId = getDefaultModelId as jest.MockedFunction<typeof getDefaultModelId>
const mockGetModelDimension = getModelDimension as jest.MockedFunction<typeof getModelDimension>

describe("CodeIndexServiceFactory", () => {
	let factory: CodeIndexServiceFactory
	let mockConfigManager: jest.Mocked<CodeIndexConfigManager>
	let mockCacheManager: jest.Mocked<CacheManager>

	beforeEach(() => {
		jest.clearAllMocks()

		mockConfigManager = {
			getConfig: jest.fn(),
		} as any

		mockCacheManager = {} as any

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
			expect(() => factory.createEmbedder()).toThrow("OpenAI configuration missing for embedder creation")
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
			expect(() => factory.createEmbedder()).toThrow("Ollama configuration missing for embedder creation")
		})

		it("should throw error for invalid embedder provider", () => {
			// Arrange
			const testConfig = {
				embedderProvider: "invalid-provider",
				modelId: "some-model",
			}
			mockConfigManager.getConfig.mockReturnValue(testConfig as any)

			// Act & Assert
			expect(() => factory.createEmbedder()).toThrow("Invalid embedder type configured: invalid-provider")
		})
	})

	describe("createVectorStore", () => {
		beforeEach(() => {
			jest.clearAllMocks()
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
			expect(() => factory.createVectorStore()).toThrow(
				"Could not determine vector dimension for model 'unknown-model'. Check model profiles or config.",
			)
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
			expect(() => factory.createVectorStore()).toThrow("Qdrant URL missing for vector store creation")
		})
	})
})
