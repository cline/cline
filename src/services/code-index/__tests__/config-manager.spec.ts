import { CodeIndexConfigManager } from "../config-manager"

describe("CodeIndexConfigManager", () => {
	let mockContextProxy: any
	let configManager: CodeIndexConfigManager

	beforeEach(() => {
		// Setup mock ContextProxy
		mockContextProxy = {
			getGlobalState: vitest.fn(),
			getSecret: vitest.fn().mockReturnValue(undefined),
			refreshSecrets: vitest.fn().mockResolvedValue(undefined),
		}

		configManager = new CodeIndexConfigManager(mockContextProxy)
	})

	// Helper function to setup secret mocking
	const setupSecretMocks = (secrets: Record<string, string>) => {
		// Mock sync secret access
		mockContextProxy.getSecret.mockImplementation((key: string) => {
			return secrets[key] || undefined
		})

		// Mock refreshSecrets to update the getSecret mock with new values
		mockContextProxy.refreshSecrets.mockImplementation(async () => {
			// In real implementation, this would refresh from VSCode storage
			// For tests, we just keep the existing mock behavior
		})
	}

	describe("constructor", () => {
		it("should initialize with ContextProxy", () => {
			expect(configManager).toBeDefined()
			expect(configManager.isFeatureEnabled).toBe(true)
			expect(configManager.currentEmbedderProvider).toBe("openai")
		})
	})

	describe("loadConfiguration", () => {
		it("should load default configuration when no state exists", async () => {
			mockContextProxy.getGlobalState.mockReturnValue(undefined)
			mockContextProxy.getSecret.mockReturnValue(undefined)

			const result = await configManager.loadConfiguration()

			expect(result.currentConfig).toEqual({
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

			// Mock both sync and async secret access
			setupSecretMocks({
				codeIndexOpenAiKey: "test-openai-key",
				codeIndexQdrantApiKey: "test-qdrant-key",
			})

			const result = await configManager.loadConfiguration()

			expect(result.currentConfig).toEqual({
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

		it("should load OpenAI Compatible configuration from globalState and secrets", async () => {
			const mockGlobalState = {
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai-compatible",
				codebaseIndexEmbedderBaseUrl: "",
				codebaseIndexEmbedderModelId: "text-embedding-3-large",
				codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
			}
			mockContextProxy.getGlobalState.mockImplementation((key: string) => {
				if (key === "codebaseIndexConfig") return mockGlobalState
				return undefined
			})

			setupSecretMocks({
				codeIndexQdrantApiKey: "test-qdrant-key",
				codebaseIndexOpenAiCompatibleApiKey: "test-openai-compatible-key",
			})

			const result = await configManager.loadConfiguration()

			expect(result.currentConfig).toEqual({
				isConfigured: true,
				embedderProvider: "openai-compatible",
				modelId: "text-embedding-3-large",
				openAiOptions: { openAiNativeApiKey: "" },
				ollamaOptions: { ollamaBaseUrl: "" },
				openAiCompatibleOptions: {
					baseUrl: "https://api.example.com/v1",
					apiKey: "test-openai-compatible-key",
				},
				qdrantUrl: "http://qdrant.local",
				qdrantApiKey: "test-qdrant-key",
				searchMinScore: 0.4,
			})
		})

		it("should load OpenAI Compatible configuration with modelDimension from globalState", async () => {
			const mockGlobalState = {
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai-compatible",
				codebaseIndexEmbedderBaseUrl: "",
				codebaseIndexEmbedderModelId: "custom-model",
				codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
				codebaseIndexEmbedderModelDimension: 1024,
			}
			mockContextProxy.getGlobalState.mockImplementation((key: string) => {
				if (key === "codebaseIndexConfig") return mockGlobalState
				return undefined
			})
			setupSecretMocks({
				codeIndexQdrantApiKey: "test-qdrant-key",
				codebaseIndexOpenAiCompatibleApiKey: "test-openai-compatible-key",
			})

			const result = await configManager.loadConfiguration()

			expect(result.currentConfig).toEqual({
				isConfigured: true,
				embedderProvider: "openai-compatible",
				modelId: "custom-model",
				modelDimension: 1024,
				openAiOptions: { openAiNativeApiKey: "" },
				ollamaOptions: { ollamaBaseUrl: "" },
				openAiCompatibleOptions: {
					baseUrl: "https://api.example.com/v1",
					apiKey: "test-openai-compatible-key",
				},
				qdrantUrl: "http://qdrant.local",
				qdrantApiKey: "test-qdrant-key",
				searchMinScore: 0.4,
			})
		})

		it("should handle missing modelDimension for OpenAI Compatible configuration", async () => {
			const mockGlobalState = {
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai-compatible",
				codebaseIndexEmbedderBaseUrl: "",
				codebaseIndexEmbedderModelId: "custom-model",
				codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
				// modelDimension is not set
			}
			mockContextProxy.getGlobalState.mockImplementation((key: string) => {
				if (key === "codebaseIndexConfig") return mockGlobalState
				return undefined
			})
			setupSecretMocks({
				codeIndexQdrantApiKey: "test-qdrant-key",
				codebaseIndexOpenAiCompatibleApiKey: "test-openai-compatible-key",
			})

			const result = await configManager.loadConfiguration()

			expect(result.currentConfig).toEqual({
				isConfigured: true,
				embedderProvider: "openai-compatible",
				modelId: "custom-model",
				openAiOptions: { openAiNativeApiKey: "" },
				ollamaOptions: { ollamaBaseUrl: "" },
				openAiCompatibleOptions: {
					baseUrl: "https://api.example.com/v1",
					apiKey: "test-openai-compatible-key",
					// modelDimension is undefined when not set
				},
				qdrantUrl: "http://qdrant.local",
				qdrantApiKey: "test-qdrant-key",
				searchMinScore: 0.4,
			})
		})

		it("should handle invalid modelDimension type for OpenAI Compatible configuration", async () => {
			const mockGlobalState = {
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai-compatible",
				codebaseIndexEmbedderBaseUrl: "",
				codebaseIndexEmbedderModelId: "custom-model",
				codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
				codebaseIndexEmbedderModelDimension: "invalid-dimension", // Invalid type
			}
			mockContextProxy.getGlobalState.mockImplementation((key: string) => {
				if (key === "codebaseIndexConfig") return mockGlobalState
				return undefined
			})
			setupSecretMocks({
				codeIndexQdrantApiKey: "test-qdrant-key",
				codebaseIndexOpenAiCompatibleApiKey: "test-openai-compatible-key",
			})

			const result = await configManager.loadConfiguration()

			expect(result.currentConfig).toEqual({
				isConfigured: true,
				embedderProvider: "openai-compatible",
				modelId: "custom-model",
				modelDimension: undefined, // Invalid dimension is converted to undefined
				openAiOptions: { openAiNativeApiKey: "" },
				ollamaOptions: { ollamaBaseUrl: "" },
				openAiCompatibleOptions: {
					baseUrl: "https://api.example.com/v1",
					apiKey: "test-openai-compatible-key",
				},
				geminiOptions: undefined,
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
			setupSecretMocks({
				codeIndexOpenAiKey: "test-openai-key",
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
			setupSecretMocks({
				codeIndexOpenAiKey: "test-key",
				codeIndexQdrantApiKey: "test-key",
			})

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
			setupSecretMocks({
				codeIndexOpenAiKey: "test-key",
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
			// Initial state - enabled but not configured
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
			})

			await configManager.loadConfiguration()

			// Configure the feature
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-small",
			})
			setupSecretMocks({
				codeIndexOpenAiKey: "test-key",
				codeIndexQdrantApiKey: "test-key",
			})

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
				setupSecretMocks({
					codeIndexOpenAiKey: "old-key",
					codeIndexQdrantApiKey: "old-key",
				})

				await configManager.loadConfiguration()

				// Change API key
				setupSecretMocks({
					codeIndexOpenAiKey: "new-key",
					codeIndexQdrantApiKey: "old-key",
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
				setupSecretMocks({
					codeIndexOpenAiKey: "test-key",
					codeIndexQdrantApiKey: "test-key",
				})

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
				setupSecretMocks({
					codeIndexOpenAiKey: "test-key",
					codeIndexQdrantApiKey: "test-key",
				})

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

			it("should handle OpenAI Compatible configuration changes", async () => {
				// Initial state
				mockContextProxy.getGlobalState.mockImplementation((key: string) => {
					if (key === "codebaseIndexConfig") {
						return {
							codebaseIndexEnabled: true,
							codebaseIndexQdrantUrl: "http://qdrant.local",
							codebaseIndexEmbedderProvider: "openai-compatible",
							codebaseIndexEmbedderModelId: "text-embedding-3-small",
							codebaseIndexOpenAiCompatibleBaseUrl: "https://old-api.example.com/v1",
						}
					}
					return undefined
				})
				setupSecretMocks({
					codebaseIndexOpenAiCompatibleApiKey: "old-api-key",
					codeIndexQdrantApiKey: "test-key",
				})

				await configManager.loadConfiguration()

				// Change OpenAI Compatible base URL
				mockContextProxy.getGlobalState.mockImplementation((key: string) => {
					if (key === "codebaseIndexConfig") {
						return {
							codebaseIndexEnabled: true,
							codebaseIndexQdrantUrl: "http://qdrant.local",
							codebaseIndexEmbedderProvider: "openai-compatible",
							codebaseIndexEmbedderModelId: "text-embedding-3-small",
							codebaseIndexOpenAiCompatibleBaseUrl: "https://new-api.example.com/v1",
						}
					}
					return undefined
				})

				const result = await configManager.loadConfiguration()
				expect(result.requiresRestart).toBe(true)
			})

			it("should handle OpenAI Compatible API key changes", async () => {
				// Initial state
				mockContextProxy.getGlobalState.mockImplementation((key: string) => {
					if (key === "codebaseIndexConfig") {
						return {
							codebaseIndexEnabled: true,
							codebaseIndexQdrantUrl: "http://qdrant.local",
							codebaseIndexEmbedderProvider: "openai-compatible",
							codebaseIndexEmbedderModelId: "text-embedding-3-small",
							codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
						}
					}
					return undefined
				})
				setupSecretMocks({
					codebaseIndexOpenAiCompatibleApiKey: "old-api-key",
					codeIndexQdrantApiKey: "test-key",
				})

				await configManager.loadConfiguration()

				// Change OpenAI Compatible API key
				setupSecretMocks({
					codebaseIndexOpenAiCompatibleApiKey: "new-api-key",
					codeIndexQdrantApiKey: "test-key",
				})

				const result = await configManager.loadConfiguration()
				expect(result.requiresRestart).toBe(true)
			})

			it("should handle OpenAI Compatible modelDimension changes", async () => {
				// Initial state with modelDimension
				mockContextProxy.getGlobalState.mockImplementation((key: string) => {
					if (key === "codebaseIndexConfig") {
						return {
							codebaseIndexEnabled: true,
							codebaseIndexQdrantUrl: "http://qdrant.local",
							codebaseIndexEmbedderProvider: "openai-compatible",
							codebaseIndexEmbedderModelId: "custom-model",
							codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
							codebaseIndexEmbedderModelDimension: 1024,
						}
					}
					return undefined
				})
				setupSecretMocks({
					codebaseIndexOpenAiCompatibleApiKey: "test-api-key",
					codeIndexQdrantApiKey: "test-key",
				})

				await configManager.loadConfiguration()

				// Change modelDimension
				mockContextProxy.getGlobalState.mockImplementation((key: string) => {
					if (key === "codebaseIndexConfig") {
						return {
							codebaseIndexEnabled: true,
							codebaseIndexQdrantUrl: "http://qdrant.local",
							codebaseIndexEmbedderProvider: "openai-compatible",
							codebaseIndexEmbedderModelId: "custom-model",
							codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
							codebaseIndexEmbedderModelDimension: 2048,
						}
					}
					return undefined
				})

				const result = await configManager.loadConfiguration()
				expect(result.requiresRestart).toBe(true)
			})

			it("should not require restart when modelDimension remains the same", async () => {
				// Initial state with modelDimension
				mockContextProxy.getGlobalState.mockImplementation((key: string) => {
					if (key === "codebaseIndexConfig") {
						return {
							codebaseIndexEnabled: true,
							codebaseIndexQdrantUrl: "http://qdrant.local",
							codebaseIndexEmbedderProvider: "openai-compatible",
							codebaseIndexEmbedderModelId: "custom-model",
							codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
							codebaseIndexEmbedderModelDimension: 1024,
						}
					}
					return undefined
				})
				setupSecretMocks({
					codebaseIndexOpenAiCompatibleApiKey: "test-api-key",
					codeIndexQdrantApiKey: "test-key",
				})

				await configManager.loadConfiguration()

				// Keep modelDimension the same, change unrelated setting
				mockContextProxy.getGlobalState.mockImplementation((key: string) => {
					if (key === "codebaseIndexConfig") {
						return {
							codebaseIndexEnabled: true,
							codebaseIndexQdrantUrl: "http://qdrant.local",
							codebaseIndexEmbedderProvider: "openai-compatible",
							codebaseIndexEmbedderModelId: "custom-model",
							codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
							codebaseIndexEmbedderModelDimension: 1024,
							codebaseIndexSearchMinScore: 0.5, // Changed unrelated setting
						}
					}
					return undefined
				})

				const result = await configManager.loadConfiguration()
				expect(result.requiresRestart).toBe(false)
			})

			it("should require restart when modelDimension is added", async () => {
				// Initial state without modelDimension
				mockContextProxy.getGlobalState.mockImplementation((key: string) => {
					if (key === "codebaseIndexConfig") {
						return {
							codebaseIndexEnabled: true,
							codebaseIndexQdrantUrl: "http://qdrant.local",
							codebaseIndexEmbedderProvider: "openai-compatible",
							codebaseIndexEmbedderModelId: "custom-model",
							codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
							// modelDimension not set initially
						}
					}
					return undefined
				})
				setupSecretMocks({
					codebaseIndexOpenAiCompatibleApiKey: "test-api-key",
					codeIndexQdrantApiKey: "test-key",
				})

				await configManager.loadConfiguration()

				// Add modelDimension
				mockContextProxy.getGlobalState.mockImplementation((key: string) => {
					if (key === "codebaseIndexConfig") {
						return {
							codebaseIndexEnabled: true,
							codebaseIndexQdrantUrl: "http://qdrant.local",
							codebaseIndexEmbedderProvider: "openai-compatible",
							codebaseIndexEmbedderModelId: "custom-model",
							codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
							codebaseIndexEmbedderModelDimension: 1024,
						}
					}
					return undefined
				})

				const result = await configManager.loadConfiguration()
				expect(result.requiresRestart).toBe(true)
			})

			it("should require restart when modelDimension is removed", async () => {
				// Initial state with modelDimension
				mockContextProxy.getGlobalState.mockImplementation((key: string) => {
					if (key === "codebaseIndexConfig") {
						return {
							codebaseIndexEnabled: true,
							codebaseIndexQdrantUrl: "http://qdrant.local",
							codebaseIndexEmbedderProvider: "openai-compatible",
							codebaseIndexEmbedderModelId: "custom-model",
							codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
							codebaseIndexEmbedderModelDimension: 1024,
						}
					}
					return undefined
				})
				setupSecretMocks({
					codebaseIndexOpenAiCompatibleApiKey: "test-api-key",
					codeIndexQdrantApiKey: "test-key",
				})

				await configManager.loadConfiguration()

				// Remove modelDimension
				mockContextProxy.getGlobalState.mockImplementation((key: string) => {
					if (key === "codebaseIndexConfig") {
						return {
							codebaseIndexEnabled: true,
							codebaseIndexQdrantUrl: "http://qdrant.local",
							codebaseIndexEmbedderProvider: "openai-compatible",
							codebaseIndexEmbedderModelId: "custom-model",
							codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
							// modelDimension removed
						}
					}
					return undefined
				})

				const result = await configManager.loadConfiguration()
				expect(result.requiresRestart).toBe(true)
			})

			it("should require restart when enabled and provider changes even if unconfigured", async () => {
				// Initial state - enabled but not configured (missing API key)
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
				})
				setupSecretMocks({})

				await configManager.loadConfiguration()

				// Still enabled but change provider while remaining unconfigured
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "ollama",
					codebaseIndexEmbedderBaseUrl: "http://ollama.local",
				})

				const result = await configManager.loadConfiguration()
				// Should require restart because provider changed while enabled
				expect(result.requiresRestart).toBe(true)
			})

			it("should not require restart when unconfigured remains unconfigured", async () => {
				// Initial state - enabled but unconfigured (missing API key)
				mockContextProxy.getGlobalState.mockReturnValue({
					codebaseIndexEnabled: true,
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
				})
				setupSecretMocks({})

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

			describe("currentSearchMinScore priority system", () => {
				it("should return user-configured score when set", async () => {
					mockContextProxy.getGlobalState.mockReturnValue({
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "openai",
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexSearchMinScore: 0.8, // User setting
					})
					mockContextProxy.getSecret.mockImplementation((key: string) => {
						if (key === "codeIndexOpenAiKey") return "test-key"
						return undefined
					})

					await configManager.loadConfiguration()
					expect(configManager.currentSearchMinScore).toBe(0.8)
				})

				it("should fall back to model-specific threshold when user setting is undefined", async () => {
					mockContextProxy.getGlobalState.mockReturnValue({
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "ollama",
						codebaseIndexEmbedderModelId: "nomic-embed-code",
						// No codebaseIndexSearchMinScore - user hasn't configured it
					})

					await configManager.loadConfiguration()
					// nomic-embed-code has a specific threshold of 0.15
					expect(configManager.currentSearchMinScore).toBe(0.15)
				})

				it("should fall back to default DEFAULT_SEARCH_MIN_SCORE when neither user setting nor model threshold exists", async () => {
					mockContextProxy.getGlobalState.mockReturnValue({
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "openai",
						codebaseIndexEmbedderModelId: "unknown-model", // Model not in profiles
						// No codebaseIndexSearchMinScore
					})
					mockContextProxy.getSecret.mockImplementation((key: string) => {
						if (key === "codeIndexOpenAiKey") return "test-key"
						return undefined
					})

					await configManager.loadConfiguration()
					// Should fall back to default DEFAULT_SEARCH_MIN_SCORE (0.4)
					expect(configManager.currentSearchMinScore).toBe(0.4)
				})

				it("should respect user setting of 0 (edge case)", async () => {
					mockContextProxy.getGlobalState.mockReturnValue({
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "ollama",
						codebaseIndexEmbedderModelId: "nomic-embed-code",
						codebaseIndexSearchMinScore: 0, // User explicitly sets 0
					})

					await configManager.loadConfiguration()
					// Should return 0, not fall back to model threshold (0.15)
					expect(configManager.currentSearchMinScore).toBe(0)
				})

				it("should use model-specific threshold with openai-compatible provider", async () => {
					mockContextProxy.getGlobalState.mockImplementation((key: string) => {
						if (key === "codebaseIndexConfig") {
							return {
								codebaseIndexEnabled: true,
								codebaseIndexQdrantUrl: "http://qdrant.local",
								codebaseIndexEmbedderProvider: "openai-compatible",
								codebaseIndexEmbedderModelId: "nomic-embed-code",
								codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
								// No codebaseIndexSearchMinScore
							}
						}
						return undefined
					})
					mockContextProxy.getSecret.mockImplementation((key: string) => {
						if (key === "codebaseIndexOpenAiCompatibleApiKey") return "test-api-key"
						return undefined
					})

					await configManager.loadConfiguration()
					// openai-compatible provider also has nomic-embed-code with 0.15 threshold
					expect(configManager.currentSearchMinScore).toBe(0.15)
				})

				it("should use default model ID when modelId is not specified", async () => {
					mockContextProxy.getGlobalState.mockReturnValue({
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "openai",
						// No modelId specified
						// No codebaseIndexSearchMinScore
					})
					mockContextProxy.getSecret.mockImplementation((key: string) => {
						if (key === "codeIndexOpenAiKey") return "test-key"
						return undefined
					})

					await configManager.loadConfiguration()
					// Should use default model (text-embedding-3-small) threshold (0.4)
					expect(configManager.currentSearchMinScore).toBe(0.4)
				})

				it("should handle priority correctly: user > model > default", async () => {
					// Test 1: User setting takes precedence
					mockContextProxy.getGlobalState.mockReturnValue({
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "ollama",
						codebaseIndexEmbedderModelId: "nomic-embed-code", // Has 0.15 threshold
						codebaseIndexSearchMinScore: 0.9, // User overrides
					})

					await configManager.loadConfiguration()
					expect(configManager.currentSearchMinScore).toBe(0.9) // User setting wins

					// Test 2: Model threshold when no user setting
					mockContextProxy.getGlobalState.mockReturnValue({
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "ollama",
						codebaseIndexEmbedderModelId: "nomic-embed-code",
						// No user setting
					})

					const newManager = new CodeIndexConfigManager(mockContextProxy)
					await newManager.loadConfiguration()
					expect(newManager.currentSearchMinScore).toBe(0.15) // Model threshold

					// Test 3: Default when neither exists
					mockContextProxy.getGlobalState.mockReturnValue({
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "openai",
						codebaseIndexEmbedderModelId: "custom-unknown-model",
						// No user setting, unknown model
					})

					const anotherManager = new CodeIndexConfigManager(mockContextProxy)
					await anotherManager.loadConfiguration()
					expect(anotherManager.currentSearchMinScore).toBe(0.4) // Default
				})
			})

			describe("currentSearchMaxResults", () => {
				it("should return user setting when provided, otherwise default", async () => {
					// Test 1: User setting takes precedence
					mockContextProxy.getGlobalState.mockReturnValue({
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "openai",
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexSearchMaxResults: 150, // User setting
					})

					await configManager.loadConfiguration()
					expect(configManager.currentSearchMaxResults).toBe(150) // User setting

					// Test 2: Default when no user setting
					mockContextProxy.getGlobalState.mockReturnValue({
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "openai",
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						// No user setting
					})

					const newManager = new CodeIndexConfigManager(mockContextProxy)
					await newManager.loadConfiguration()
					expect(newManager.currentSearchMaxResults).toBe(50) // Default (DEFAULT_MAX_SEARCH_RESULTS)

					// Test 3: Boundary values
					mockContextProxy.getGlobalState.mockReturnValue({
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "openai",
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexSearchMaxResults: 10, // Minimum allowed
					})

					const minManager = new CodeIndexConfigManager(mockContextProxy)
					await minManager.loadConfiguration()
					expect(minManager.currentSearchMaxResults).toBe(10)

					// Test 4: Maximum value
					mockContextProxy.getGlobalState.mockReturnValue({
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "openai",
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexSearchMaxResults: 200, // Maximum allowed
					})

					const maxManager = new CodeIndexConfigManager(mockContextProxy)
					await maxManager.loadConfiguration()
					expect(maxManager.currentSearchMaxResults).toBe(200)
				})
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
				setupSecretMocks({})

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
					codebaseIndexEnabled: true, // Always enabled now
					codebaseIndexQdrantUrl: "http://qdrant.local",
					codebaseIndexEmbedderProvider: "openai",
				})
				setupSecretMocks({})

				await configManager.loadConfiguration()

				// Change to empty string API keys (simulating what happens when secrets return "")
				setupSecretMocks({
					codeIndexOpenAiKey: "",
					codeIndexQdrantApiKey: "",
				})

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
				setupSecretMocks({
					codeIndexOpenAiKey: "",
					codeIndexQdrantApiKey: "",
				})

				await configManager.loadConfiguration()

				// Add actual API key
				setupSecretMocks({
					codeIndexOpenAiKey: "actual-api-key",
					codeIndexQdrantApiKey: "",
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
				setupSecretMocks({
					codeIndexOpenAiKey: "test-key",
					codeIndexQdrantApiKey: "test-key",
				})

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
			setupSecretMocks({
				codeIndexOpenAiKey: "test-key",
				codeIndexQdrantApiKey: "test-key",
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

		it("should validate OpenAI Compatible configuration correctly", async () => {
			mockContextProxy.getGlobalState.mockImplementation((key: string) => {
				if (key === "codebaseIndexConfig") {
					return {
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "openai-compatible",
						codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
					}
				}
				return undefined
			})
			setupSecretMocks({
				codebaseIndexOpenAiCompatibleApiKey: "test-api-key",
				codeIndexQdrantApiKey: "test-key",
			})

			await configManager.loadConfiguration()
			expect(configManager.isFeatureConfigured).toBe(true)
		})

		it("should return false when OpenAI Compatible base URL is missing", async () => {
			mockContextProxy.getGlobalState.mockImplementation((key: string) => {
				if (key === "codebaseIndexConfig") {
					return {
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "openai-compatible",
					}
				}
				if (key === "codebaseIndexOpenAiCompatibleBaseUrl") return ""
				return undefined
			})
			setupSecretMocks({
				codebaseIndexOpenAiCompatibleApiKey: "test-api-key",
			})

			await configManager.loadConfiguration()
			expect(configManager.isFeatureConfigured).toBe(false)
		})

		it("should return false when OpenAI Compatible API key is missing", async () => {
			mockContextProxy.getGlobalState.mockImplementation((key: string) => {
				if (key === "codebaseIndexConfig") {
					return {
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "openai-compatible",
					}
				}
				if (key === "codebaseIndexOpenAiCompatibleBaseUrl") return "https://api.example.com/v1"
				return undefined
			})
			setupSecretMocks({
				codebaseIndexOpenAiCompatibleApiKey: "",
			})

			await configManager.loadConfiguration()
			expect(configManager.isFeatureConfigured).toBe(false)
		})

		it("should validate Gemini configuration correctly", async () => {
			mockContextProxy.getGlobalState.mockImplementation((key: string) => {
				if (key === "codebaseIndexConfig") {
					return {
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "gemini",
					}
				}
				return undefined
			})
			mockContextProxy.getSecret.mockImplementation((key: string) => {
				if (key === "codebaseIndexGeminiApiKey") return "test-gemini-key"
				return undefined
			})

			await configManager.loadConfiguration()
			expect(configManager.isFeatureConfigured).toBe(true)
		})

		it("should return false when Gemini API key is missing", async () => {
			mockContextProxy.getGlobalState.mockImplementation((key: string) => {
				if (key === "codebaseIndexConfig") {
					return {
						codebaseIndexEnabled: true,
						codebaseIndexQdrantUrl: "http://qdrant.local",
						codebaseIndexEmbedderProvider: "gemini",
					}
				}
				return undefined
			})
			mockContextProxy.getSecret.mockImplementation((key: string) => {
				if (key === "codebaseIndexGeminiApiKey") return ""
				return undefined
			})

			await configManager.loadConfiguration()
			expect(configManager.isFeatureConfigured).toBe(false)
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
			setupSecretMocks({
				codeIndexOpenAiKey: "test-openai-key",
				codeIndexQdrantApiKey: "test-qdrant-key",
			})

			await configManager.loadConfiguration()
		})

		it("should return correct configuration via getConfig", () => {
			const config = configManager.getConfig()
			expect(config).toEqual({
				isConfigured: true,
				embedderProvider: "openai",
				modelId: "text-embedding-3-large",
				openAiOptions: { openAiNativeApiKey: "test-openai-key" },
				ollamaOptions: { ollamaBaseUrl: undefined },
				geminiOptions: undefined,
				openAiCompatibleOptions: undefined,
				qdrantUrl: "http://qdrant.local",
				qdrantApiKey: "test-qdrant-key",
				searchMinScore: 0.4,
				searchMaxResults: 50,
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
			setupSecretMocks({
				codeIndexOpenAiKey: "test-key",
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
				codebaseIndexEnabled: true, // Always enabled now
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-small",
			})
			setupSecretMocks({
				codeIndexOpenAiKey: "test-key",
			})

			// Create a new config manager (simulating what happens in CodeIndexManager.initialize)
			const newConfigManager = new CodeIndexConfigManager(mockContextProxy)

			// Load configuration - should not require restart since the manager should be initialized with current config
			const result = await newConfigManager.loadConfiguration()
			expect(result.requiresRestart).toBe(false)
		})

		it("should not require restart when settings are saved but code indexing config unchanged", async () => {
			// This test simulates the scenario where handleSettingsChange() is called
			// but code indexing settings haven't actually changed

			// Setup initial state - enabled and configured
			mockContextProxy.getGlobalState.mockReturnValue({
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant.local",
				codebaseIndexEmbedderProvider: "openai",
				codebaseIndexEmbedderModelId: "text-embedding-3-small",
			})
			setupSecretMocks({
				codeIndexOpenAiKey: "test-key",
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
