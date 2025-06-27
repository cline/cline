import { CodeIndexManager } from "../manager"

// Mock only the essential dependencies
vitest.mock("../../../utils/path", () => ({
	getWorkspacePath: vitest.fn(() => "/test/workspace"),
}))

vitest.mock("../state-manager", () => ({
	CodeIndexStateManager: vitest.fn().mockImplementation(() => ({
		onProgressUpdate: vitest.fn(),
		getCurrentStatus: vitest.fn(),
		dispose: vitest.fn(),
	})),
}))

describe("CodeIndexManager - handleExternalSettingsChange regression", () => {
	let mockContext: any
	let manager: CodeIndexManager

	beforeEach(() => {
		// Clear all instances before each test
		CodeIndexManager.disposeAll()

		mockContext = {
			subscriptions: [],
			workspaceState: {} as any,
			globalState: {} as any,
			extensionUri: {} as any,
			extensionPath: "/test/extension",
			asAbsolutePath: vitest.fn(),
			storageUri: {} as any,
			storagePath: "/test/storage",
			globalStorageUri: {} as any,
			globalStoragePath: "/test/global-storage",
			logUri: {} as any,
			logPath: "/test/log",
			extensionMode: 3, // vscode.ExtensionMode.Test
			secrets: {} as any,
			environmentVariableCollection: {} as any,
			extension: {} as any,
			languageModelAccessInformation: {} as any,
		}

		manager = CodeIndexManager.getInstance(mockContext)!
	})

	afterEach(() => {
		CodeIndexManager.disposeAll()
	})

	describe("handleExternalSettingsChange", () => {
		it("should not throw when called on uninitialized manager (regression test)", async () => {
			// This is the core regression test: handleExternalSettingsChange() should not throw
			// when called before the manager is initialized (during first-time configuration)

			// Ensure manager is not initialized
			expect(manager.isInitialized).toBe(false)

			// Mock a minimal config manager that simulates first-time configuration
			const mockConfigManager = {
				loadConfiguration: vitest.fn().mockResolvedValue({ requiresRestart: true }),
			}
			;(manager as any)._configManager = mockConfigManager

			// Mock the feature state to simulate valid configuration that would normally trigger restart
			vitest.spyOn(manager, "isFeatureEnabled", "get").mockReturnValue(true)
			vitest.spyOn(manager, "isFeatureConfigured", "get").mockReturnValue(true)

			// The key test: this should NOT throw "CodeIndexManager not initialized" error
			await expect(manager.handleExternalSettingsChange()).resolves.not.toThrow()

			// Verify that loadConfiguration was called (the method should still work)
			expect(mockConfigManager.loadConfiguration).toHaveBeenCalled()
		})

		it("should work normally when manager is initialized", async () => {
			// Mock a minimal config manager
			const mockConfigManager = {
				loadConfiguration: vitest.fn().mockResolvedValue({ requiresRestart: true }),
			}
			;(manager as any)._configManager = mockConfigManager

			// Simulate an initialized manager by setting the required properties
			;(manager as any)._orchestrator = { stopWatcher: vitest.fn() }
			;(manager as any)._searchService = {}
			;(manager as any)._cacheManager = {}

			// Verify manager is considered initialized
			expect(manager.isInitialized).toBe(true)

			// Mock the methods that would be called during restart
			const recreateServicesSpy = vitest.spyOn(manager as any, "_recreateServices").mockImplementation(() => {})
			const startIndexingSpy = vitest.spyOn(manager, "startIndexing").mockResolvedValue()

			// Mock the feature state
			vitest.spyOn(manager, "isFeatureEnabled", "get").mockReturnValue(true)
			vitest.spyOn(manager, "isFeatureConfigured", "get").mockReturnValue(true)

			await manager.handleExternalSettingsChange()

			// Verify that the restart sequence was called
			expect(mockConfigManager.loadConfiguration).toHaveBeenCalled()
			expect(recreateServicesSpy).toHaveBeenCalled()
			expect(startIndexingSpy).toHaveBeenCalled()
		})

		it("should handle case when config manager is not set", async () => {
			// Ensure config manager is not set (edge case)
			;(manager as any)._configManager = undefined

			// This should not throw an error
			await expect(manager.handleExternalSettingsChange()).resolves.not.toThrow()
		})
	})
})
