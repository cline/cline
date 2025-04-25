import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { fileExistsAtPath } from "../utils/fs"
import { GlobalFileNames } from "../shared/globalFileNames"
import { migrateSettings } from "../utils/migrateSettings"

// Mock dependencies
jest.mock("vscode")
jest.mock("fs/promises")
jest.mock("fs")
jest.mock("../utils/fs")

describe("Settings Migration", () => {
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	const mockStoragePath = "/mock/storage"
	const mockSettingsDir = path.join(mockStoragePath, "settings")

	// Legacy file names
	const legacyCustomModesPath = path.join(mockSettingsDir, "cline_custom_modes.json")
	const legacyMcpSettingsPath = path.join(mockSettingsDir, "cline_mcp_settings.json")

	// New file names
	const newCustomModesPath = path.join(mockSettingsDir, GlobalFileNames.customModes)
	const newMcpSettingsPath = path.join(mockSettingsDir, GlobalFileNames.mcpSettings)

	beforeEach(() => {
		jest.clearAllMocks()

		// Mock output channel
		mockOutputChannel = {
			appendLine: jest.fn(),
			append: jest.fn(),
			clear: jest.fn(),
			show: jest.fn(),
			hide: jest.fn(),
			dispose: jest.fn(),
		} as unknown as vscode.OutputChannel

		// Mock extension context
		mockContext = {
			globalStorageUri: { fsPath: mockStoragePath },
		} as unknown as vscode.ExtensionContext

		// The fs/promises mock is already set up in src/__mocks__/fs/promises.ts
		// We don't need to manually mock these methods

		// Set global outputChannel for all tests
		;(global as any).outputChannel = mockOutputChannel
	})

	it("should migrate custom modes file if old file exists and new file doesn't", async () => {
		// Mock file existence checks
		;(fileExistsAtPath as jest.Mock).mockImplementation(async (path: string) => {
			if (path === mockSettingsDir) return true
			if (path === legacyCustomModesPath) return true
			if (path === newCustomModesPath) return false
			return false
		})

		await migrateSettings(mockContext, mockOutputChannel)

		// Verify file was renamed
		expect(fs.rename).toHaveBeenCalledWith(legacyCustomModesPath, newCustomModesPath)
	})

	it("should migrate MCP settings file if old file exists and new file doesn't", async () => {
		// Mock file existence checks
		;(fileExistsAtPath as jest.Mock).mockImplementation(async (path: string) => {
			if (path === mockSettingsDir) return true
			if (path === legacyMcpSettingsPath) return true
			if (path === newMcpSettingsPath) return false
			return false
		})

		await migrateSettings(mockContext, mockOutputChannel)

		// Verify file was renamed
		expect(fs.rename).toHaveBeenCalledWith(legacyMcpSettingsPath, newMcpSettingsPath)
	})

	it("should not migrate if new file already exists", async () => {
		// Mock file existence checks
		;(fileExistsAtPath as jest.Mock).mockImplementation(async (path: string) => {
			if (path === mockSettingsDir) return true
			if (path === legacyCustomModesPath) return true
			if (path === newCustomModesPath) return true
			if (path === legacyMcpSettingsPath) return true
			if (path === newMcpSettingsPath) return true
			return false
		})

		await migrateSettings(mockContext, mockOutputChannel)

		// Verify no files were renamed
		expect(fs.rename).not.toHaveBeenCalled()
	})

	it("should handle errors gracefully", async () => {
		// Mock file existence checks to throw an error
		;(fileExistsAtPath as jest.Mock).mockRejectedValue(new Error("Test error"))

		// Set the global outputChannel for the test
		;(global as any).outputChannel = mockOutputChannel

		await migrateSettings(mockContext, mockOutputChannel)

		// Verify error was logged
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringContaining("Error migrating settings files"),
		)
	})
})
