import { ContextProxy } from "../../../core/config/ContextProxy"
import { CodeIndexConfigManager } from "../config-manager"

describe("CodeIndexConfigManager", () => {
	let mockContextProxy: jest.Mocked<ContextProxy>
	let configManager: CodeIndexConfigManager

	beforeEach(() => {
		// Setup mock ContextProxy
		mockContextProxy = {
			getGlobalState: jest.fn(),
			getSecret: jest.fn().mockReturnValue(undefined),
		} as unknown as jest.Mocked<ContextProxy>

		configManager = new CodeIndexConfigManager(mockContextProxy)
	})

	describe("constructor", () => {
		it("should initialize with ContextProxy", () => {
			expect(configManager).toBeDefined()
			expect(configManager.isFeatureEnabled).toBe(false)
			expect(configManager.currentEmbedderProvider).toBe("openai")
		})
	})

	describe("loadConfiguration", () => {
		it("should load default configuration when no state exists", async () => {
			mockContextProxy.getGlobalState.mockReturnValue(undefined)
			mockContextProxy.getSecret.mockReturnValue(undefined)

			const result = await configManager.loadConfiguration()

			expect(result.currentConfig).toEqual({
				isEnabled: false,
				isConfigured: false,
				embedderProvider: "openai",
				modelId: undefined,
				openAiOptions: { openAiNativeApiKey: "" },
				ollamaOptions: { ollamaBaseUrl: "" },
				qdrantUrl: "http://localhost:6333",
				qdrantApiKey: "",
				searchMinScore: 0.4,
			})
			expect(result.requiresRestart).toBe(false)
			expect(result.requiresClear).toBe(false)
		})

		it("should load configuration from globalState and secrets", async () => {
			const mockGlobalState = {
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderBaseUrl: "",
				codebaseIndexEmbedderModelId: "text-embedding-3-large",
			}
			mockContextProxy.getGlobalState.mockReturnValue(mockGlobalState)
			mockContextProxy.getSecret.mockImplementation((key: string) => {
				if (key === "codeIndexOpenAiKey") return "test-openai-key"
				if (key === "codeIndexQdrantApiKey") return "test-qdrant-key"
				return undefined
			})

			const result = await configManager.loadConfiguration()

			expect(result.currentConfig).toEqual({
				isEnabled: true,
				isConfigured: true,
				embedderProvider: "openai",
				modelId: "text-embedding-3-large",
				openAiOptions: { openAiNativeApiKey: "test-openai-key" },
				ollamaOptions: { ollamaBaseUrl: "" },
				qdrantUrl: "http://qdrant.local",
				qdrantApiKey: "test-qdrant-key",
				searchMinScore: 0.4,
			})
		})

		it("should detect restart requirement when provider changes", async () => {
			// Initial state
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-large",
			})

			await configManager.loadConfiguration()

			// Change provider
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "ollama",
				codebaseIndexEmbedderBaseUrl: "http://ollama.local",
				codebaseIndexEmbedderModelId: "llama2",
			})

			const result = await configManager.loadConfiguration()
			expect(result.requiresRestart).toBe(true)
		})

		it("should detect clear requirement when model dimensions change", async () => {
			// Initial state with a model
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-small",
			})

			await configManager.loadConfiguration()

			// Change to a model with different dimensions
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-large",
			})

			const result = await configManager.loadConfiguration()
			expect(result.requiresClear).toBe(true)
		})
	})

	describe("isConfigured", () => {
		it("should validate OpenAI configuration correctly", async () => {
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
			})
			mockContextProxy.getSecret.mockImplementation((key: string) => {
				if (key === "codeIndexOpenAiKey") return "test-key"
				return undefined
			})

			await configManager.loadConfiguration()
			expect(configManager.isFeatureConfigured).toBe(true)
		})

		it("should validate Ollama configuration correctly", async () => {
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "ollama",
				codebaseIndexEmbedderBaseUrl: "http://ollama.local",
			})

			await configManager.loadConfiguration()
			expect(configManager.isFeatureConfigured).toBe(true)
		})

		it("should return false when required values are missing", async () => {
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexEmbedderProvider: "openai",
			})

			await configManager.loadConfiguration()
			expect(configManager.isFeatureConfigured).toBe(false)
		})
	})

	describe("getter properties", () => {
		beforeEach(async () => {
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-large",
			})
			mockContextProxy.getSecret.mockImplementation((key: string) => {
				if (key === "codeIndexOpenAiKey") return "test-openai-key"
				if (key === "codeIndexQdrantApiKey") return "test-qdrant-key"
				return undefined
			})

			await configManager.loadConfiguration()
		})

		it("should return correct configuration via getConfig", () => {
			const config = configManager.getConfig()
			expect(config).toEqual({
				isEnabled: true,
				isConfigured: true,
				embedderProvider: "openai",
				modelId: "text-embedding-3-large",
				openAiOptions: { openAiNativeApiKey: "test-openai-key" },
				ollamaOptions: { ollamaBaseUrl: undefined },
				qdrantUrl: "http://qdrant.local",
				qdrantApiKey: "test-qdrant-key",
				searchMinScore: 0.4,
			})
		})

		it("should return correct feature enabled state", () => {
			expect(configManager.isFeatureEnabled).toBe(true)
		})

		it("should return correct embedder provider", () => {
			expect(configManager.currentEmbedderProvider).toBe("openai")
		})

		it("should return correct Qdrant configuration", () => {
			expect(configManager.qdrantConfig).toEqual({
				url: "http://qdrant.local",
				apiKey: "test-qdrant-key",
			})
		})

		it("should return correct model ID", () => {
			expect(configManager.currentModelId).toBe("text-embedding-3-large")
		})
	})
})
