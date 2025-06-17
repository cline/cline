import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { fileExistsAtPath } from "../utils/fs"
import { GlobalFileNames } from "../shared/globalFileNames"
import { migrateSettings } from "../utils/migrateSettings"

// Mock dependencies
vitest.mock("vscode")
vitest.mock("fs/promises", () => ({
	mkdir: vitest.fn().mockResolvedValue(undefined),
	readFile: vitest.fn(),
	writeFile: vitest.fn().mockResolvedValue(undefined),
	rename: vitest.fn().mockResolvedValue(undefined),
	unlink: vitest.fn().mockResolvedValue(undefined),
}))
vitest.mock("fs")
vitest.mock("../utils/fs")

describe("Settings Migration", () => {
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	const mockStoragePath = "/mock/storage"
	const mockSettingsDir = path.join(mockStoragePath, "settings")

	// Legacy file names
	const legacyCustomModesJson = path.join(mockSettingsDir, "custom_modes.json")
	const legacyClineCustomModesPath = path.join(mockSettingsDir, "cline_custom_modes.json")
	const legacyMcpSettingsPath = path.join(mockSettingsDir, "cline_mcp_settings.json")

	// New file names
	const newCustomModesYaml = path.join(mockSettingsDir, GlobalFileNames.customModes)
	const newMcpSettingsPath = path.join(mockSettingsDir, GlobalFileNames.mcpSettings)

	beforeEach(() => {
		vitest.clearAllMocks()

		// Mock output channel
		mockOutputChannel = {
			appendLine: vitest.fn(),
			append: vitest.fn(),
			clear: vitest.fn(),
			show: vitest.fn(),
			hide: vitest.fn(),
			dispose: vitest.fn(),
		} as unknown as vscode.OutputChannel

		// Mock extension context
		mockContext = {
			globalStorageUri: { fsPath: mockStoragePath },
		} as unknown as vscode.ExtensionContext

		// Set global outputChannel for all tests
		;(global as any).outputChannel = mockOutputChannel
	})

	it("should migrate custom modes file if old file exists and new file doesn't", async () => {
		// Clear all previous mocks to ensure clean test environment
		vitest.clearAllMocks()

		// Setup mock for rename function
		const mockRename = vitest.mocked(fs.rename).mockResolvedValue(undefined)

		// Mock file existence checks - only return true for paths we want to exist
		vitest.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
			if (path === mockSettingsDir) return true
			if (path === legacyClineCustomModesPath) return true
			return false // All other paths don't exist, including destination files
		})

		// Run the migration
		await migrateSettings(mockContext, mockOutputChannel)

		// Verify expected rename call - cline_custom_modes.json should be renamed to custom_modes.json
		expect(mockRename).toHaveBeenCalledWith(legacyClineCustomModesPath, legacyCustomModesJson)
	})

	it("should migrate MCP settings file if old file exists and new file doesn't", async () => {
		// Clear all previous mocks to ensure clean test environment
		vitest.clearAllMocks()

		// Setup mock for rename function
		const mockRename = vitest.mocked(fs.rename).mockResolvedValue(undefined)

		// Ensure the other files don't interfere with this test
		vitest.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
			if (path === mockSettingsDir) return true
			if (path === legacyMcpSettingsPath) return true
			if (path === legacyClineCustomModesPath) return false // Ensure this file doesn't exist
			if (path === legacyCustomModesJson) return false // Ensure this file doesn't exist
			return false // All other paths don't exist, including destination files
		})

		// Run the migration
		await migrateSettings(mockContext, mockOutputChannel)

		// Verify expected rename call
		expect(mockRename).toHaveBeenCalledWith(legacyMcpSettingsPath, newMcpSettingsPath)
	})

	it("should not migrate if new file already exists", async () => {
		// Clear all previous mocks to ensure clean test environment
		vitest.clearAllMocks()

		// Setup mock for rename function
		const mockRename = vitest.mocked(fs.rename).mockResolvedValue(undefined)

		// Mock file existence checks - both source and destination exist
		vitest.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
			if (path === mockSettingsDir) return true
			if (path === legacyClineCustomModesPath) return true
			if (path === legacyCustomModesJson) return true // Destination already exists
			if (path === legacyMcpSettingsPath) return true
			if (path === newMcpSettingsPath) return true
			return false
		})

		await migrateSettings(mockContext, mockOutputChannel)

		// Verify rename was not called since destination files exist
		expect(mockRename).not.toHaveBeenCalled()
	})

	it("should handle errors gracefully", async () => {
		// Clear mocks
		vitest.clearAllMocks()

		// Mock file existence to throw error
		vitest.mocked(fileExistsAtPath).mockRejectedValue(new Error("Test error"))

		await migrateSettings(mockContext, mockOutputChannel)

		// Verify error was logged
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringContaining("Error migrating settings files"),
		)
	})

	it("should convert custom_modes.json to YAML format", async () => {
		// Clear all previous mocks to ensure clean test environment
		vitest.clearAllMocks()

		const testJsonContent = JSON.stringify({ customModes: [{ slug: "test-mode", name: "Test Mode" }] })

		// Setup mock functions
		const mockWrite = vitest.mocked(fs.writeFile).mockResolvedValue(undefined)
		const mockUnlink = vitest.mocked(fs.unlink).mockResolvedValue(undefined)

		// Mock file read to return JSON content
		vitest.mocked(fs.readFile).mockImplementation(async (path: any) => {
			if (path === legacyCustomModesJson) {
				return testJsonContent
			}
			throw new Error("File not found: " + path)
		})

		// Isolate this test by making sure only the specific JSON file exists
		vitest.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
			if (path === mockSettingsDir) return true
			if (path === legacyCustomModesJson) return true
			if (path === legacyClineCustomModesPath) return false
			if (path === legacyMcpSettingsPath) return false
			return false
		})

		await migrateSettings(mockContext, mockOutputChannel)

		// Verify file operations
		expect(mockWrite).toHaveBeenCalledWith(newCustomModesYaml, expect.any(String), "utf-8")
		// We don't delete the original JSON file to allow for rollback
		expect(mockUnlink).not.toHaveBeenCalled()

		// Verify log message mentions preservation of original file
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringContaining("original JSON file preserved for rollback purposes"),
		)
	})

	it("should handle corrupt JSON gracefully", async () => {
		// Clear all previous mocks to ensure clean test environment
		vitest.clearAllMocks()

		// Setup mock functions
		const mockWrite = vitest.mocked(fs.writeFile).mockResolvedValue(undefined)
		const mockUnlink = vitest.mocked(fs.unlink).mockResolvedValue(undefined)

		// Mock file read to return corrupt JSON
		vitest.mocked(fs.readFile).mockImplementation(async (path: any) => {
			if (path === legacyCustomModesJson) {
				return "{ invalid json content" // This will cause an error when parsed
			}
			throw new Error("File not found: " + path)
		})

		// Isolate this test
		vitest.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
			if (path === mockSettingsDir) return true
			if (path === legacyCustomModesJson) return true
			if (path === legacyClineCustomModesPath) return false
			if (path === legacyMcpSettingsPath) return false
			return false
		})

		await migrateSettings(mockContext, mockOutputChannel)

		// Verify error was logged
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			expect.stringContaining("Error parsing custom_modes.json"),
		)

		// Verify no write/unlink operations were performed
		expect(mockWrite).not.toHaveBeenCalled()
		expect(mockUnlink).not.toHaveBeenCalled()
	})

	it("should skip migration when YAML file already exists", async () => {
		// Clear all previous mocks to ensure clean test environment
		vitest.clearAllMocks()

		// Setup mock functions
		const mockWrite = vitest.mocked(fs.writeFile).mockResolvedValue(undefined)
		const mockUnlink = vitest.mocked(fs.unlink).mockResolvedValue(undefined)

		// Mock file read
		vitest.mocked(fs.readFile).mockImplementation(async (path: any) => {
			if (path === legacyCustomModesJson) {
				return JSON.stringify({ customModes: [] })
			}
			throw new Error("File not found: " + path)
		})

		// Mock file existence checks - both source and yaml destination exist
		vitest.mocked(fileExistsAtPath).mockImplementation(async (path: string) => {
			if (path === mockSettingsDir) return true
			if (path === legacyCustomModesJson) return true
			if (path === newCustomModesYaml) return true // YAML already exists
			if (path === legacyClineCustomModesPath) return false
			if (path === legacyMcpSettingsPath) return false
			return false
		})

		await migrateSettings(mockContext, mockOutputChannel)

		// Verify skip message was logged
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"custom_modes.yaml already exists, skipping migration",
		)

		// Verify no file operations occurred
		expect(mockWrite).not.toHaveBeenCalled()
		expect(mockUnlink).not.toHaveBeenCalled()
	})
})
