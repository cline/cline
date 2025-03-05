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
})
