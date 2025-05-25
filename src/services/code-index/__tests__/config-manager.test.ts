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
			// Initial state - properly configured
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-large",
			})
			mockContextProxy.getSecret.mockImplementation((key: string) => {
				if (key === "codeIndexOpenAiKey") return "test-openai-key"
				return undefined
			})

			await configManager.loadConfiguration()

			// Change provider
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "ollama",
				codebaseIndexEmbedderBaseUrl: "http://ollama.local",
				codebaseIndexEmbedderModelId: "nomic-embed-text",
			})

			const result = await configManager.loadConfiguration()
			expect(result.requiresRestart).toBe(true)
		})

		it("should detect restart requirement when vector dimensions change", async () => {
			// Initial state with text-embedding-3-small (1536D)
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-small",
			})
			mockContextProxy.getSecret.mockReturnValue("test-key")

			await configManager.loadConfiguration()

			// Change to text-embedding-3-large (3072D)
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-large",
			})

			const result = await configManager.loadConfiguration()
			expect(result.requiresRestart).toBe(true)
		})

		it("should NOT require restart when models have same dimensions", async () => {
			// Initial state with text-embedding-3-small (1536D)
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-small",
			})
			mockContextProxy.getSecret.mockImplementation((key: string) => {
				if (key === "codeIndexOpenAiKey") return "test-key"
				return undefined
			})

			await configManager.loadConfiguration()

			// Change to text-embedding-ada-002 (also 1536D)
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-ada-002",
			})

			const result = await configManager.loadConfiguration()
			expect(result.requiresRestart).toBe(false)
		})

		it("should detect restart requirement when transitioning to enabled+configured", async () => {
			// Initial state - disabled
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: false,
			})

			await configManager.loadConfiguration()

			// Enable and configure
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-small",
			})
			mockContextProxy.getSecret.mockReturnValue("test-key")

			const result = await configManager.loadConfiguration()
			expect(result.requiresRestart).toBe(true)
		})

		describe("simplified restart detection", () => {
			it("should detect restart requirement for API key changes", async () => {
				// Initial state
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
					codebaseIndexEmbedderModelId: "text-embedding-3-small",
				})
				mockContextProxy.getSecret.mockReturnValue("old-key")

				await configManager.loadConfiguration()

				// Change API key
				mockContextProxy.getSecret.mockImplementation((key: string) => {
					if (key === "codeIndexOpenAiKey") return "new-key"
					return undefined
				})

				const result = await configManager.loadConfiguration()
				expect(result.requiresRestart).toBe(true)
			})

			it("should detect restart requirement for Qdrant URL changes", async () => {
				// Initial state
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://old-qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
					codebaseIndexEmbedderModelId: "text-embedding-3-small",
				})
				mockContextProxy.getSecret.mockReturnValue("test-key")

				await configManager.loadConfiguration()

				// Change Qdrant URL
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://new-qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
					codebaseIndexEmbedderModelId: "text-embedding-3-small",
				})

				const result = await configManager.loadConfiguration()
				expect(result.requiresRestart).toBe(true)
			})

			it("should handle unknown model dimensions safely", async () => {
				// Initial state with known model
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
					codebaseIndexEmbedderModelId: "text-embedding-3-small",
				})
				mockContextProxy.getSecret.mockReturnValue("test-key")

				await configManager.loadConfiguration()

				// Change to unknown model
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
					codebaseIndexEmbedderModelId: "unknown-model",
				})

				const result = await configManager.loadConfiguration()
				expect(result.requiresRestart).toBe(true)
			})

			it("should handle Ollama configuration changes", async () => {
				// Initial state
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "ollama",
					codebaseIndexEmbedderBaseUrl: "http://old-ollama.local",
					codebaseIndexEmbedderModelId: "nomic-embed-text",
				})

				await configManager.loadConfiguration()

				// Change Ollama base URL
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "ollama",
					codebaseIndexEmbedderBaseUrl: "http://new-ollama.local",
					codebaseIndexEmbedderModelId: "nomic-embed-text",
				})

				const result = await configManager.loadConfiguration()
				expect(result.requiresRestart).toBe(true)
			})

			it("should not require restart when disabled remains disabled", async () => {
				// Initial state - disabled but configured
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: false,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
				})
				mockContextProxy.getSecret.mockImplementation((key: string) => {
					if (key === "codeIndexOpenAiKey") return "test-key"
					return undefined
				})

				await configManager.loadConfiguration()

				// Still disabled but change other settings
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: false,
					codebaseIndexQdrantUrl: "http://different-qdrant.local",
					codebaseIndexEmbedderProvider: "ollama",
					codebaseIndexEmbedderBaseUrl: "http://ollama.local",
				})

				const result = await configManager.loadConfiguration()
				expect(result.requiresRestart).toBe(false)
			})

			it("should not require restart when unconfigured remains unconfigured", async () => {
				// Initial state - enabled but unconfigured (missing API key)
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
				})
				mockContextProxy.getSecret.mockReturnValue(undefined)

				await configManager.loadConfiguration()

				// Still unconfigured but change model
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
					codebaseIndexEmbedderModelId: "text-embedding-3-large",
				})

				const result = await configManager.loadConfiguration()
				expect(result.requiresRestart).toBe(false)
			})
		})

		describe("empty/missing API key handling", () => {
			it("should not require restart when API keys are consistently empty", async () => {
				// Initial state with no API keys (undefined from secrets)
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
					codebaseIndexEmbedderModelId: "text-embedding-3-small",
				})
				mockContextProxy.getSecret.mockReturnValue(undefined)

				await configManager.loadConfiguration()

				// Change an unrelated setting while keeping API keys empty
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
					codebaseIndexEmbedderModelId: "text-embedding-3-small",
					codebaseIndexSearchMinScore: 0.5, // Changed unrelated setting
				})

				const result = await configManager.loadConfiguration()
				// Should NOT require restart since API keys are consistently empty
				expect(result.requiresRestart).toBe(false)
			})

			it("should not require restart when API keys transition from undefined to empty string", async () => {
				// Initial state with undefined API keys
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: false, // Start disabled to avoid restart due to enable+configure
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
				})
				mockContextProxy.getSecret.mockReturnValue(undefined)

				await configManager.loadConfiguration()

				// Change to empty string API keys (simulating what happens when secrets return "")
				mockContextProxy.getSecret.mockReturnValue("")

				const result = await configManager.loadConfiguration()
				// Should NOT require restart since undefined and "" are both "empty"
				expect(result.requiresRestart).toBe(false)
			})

			it("should require restart when API key actually changes from empty to non-empty", async () => {
				// Initial state with empty API key
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
				})
				mockContextProxy.getSecret.mockReturnValue("")

				await configManager.loadConfiguration()

				// Add actual API key
				mockContextProxy.getSecret.mockImplementation((key: string) => {
					if (key === "codeIndexOpenAiKey") return "actual-api-key"
					return ""
				})

				const result = await configManager.loadConfiguration()
				// Should require restart since we went from empty to actual key
				expect(result.requiresRestart).toBe(true)
			})
		})

		describe("getRestartInfo public method", () => {
			it("should provide restart info without loading configuration", async () => {
				// Setup initial state
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
					codebaseIndexEmbedderModelId: "text-embedding-3-small",
				})
				mockContextProxy.getSecret.mockReturnValue("test-key")

				await configManager.loadConfiguration()

				// Create a mock previous config
				const mockPrevConfig = {
					enabled: true,
					configured: true,
					embedderProvider: "openai" as const,
					modelId: "text-embedding-3-large", // Different model with different dimensions
					openAiKey: "test-key",
					ollamaBaseUrl: undefined,
					qdrantUrl: "http://qdrant.local",
					qdrantApiKey: undefined,
				}

				const requiresRestart = configManager.doesConfigChangeRequireRestart(mockPrevConfig)
				expect(requiresRestart).toBe(true)
			})
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

	describe("initialization and restart prevention", () => {
		it("should not require restart when configuration hasn't changed between calls", async () => {
			// Setup initial configuration - start with enabled and configured to avoid initial transition restart
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-small",
			})
			mockContextProxy.getSecret.mockImplementation((key: string) => {
				if (key === "codeIndexOpenAiKey") return "test-key"
				return undefined
			})

			// First load - this will initialize the config manager with current state
			await configManager.loadConfiguration()

			// Second load with same configuration - should not require restart
			const secondResult = await configManager.loadConfiguration()
			expect(secondResult.requiresRestart).toBe(false)
		})

		it("should properly initialize with current config to prevent false restarts", async () => {
			// Setup configuration
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: false, // Start disabled to avoid transition restart
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-small",
			})
			mockContextProxy.getSecret.mockImplementation((key: string) => {
				if (key === "codeIndexOpenAiKey") return "test-key"
				return undefined
			})

			// Create a new config manager (simulating what happens in CodeIndexManager.initialize)
			const newConfigManager = new CodeIndexConfigManager(mockContextProxy)

			// Load configuration - should not require restart since the manager should be initialized with current config
			const result = await newConfigManager.loadConfiguration()
			expect(result.requiresRestart).toBe(false)
		})

		it("should not require restart when settings are saved but code indexing config unchanged", async () => {
			// This test simulates the original issue: handleExternalSettingsChange() being called
			// when other settings are saved, but code indexing settings haven't changed

			// Setup initial state - enabled and configured
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-small",
			})
			mockContextProxy.getSecret.mockImplementation((key: string) => {
				if (key === "codeIndexOpenAiKey") return "test-key"
				return undefined
			})

			// First load to establish baseline
			await configManager.loadConfiguration()

			// Simulate external settings change where code indexing config hasn't changed
			// (this is what happens when other settings are saved)
			const result = await configManager.loadConfiguration()
			expect(result.requiresRestart).toBe(false)
		})
	})
})
