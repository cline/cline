import * as vscode from "vscode"
import { ContextProxy } from "../contextProxy"
import { logger } from "../../utils/logging"
import { GLOBAL_STATE_KEYS, SECRET_KEYS } from "../../shared/globalState"
import { ApiConfiguration } from "../../shared/api"

// Mock shared/globalState
jest.mock("../../shared/globalState", () => ({
	GLOBAL_STATE_KEYS: ["apiProvider", "apiModelId", "mode"],
	SECRET_KEYS: ["apiKey", "openAiApiKey"],
	GlobalStateKey: {},
	SecretKey: {},
}))

// Mock shared/api
jest.mock("../../shared/api", () => ({
	API_CONFIG_KEYS: ["apiProvider", "apiModelId"],
	ApiConfiguration: {},
}))

// Mock VSCode API
jest.mock("vscode", () => ({
	Uri: {
		file: jest.fn((path) => ({ path })),
	},
	ExtensionMode: {
		Development: 1,
		Production: 2,
		Test: 3,
	},
}))

describe("ContextProxy", () => {
	let proxy: ContextProxy
	let mockContext: any
	let mockGlobalState: any
	let mockSecrets: any

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Mock globalState
		mockGlobalState = {
			get: jest.fn(),
			update: jest.fn().mockResolvedValue(undefined),
		}

		// Mock secrets
		mockSecrets = {
			get: jest.fn().mockResolvedValue("test-secret"),
			store: jest.fn().mockResolvedValue(undefined),
			delete: jest.fn().mockResolvedValue(undefined),
		}

		// Mock the extension context
		mockContext = {
			globalState: mockGlobalState,
			secrets: mockSecrets,
			extensionUri: { path: "/test/extension" },
			extensionPath: "/test/extension",
			globalStorageUri: { path: "/test/storage" },
			logUri: { path: "/test/logs" },
			extension: { packageJSON: { version: "1.0.0" } },
			extensionMode: vscode.ExtensionMode.Development,
		}

		// Create proxy instance
		proxy = new ContextProxy(mockContext)
	})

	describe("read-only pass-through properties", () => {
		it("should return extension properties from the original context", () => {
			expect(proxy.extensionUri).toBe(mockContext.extensionUri)
			expect(proxy.extensionPath).toBe(mockContext.extensionPath)
			expect(proxy.globalStorageUri).toBe(mockContext.globalStorageUri)
			expect(proxy.logUri).toBe(mockContext.logUri)
			expect(proxy.extension).toBe(mockContext.extension)
			expect(proxy.extensionMode).toBe(mockContext.extensionMode)
		})
	})

	describe("constructor", () => {
		it("should initialize state cache with all global state keys", () => {
			expect(mockGlobalState.get).toHaveBeenCalledTimes(GLOBAL_STATE_KEYS.length)
			for (const key of GLOBAL_STATE_KEYS) {
				expect(mockGlobalState.get).toHaveBeenCalledWith(key)
			}
		})

		it("should initialize secret cache with all secret keys", () => {
			expect(mockSecrets.get).toHaveBeenCalledTimes(SECRET_KEYS.length)
			for (const key of SECRET_KEYS) {
				expect(mockSecrets.get).toHaveBeenCalledWith(key)
			}
		})
	})

	describe("getGlobalState", () => {
		it("should return value from cache when it exists", async () => {
			// Manually set a value in the cache
			await proxy.updateGlobalState("test-key", "cached-value")

			// Should return the cached value
			const result = proxy.getGlobalState("test-key")
			expect(result).toBe("cached-value")

			// Original context should be called once during updateGlobalState
			expect(mockGlobalState.get).toHaveBeenCalledTimes(GLOBAL_STATE_KEYS.length) // Only from initialization
		})

		it("should handle default values correctly", async () => {
			// No value in cache
			const result = proxy.getGlobalState("unknown-key", "default-value")
			expect(result).toBe("default-value")
		})
	})

	describe("updateGlobalState", () => {
		it("should update state directly in original context", async () => {
			await proxy.updateGlobalState("test-key", "new-value")

			// Should have called original context
			expect(mockGlobalState.update).toHaveBeenCalledWith("test-key", "new-value")

			// Should have stored the value in cache
			const storedValue = await proxy.getGlobalState("test-key")
			expect(storedValue).toBe("new-value")
		})
	})

	describe("getSecret", () => {
		it("should return value from cache when it exists", async () => {
			// Manually set a value in the cache
			await proxy.storeSecret("api-key", "cached-secret")

			// Should return the cached value
			const result = proxy.getSecret("api-key")
			expect(result).toBe("cached-secret")
		})
	})

	describe("storeSecret", () => {
		it("should store secret directly in original context", async () => {
			await proxy.storeSecret("api-key", "new-secret")

			// Should have called original context
			expect(mockSecrets.store).toHaveBeenCalledWith("api-key", "new-secret")

			// Should have stored the value in cache
			const storedValue = await proxy.getSecret("api-key")
			expect(storedValue).toBe("new-secret")
		})

		it("should handle undefined value for secret deletion", async () => {
			await proxy.storeSecret("api-key", undefined)

			// Should have called delete on original context
			expect(mockSecrets.delete).toHaveBeenCalledWith("api-key")

			// Should have stored undefined in cache
			const storedValue = await proxy.getSecret("api-key")
			expect(storedValue).toBeUndefined()
		})

		describe("getApiConfiguration", () => {
			it("should combine global state and secrets into a single ApiConfiguration object", async () => {
				// Mock data in state cache
				await proxy.updateGlobalState("apiProvider", "anthropic")
				await proxy.updateGlobalState("apiModelId", "test-model")
				// Mock data in secrets cache
				await proxy.storeSecret("apiKey", "test-api-key")

				const config = proxy.getApiConfiguration()

				// Should contain values from global state
				expect(config.apiProvider).toBe("anthropic")
				expect(config.apiModelId).toBe("test-model")
				// Should contain values from secrets
				expect(config.apiKey).toBe("test-api-key")
			})

			it("should handle special case for apiProvider defaulting", async () => {
				// Clear apiProvider but set apiKey
				await proxy.updateGlobalState("apiProvider", undefined)
				await proxy.storeSecret("apiKey", "test-api-key")

				const config = proxy.getApiConfiguration()

				// Should default to anthropic when apiKey exists
				expect(config.apiProvider).toBe("anthropic")

				// Clear both apiProvider and apiKey
				await proxy.updateGlobalState("apiProvider", undefined)
				await proxy.storeSecret("apiKey", undefined)

				const configWithoutKey = proxy.getApiConfiguration()

				// Should default to openrouter when no apiKey exists
				expect(configWithoutKey.apiProvider).toBe("openrouter")
			})
		})

		describe("updateApiConfiguration", () => {
			it("should update both global state and secrets", async () => {
				const apiConfig: ApiConfiguration = {
					apiProvider: "anthropic",
					apiModelId: "claude-latest",
					apiKey: "test-api-key",
				}

				await proxy.updateApiConfiguration(apiConfig)

				// Should update global state
				expect(mockGlobalState.update).toHaveBeenCalledWith("apiProvider", "anthropic")
				expect(mockGlobalState.update).toHaveBeenCalledWith("apiModelId", "claude-latest")
				// Should update secrets
				expect(mockSecrets.store).toHaveBeenCalledWith("apiKey", "test-api-key")

				// Check that values are in cache
				expect(proxy.getGlobalState("apiProvider")).toBe("anthropic")
				expect(proxy.getGlobalState("apiModelId")).toBe("claude-latest")
				expect(proxy.getSecret("apiKey")).toBe("test-api-key")
			})

			it("should ignore keys that aren't in either GLOBAL_STATE_KEYS or SECRET_KEYS", async () => {
				// Use type assertion to add an invalid key
				const apiConfig = {
					apiProvider: "anthropic",
					invalidKey: "should be ignored",
				} as ApiConfiguration & { invalidKey: string }

				await proxy.updateApiConfiguration(apiConfig)

				// Should update keys in GLOBAL_STATE_KEYS
				expect(mockGlobalState.update).toHaveBeenCalledWith("apiProvider", "anthropic")
				// Should not call update/store for invalid keys
				expect(mockGlobalState.update).not.toHaveBeenCalledWith("invalidKey", expect.anything())
				expect(mockSecrets.store).not.toHaveBeenCalledWith("invalidKey", expect.anything())
			})
		})
	})
})
