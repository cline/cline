import * as vscode from "vscode"
import { ContextProxy } from "../contextProxy"
import { logger } from "../../utils/logging"

// Mock the logger
jest.mock("../../utils/logging", () => ({
	logger: {
		debug: jest.fn(),
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
	},
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
			get: jest.fn(),
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

	describe("getGlobalState", () => {
		it("should return pending change when it exists", async () => {
			// Set up a pending change
			await proxy.updateGlobalState("test-key", "new-value")

			// Should return the pending value
			const result = await proxy.getGlobalState("test-key")
			expect(result).toBe("new-value")

			// Original context should not be called
			expect(mockGlobalState.get).not.toHaveBeenCalled()
		})

		it("should fall back to original context when no pending change exists", async () => {
			// Set up original context value
			mockGlobalState.get.mockReturnValue("original-value")

			// Should get from original context
			const result = await proxy.getGlobalState("test-key")
			expect(result).toBe("original-value")
			expect(mockGlobalState.get).toHaveBeenCalledWith("test-key", undefined)
		})

		it("should handle default values correctly", async () => {
			// No value in either pending or original
			mockGlobalState.get.mockImplementation((key: string, defaultValue: any) => defaultValue)

			// Should return the default value
			const result = await proxy.getGlobalState("test-key", "default-value")
			expect(result).toBe("default-value")
		})
	})

	describe("updateGlobalState", () => {
		it("should buffer changes without calling original context", async () => {
			await proxy.updateGlobalState("test-key", "new-value")

			// Should have called logger.debug
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("buffering state update"))

			// Should not have called original context
			expect(mockGlobalState.update).not.toHaveBeenCalled()

			// Should have stored the value in pendingStateChanges
			const storedValue = await proxy.getGlobalState("test-key")
			expect(storedValue).toBe("new-value")
		})

		it("should throw an error when context is disposed", async () => {
			await proxy.dispose()

			await expect(proxy.updateGlobalState("test-key", "new-value")).rejects.toThrow(
				"Cannot update state on disposed context",
			)
		})
	})

	describe("getSecret", () => {
		it("should return pending secret when it exists", async () => {
			// Set up a pending secret
			await proxy.storeSecret("api-key", "secret123")

			// Should return the pending value
			const result = await proxy.getSecret("api-key")
			expect(result).toBe("secret123")

			// Original context should not be called
			expect(mockSecrets.get).not.toHaveBeenCalled()
		})

		it("should fall back to original context when no pending secret exists", async () => {
			// Set up original context value
			mockSecrets.get.mockResolvedValue("original-secret")

			// Should get from original context
			const result = await proxy.getSecret("api-key")
			expect(result).toBe("original-secret")
			expect(mockSecrets.get).toHaveBeenCalledWith("api-key")
		})
	})

	describe("storeSecret", () => {
		it("should buffer secret changes without calling original context", async () => {
			await proxy.storeSecret("api-key", "new-secret")

			// Should have called logger.debug
			expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("buffering secret update"))

			// Should not have called original context
			expect(mockSecrets.store).not.toHaveBeenCalled()

			// Should have stored the value in pendingSecretChanges
			const storedValue = await proxy.getSecret("api-key")
			expect(storedValue).toBe("new-secret")
		})

		it("should handle undefined value for secret deletion", async () => {
			await proxy.storeSecret("api-key", undefined)

			// Should have stored undefined in pendingSecretChanges
			const storedValue = await proxy.getSecret("api-key")
			expect(storedValue).toBeUndefined()
		})

		it("should throw an error when context is disposed", async () => {
			await proxy.dispose()

			await expect(proxy.storeSecret("api-key", "new-secret")).rejects.toThrow(
				"Cannot store secret on disposed context",
			)
		})
	})

	describe("saveChanges", () => {
		it("should apply state changes to original context", async () => {
			// Set up pending changes
			await proxy.updateGlobalState("key1", "value1")
			await proxy.updateGlobalState("key2", "value2")

			// Save changes
			await proxy.saveChanges()

			// Should have called update on original context
			expect(mockGlobalState.update).toHaveBeenCalledTimes(2)
			expect(mockGlobalState.update).toHaveBeenCalledWith("key1", "value1")
			expect(mockGlobalState.update).toHaveBeenCalledWith("key2", "value2")

			// Should have cleared pending changes
			expect(proxy.hasPendingChanges()).toBe(false)
		})

		it("should apply secret changes to original context", async () => {
			// Set up pending changes
			await proxy.storeSecret("secret1", "value1")
			await proxy.storeSecret("secret2", undefined)

			// Save changes
			await proxy.saveChanges()

			// Should have called store and delete on original context
			expect(mockSecrets.store).toHaveBeenCalledTimes(1)
			expect(mockSecrets.store).toHaveBeenCalledWith("secret1", "value1")
			expect(mockSecrets.delete).toHaveBeenCalledTimes(1)
			expect(mockSecrets.delete).toHaveBeenCalledWith("secret2")

			// Should have cleared pending changes
			expect(proxy.hasPendingChanges()).toBe(false)
		})

		it("should do nothing when there are no pending changes", async () => {
			await proxy.saveChanges()

			expect(mockGlobalState.update).not.toHaveBeenCalled()
			expect(mockSecrets.store).not.toHaveBeenCalled()
			expect(mockSecrets.delete).not.toHaveBeenCalled()
		})

		it("should throw an error when context is disposed", async () => {
			await proxy.dispose()

			await expect(proxy.saveChanges()).rejects.toThrow("Cannot save changes on disposed context")
		})
	})

	describe("dispose", () => {
		it("should save pending changes to original context", async () => {
			// Set up pending changes
			await proxy.updateGlobalState("key1", "value1")
			await proxy.storeSecret("secret1", "value1")

			// Dispose
			await proxy.dispose()

			// Should have saved changes
			expect(mockGlobalState.update).toHaveBeenCalledWith("key1", "value1")
			expect(mockSecrets.store).toHaveBeenCalledWith("secret1", "value1")

			// Should be marked as disposed
			expect(proxy.hasPendingChanges()).toBe(false)
		})
	})

	describe("hasPendingChanges", () => {
		it("should return false when no changes are pending", () => {
			expect(proxy.hasPendingChanges()).toBe(false)
		})

		it("should return true when state changes are pending", async () => {
			await proxy.updateGlobalState("key", "value")
			expect(proxy.hasPendingChanges()).toBe(true)
		})

		it("should return true when secret changes are pending", async () => {
			await proxy.storeSecret("key", "value")
			expect(proxy.hasPendingChanges()).toBe(true)
		})

		it("should return false after changes are saved", async () => {
			await proxy.updateGlobalState("key", "value")
			expect(proxy.hasPendingChanges()).toBe(true)

			await proxy.saveChanges()
			expect(proxy.hasPendingChanges()).toBe(false)
		})
	})
})
