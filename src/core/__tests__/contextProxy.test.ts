import * as vscode from "vscode"
import { ContextProxy } from "../contextProxy"
import { logger } from "../../utils/logging"
import { GLOBAL_STATE_KEYS, SECRET_KEYS } from "../../shared/globalState"

// Mock shared/globalState
jest.mock("../../shared/globalState", () => ({
	GLOBAL_STATE_KEYS: ["apiProvider", "apiModelId", "mode"],
	SECRET_KEYS: ["apiKey", "openAiApiKey"],
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
	})

	describe("setValue", () => {
		it("should route secret keys to storeSecret", async () => {
			// Spy on storeSecret
			const storeSecretSpy = jest.spyOn(proxy, "storeSecret")

			// Test with a known secret key
			await proxy.setValue("openAiApiKey", "test-api-key")

			// Should have called storeSecret
			expect(storeSecretSpy).toHaveBeenCalledWith("openAiApiKey", "test-api-key")

			// Should have stored the value in secret cache
			const storedValue = proxy.getSecret("openAiApiKey")
			expect(storedValue).toBe("test-api-key")
		})

		it("should route global state keys to updateGlobalState", async () => {
			// Spy on updateGlobalState
			const updateGlobalStateSpy = jest.spyOn(proxy, "updateGlobalState")

			// Test with a known global state key
			await proxy.setValue("apiModelId", "gpt-4")

			// Should have called updateGlobalState
			expect(updateGlobalStateSpy).toHaveBeenCalledWith("apiModelId", "gpt-4")

			// Should have stored the value in state cache
			const storedValue = proxy.getGlobalState("apiModelId")
			expect(storedValue).toBe("gpt-4")
		})

		it("should handle unknown keys as global state with warning", async () => {
			// Spy on the logger
			const warnSpy = jest.spyOn(logger, "warn")

			// Spy on updateGlobalState
			const updateGlobalStateSpy = jest.spyOn(proxy, "updateGlobalState")

			// Test with an unknown key
			await proxy.setValue("unknownKey", "some-value")

			// Should have logged a warning
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown key: unknownKey"))

			// Should have called updateGlobalState
			expect(updateGlobalStateSpy).toHaveBeenCalledWith("unknownKey", "some-value")

			// Should have stored the value in state cache
			const storedValue = proxy.getGlobalState("unknownKey")
			expect(storedValue).toBe("some-value")
		})
	})

	describe("setValues", () => {
		it("should process multiple values correctly", async () => {
			// Spy on setValue
			const setValueSpy = jest.spyOn(proxy, "setValue")

			// Test with multiple values
			await proxy.setValues({
				apiModelId: "gpt-4",
				apiProvider: "openai",
				mode: "test-mode",
			})

			// Should have called setValue for each key
			expect(setValueSpy).toHaveBeenCalledTimes(3)
			expect(setValueSpy).toHaveBeenCalledWith("apiModelId", "gpt-4")
			expect(setValueSpy).toHaveBeenCalledWith("apiProvider", "openai")
			expect(setValueSpy).toHaveBeenCalledWith("mode", "test-mode")

			// Should have stored all values in state cache
			expect(proxy.getGlobalState("apiModelId")).toBe("gpt-4")
			expect(proxy.getGlobalState("apiProvider")).toBe("openai")
			expect(proxy.getGlobalState("mode")).toBe("test-mode")
		})

		it("should handle both secret and global state keys", async () => {
			// Spy on storeSecret and updateGlobalState
			const storeSecretSpy = jest.spyOn(proxy, "storeSecret")
			const updateGlobalStateSpy = jest.spyOn(proxy, "updateGlobalState")

			// Test with mixed keys
			await proxy.setValues({
				apiModelId: "gpt-4", // global state
				openAiApiKey: "test-api-key", // secret
				unknownKey: "some-value", // unknown
			})

			// Should have called appropriate methods
			expect(storeSecretSpy).toHaveBeenCalledWith("openAiApiKey", "test-api-key")
			expect(updateGlobalStateSpy).toHaveBeenCalledWith("apiModelId", "gpt-4")
			expect(updateGlobalStateSpy).toHaveBeenCalledWith("unknownKey", "some-value")

			// Should have stored values in appropriate caches
			expect(proxy.getSecret("openAiApiKey")).toBe("test-api-key")
			expect(proxy.getGlobalState("apiModelId")).toBe("gpt-4")
			expect(proxy.getGlobalState("unknownKey")).toBe("some-value")
		})
	})

	describe("resetAllState", () => {
		it("should clear all in-memory caches", async () => {
			// Setup initial state in caches
			await proxy.setValues({
				apiModelId: "gpt-4", // global state
				openAiApiKey: "test-api-key", // secret
				unknownKey: "some-value", // unknown
			})

			// Verify initial state
			expect(proxy.getGlobalState("apiModelId")).toBe("gpt-4")
			expect(proxy.getSecret("openAiApiKey")).toBe("test-api-key")
			expect(proxy.getGlobalState("unknownKey")).toBe("some-value")

			// Reset all state
			await proxy.resetAllState()

			// Caches should be reinitialized with values from the context
			// Since our mock globalState.get returns undefined by default,
			// the cache should now contain undefined values
			expect(proxy.getGlobalState("apiModelId")).toBeUndefined()
			expect(proxy.getGlobalState("unknownKey")).toBeUndefined()
		})

		it("should update all global state keys to undefined", async () => {
			// Setup initial state
			await proxy.updateGlobalState("apiModelId", "gpt-4")
			await proxy.updateGlobalState("apiProvider", "openai")

			// Reset all state
			await proxy.resetAllState()

			// Should have called update with undefined for each key
			for (const key of GLOBAL_STATE_KEYS) {
				expect(mockGlobalState.update).toHaveBeenCalledWith(key, undefined)
			}

			// Total calls should include initial setup + reset operations
			const expectedUpdateCalls = 2 + GLOBAL_STATE_KEYS.length
			expect(mockGlobalState.update).toHaveBeenCalledTimes(expectedUpdateCalls)
		})

		it("should delete all secrets", async () => {
			// Setup initial secrets
			await proxy.storeSecret("apiKey", "test-api-key")
			await proxy.storeSecret("openAiApiKey", "test-openai-key")

			// Reset all state
			await proxy.resetAllState()

			// Should have called delete for each key
			for (const key of SECRET_KEYS) {
				expect(mockSecrets.delete).toHaveBeenCalledWith(key)
			}

			// Total calls should equal the number of secret keys
			expect(mockSecrets.delete).toHaveBeenCalledTimes(SECRET_KEYS.length)
		})

		it("should reinitialize caches after reset", async () => {
			// Spy on initialization methods
			const initStateCache = jest.spyOn(proxy as any, "initializeStateCache")
			const initSecretCache = jest.spyOn(proxy as any, "initializeSecretCache")

			// Reset all state
			await proxy.resetAllState()

			// Should reinitialize caches
			expect(initStateCache).toHaveBeenCalledTimes(1)
			expect(initSecretCache).toHaveBeenCalledTimes(1)
		})
	})
})
