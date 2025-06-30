import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// Mock dependencies
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(),
	},
	window: {
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
	},
}))

vi.mock("fs/promises", () => ({
	__esModule: true,
	default: {
		readFile: vi.fn(),
	},
	readFile: vi.fn(),
}))

vi.mock("path", () => ({
	join: vi.fn((...args: string[]) => args.join("/")),
	isAbsolute: vi.fn((p: string) => p.startsWith("/")),
	basename: vi.fn((p: string) => p.split("/").pop() || ""),
}))

vi.mock("os", () => ({
	homedir: vi.fn(() => "/home/user"),
}))

vi.mock("../fs", () => ({
	fileExistsAtPath: vi.fn(),
}))

vi.mock("../../core/config/ProviderSettingsManager", async (importOriginal) => {
	const originalModule = await importOriginal()
	return {
		__esModule: true,
		// We need to mock the class constructor and its methods,
		// but keep other exports (like schemas) as their original values.
		...(originalModule || {}), // Spread original exports
		ProviderSettingsManager: vi.fn().mockImplementation(() => ({
			// Mock the class
			export: vi.fn().mockResolvedValue({
				apiConfigs: {},
				modeApiConfigs: {},
				currentApiConfigName: "default",
			}),
			import: vi.fn().mockResolvedValue({ success: true }),
			listConfig: vi.fn().mockResolvedValue([]),
		})),
	}
})
vi.mock("../../core/config/ContextProxy")
vi.mock("../../core/config/CustomModesManager")

import { autoImportSettings } from "../autoImportSettings"
import * as vscode from "vscode"
import fsPromises from "fs/promises"
import { fileExistsAtPath } from "../fs"

describe("autoImportSettings", () => {
	let mockProviderSettingsManager: any
	let mockContextProxy: any
	let mockCustomModesManager: any
	let mockOutputChannel: any
	let mockProvider: any

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Mock output channel
		mockOutputChannel = {
			appendLine: vi.fn(),
		}

		// Mock provider settings manager
		mockProviderSettingsManager = {
			export: vi.fn().mockResolvedValue({
				apiConfigs: {},
				modeApiConfigs: {},
				currentApiConfigName: "default",
			}),
			import: vi.fn().mockResolvedValue({ success: true }),
			listConfig: vi.fn().mockResolvedValue([]),
		}

		// Mock context proxy
		mockContextProxy = {
			setValues: vi.fn().mockResolvedValue(undefined),
			setValue: vi.fn().mockResolvedValue(undefined),
			setProviderSettings: vi.fn().mockResolvedValue(undefined),
		}

		// Mock custom modes manager
		mockCustomModesManager = {
			updateCustomMode: vi.fn().mockResolvedValue(undefined),
		}

		// mockProvider must be initialized AFTER its dependencies
		mockProvider = {
			providerSettingsManager: mockProviderSettingsManager,
			contextProxy: mockContextProxy,
			upsertProviderProfile: vi.fn().mockResolvedValue({ success: true }),
			postStateToWebview: vi.fn().mockResolvedValue({ success: true }),
		}

		// Reset fs mock
		vi.mocked(fsPromises.readFile).mockReset()
		vi.mocked(fileExistsAtPath).mockReset()
		vi.mocked(vscode.workspace.getConfiguration).mockReset()
		vi.mocked(vscode.window.showInformationMessage).mockReset()
		vi.mocked(vscode.window.showWarningMessage).mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should skip auto-import when no settings path is specified", async () => {
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: vi.fn().mockReturnValue(""),
		} as any)

		await autoImportSettings(mockOutputChannel, {
			providerSettingsManager: mockProviderSettingsManager,
			contextProxy: mockContextProxy,
			customModesManager: mockCustomModesManager,
		})

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] No auto-import settings path specified, skipping auto-import",
		)
		expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
	})

	it("should skip auto-import when settings file does not exist", async () => {
		const settingsPath = "~/Documents/roo-config.json"
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: vi.fn().mockReturnValue(settingsPath),
		} as any)

		// Mock fileExistsAtPath to return false
		vi.mocked(fileExistsAtPath).mockResolvedValue(false)

		await autoImportSettings(mockOutputChannel, {
			providerSettingsManager: mockProviderSettingsManager,
			contextProxy: mockContextProxy,
			customModesManager: mockCustomModesManager,
		})

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] Checking for settings file at: /home/user/Documents/roo-config.json",
		)
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] Settings file not found at /home/user/Documents/roo-config.json, skipping auto-import",
		)
		expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
	})

	it("should successfully import settings when file exists and is valid", async () => {
		const settingsPath = "/absolute/path/to/config.json"
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: vi.fn().mockReturnValue(settingsPath),
		} as any)

		// Mock fileExistsAtPath to return true
		vi.mocked(fileExistsAtPath).mockResolvedValue(true)

		// Mock fs.readFile to return valid config
		const mockSettings = {
			providerProfiles: {
				currentApiConfigName: "test-config",
				apiConfigs: {
					"test-config": {
						apiProvider: "anthropic",
						anthropicApiKey: "test-key",
					},
				},
			},
			globalSettings: {
				customInstructions: "Test instructions",
			},
		}

		vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(mockSettings) as any)

		await autoImportSettings(mockOutputChannel, {
			providerSettingsManager: mockProviderSettingsManager,
			contextProxy: mockContextProxy,
			customModesManager: mockCustomModesManager,
		})

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] Checking for settings file at: /absolute/path/to/config.json",
		)
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] Successfully imported settings from /absolute/path/to/config.json",
		)
		expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("info.auto_import_success")
		expect(mockProviderSettingsManager.import).toHaveBeenCalled()
		expect(mockContextProxy.setValues).toHaveBeenCalled()
	})

	it("should handle invalid JSON gracefully", async () => {
		const settingsPath = "~/config.json"
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: vi.fn().mockReturnValue(settingsPath),
		} as any)

		// Mock fileExistsAtPath to return true
		vi.mocked(fileExistsAtPath).mockResolvedValue(true)

		// Mock fs.readFile to return invalid JSON
		vi.mocked(fsPromises.readFile).mockResolvedValue("invalid json" as any)

		await autoImportSettings(mockOutputChannel, {
			providerSettingsManager: mockProviderSettingsManager,
			contextProxy: mockContextProxy,
			customModesManager: mockCustomModesManager,
		})

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringContaining("[AutoImport] Failed to import settings:"),
		)
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			expect.stringContaining("warnings.auto_import_failed"),
		)
		expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
	})

	it("should resolve home directory paths correctly", async () => {
		const settingsPath = "~/Documents/config.json"
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: vi.fn().mockReturnValue(settingsPath),
		} as any)

		// Mock fileExistsAtPath to return false (so we can check the resolved path)
		vi.mocked(fileExistsAtPath).mockResolvedValue(false)

		await autoImportSettings(mockOutputChannel, {
			providerSettingsManager: mockProviderSettingsManager,
			contextProxy: mockContextProxy,
			customModesManager: mockCustomModesManager,
		})

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] Checking for settings file at: /home/user/Documents/config.json",
		)
	})

	it("should handle relative paths by resolving them to home directory", async () => {
		const settingsPath = "Documents/config.json"
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: vi.fn().mockReturnValue(settingsPath),
		} as any)

		// Mock fileExistsAtPath to return false (so we can check the resolved path)
		vi.mocked(fileExistsAtPath).mockResolvedValue(false)

		await autoImportSettings(mockOutputChannel, {
			providerSettingsManager: mockProviderSettingsManager,
			contextProxy: mockContextProxy,
			customModesManager: mockCustomModesManager,
		})

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"[AutoImport] Checking for settings file at: /home/user/Documents/config.json",
		)
	})

	it("should handle file system errors gracefully", async () => {
		const settingsPath = "~/config.json"
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
			get: vi.fn().mockReturnValue(settingsPath),
		} as any)

		// Mock fileExistsAtPath to throw an error
		vi.mocked(fileExistsAtPath).mockRejectedValue(new Error("File system error"))

		await autoImportSettings(mockOutputChannel, {
			providerSettingsManager: mockProviderSettingsManager,
			contextProxy: mockContextProxy,
			customModesManager: mockCustomModesManager,
		})

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringContaining("[AutoImport] Unexpected error during auto-import:"),
		)
		expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
	})
})
