import * as vscode from "vscode"

import { migrateSettings } from "../migrateSettings"

// Mock vscode module
vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		createOutputChannel: vi.fn(() => ({
			appendLine: vi.fn(),
		})),
	},
	commands: {
		executeCommand: vi.fn(),
	},
}))

// Mock fs module
vi.mock("fs/promises")

// Mock fs utils
vi.mock("../fs", () => ({
	fileExistsAtPath: vi.fn(),
}))

// Mock yaml module
vi.mock("yaml", () => ({
	parse: vi.fn((content) => JSON.parse(content)),
	stringify: vi.fn((obj) => JSON.stringify(obj, null, 2)),
}))

describe("migrateSettings", () => {
	let mockContext: any
	let mockOutputChannel: any
	let mockGlobalState: Map<string, any>

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Create a mock global state
		mockGlobalState = new Map()

		// Create mock output channel
		mockOutputChannel = {
			appendLine: vi.fn(),
		}

		// Create mock context
		mockContext = {
			globalState: {
				get: vi.fn((key: string) => mockGlobalState.get(key)),
				update: vi.fn(async (key: string, value: any) => {
					mockGlobalState.set(key, value)
				}),
			},
			globalStorageUri: {
				fsPath: "/mock/storage/path",
			},
		}
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("default commands migration", () => {
		it("should only run migration once", async () => {
			// Set up initial state with old default commands
			const initialCommands = ["npm install", "npm test", "tsc", "git log"]
			mockGlobalState.set("allowedCommands", initialCommands)

			// Mock file system
			const { fileExistsAtPath } = await import("../fs")
			vi.mocked(fileExistsAtPath).mockResolvedValue(false)

			// Run migration first time
			await migrateSettings(mockContext, mockOutputChannel)

			// Check that old default commands were removed
			expect(mockGlobalState.get("allowedCommands")).toEqual(["git log"])

			// Check that migration was marked as complete
			expect(mockContext.globalState.update).toHaveBeenCalledWith("defaultCommandsMigrationCompleted", true)

			// Reset mocks but keep the migration flag
			mockGlobalState.set("defaultCommandsMigrationCompleted", true)
			mockGlobalState.set("allowedCommands", ["npm install", "npm test"])
			vi.mocked(mockContext.globalState.update).mockClear()

			// Run migration again
			await migrateSettings(mockContext, mockOutputChannel)

			// Verify commands were NOT modified the second time
			expect(mockGlobalState.get("allowedCommands")).toEqual(["npm install", "npm test"])
			expect(mockContext.globalState.update).not.toHaveBeenCalled()
		})

		it("should remove npm install, npm test, and tsc from allowed commands", async () => {
			// Set up initial state with old default commands
			const initialCommands = ["git log", "npm install", "npm test", "tsc", "git diff", "echo hello"]
			mockGlobalState.set("allowedCommands", initialCommands)

			// Mock file system to indicate no settings directory exists
			const { fileExistsAtPath } = await import("../fs")
			vi.mocked(fileExistsAtPath).mockResolvedValue(false)

			// Run migration
			await migrateSettings(mockContext, mockOutputChannel)

			// Check that old default commands were removed
			const updatedCommands = mockGlobalState.get("allowedCommands")
			expect(updatedCommands).toEqual(["git log", "git diff", "echo hello"])

			// Verify the update was called
			expect(mockContext.globalState.update).toHaveBeenCalledWith("allowedCommands", [
				"git log",
				"git diff",
				"echo hello",
			])

			// Verify migration was marked as complete
			expect(mockContext.globalState.update).toHaveBeenCalledWith("defaultCommandsMigrationCompleted", true)

			// No notification should be shown
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		})

		it("should not remove commands with arguments (only exact matches)", async () => {
			// Set up initial state with commands that have arguments
			const initialCommands = [
				"npm install express",
				"npm test --coverage",
				"tsc --watch",
				"npm list",
				"npm view",
				"yarn list",
				"git status",
			]
			mockGlobalState.set("allowedCommands", initialCommands)

			// Mock file system
			const { fileExistsAtPath } = await import("../fs")
			vi.mocked(fileExistsAtPath).mockResolvedValue(false)

			// Run migration
			await migrateSettings(mockContext, mockOutputChannel)

			// Check that commands with arguments were NOT removed (only exact matches are removed)
			const updatedCommands = mockGlobalState.get("allowedCommands")
			expect(updatedCommands).toEqual([
				"npm install express",
				"npm test --coverage",
				"tsc --watch",
				"npm list",
				"npm view",
				"yarn list",
				"git status",
			])

			// Migration should still be marked as complete
			expect(mockContext.globalState.update).toHaveBeenCalledWith("defaultCommandsMigrationCompleted", true)

			// No notification should be shown
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		})

		it("should handle case-insensitive matching", async () => {
			// Set up initial state with mixed case commands
			const initialCommands = ["NPM INSTALL", "Npm Test", "TSC", "git log"]
			mockGlobalState.set("allowedCommands", initialCommands)

			// Mock file system
			const { fileExistsAtPath } = await import("../fs")
			vi.mocked(fileExistsAtPath).mockResolvedValue(false)

			// Run migration
			await migrateSettings(mockContext, mockOutputChannel)

			// Check that unsafe commands were removed regardless of case
			const updatedCommands = mockGlobalState.get("allowedCommands")
			expect(updatedCommands).toEqual(["git log"])
		})

		it("should not modify commands if no old defaults are present", async () => {
			// Set up initial state with only safe commands
			const initialCommands = ["git log", "git diff", "ls -la", "echo hello"]
			mockGlobalState.set("allowedCommands", initialCommands)

			// Mock file system
			const { fileExistsAtPath } = await import("../fs")
			vi.mocked(fileExistsAtPath).mockResolvedValue(false)

			// Run migration
			await migrateSettings(mockContext, mockOutputChannel)

			// Check that commands remain unchanged
			const updatedCommands = mockGlobalState.get("allowedCommands")
			expect(updatedCommands).toEqual(initialCommands)

			// Verify no notification was shown
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()

			// Verify migration was still marked as complete
			expect(mockContext.globalState.update).toHaveBeenCalledWith("defaultCommandsMigrationCompleted", true)
		})

		it("should handle missing or invalid allowedCommands gracefully", async () => {
			// Test with no allowedCommands set
			const { fileExistsAtPath } = await import("../fs")
			vi.mocked(fileExistsAtPath).mockResolvedValue(false)

			await migrateSettings(mockContext, mockOutputChannel)
			// Should still mark migration as complete
			expect(mockContext.globalState.update).toHaveBeenCalledWith("defaultCommandsMigrationCompleted", true)

			// Verify appropriate log messages
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("marking migration as complete"),
			)
		})

		it("should handle non-array allowedCommands gracefully", async () => {
			// Test with non-array value
			mockGlobalState.set("allowedCommands", "not an array")

			const { fileExistsAtPath } = await import("../fs")
			vi.mocked(fileExistsAtPath).mockResolvedValue(false)

			await migrateSettings(mockContext, mockOutputChannel)

			// Should still mark migration as complete
			expect(mockContext.globalState.update).toHaveBeenCalledWith("defaultCommandsMigrationCompleted", true)

			// Verify appropriate log messages
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("marking migration as complete"),
			)
		})

		it("should handle errors gracefully", async () => {
			// Set up state
			mockGlobalState.set("allowedCommands", ["npm install"])

			// Make update throw an error
			mockContext.globalState.update = vi.fn().mockRejectedValue(new Error("Update failed"))

			// Mock file system
			const { fileExistsAtPath } = await import("../fs")
			vi.mocked(fileExistsAtPath).mockResolvedValue(false)

			// Run migration - should not throw
			await expect(migrateSettings(mockContext, mockOutputChannel)).resolves.toBeUndefined()

			// Verify error was logged
			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				expect.stringContaining("[Default Commands Migration] Error"),
			)
		})

		it("should only remove exact matches, not commands with arguments", async () => {
			// Set up initial state with exact matches and commands with arguments
			const initialCommands = [
				"npm install", // exact match - should be removed
				"npm install --save-dev typescript", // has arguments - should NOT be removed
				"npm test", // exact match - should be removed
				"npm test --coverage", // has arguments - should NOT be removed
				"tsc", // exact match - should be removed
				"tsc --noEmit", // has arguments - should NOT be removed
				"git log --oneline",
			]
			mockGlobalState.set("allowedCommands", initialCommands)

			// Mock file system
			const { fileExistsAtPath } = await import("../fs")
			vi.mocked(fileExistsAtPath).mockResolvedValue(false)

			// Run migration
			await migrateSettings(mockContext, mockOutputChannel)

			// Check that only exact matches were removed
			const updatedCommands = mockGlobalState.get("allowedCommands")
			expect(updatedCommands).toEqual([
				"npm install --save-dev typescript",
				"npm test --coverage",
				"tsc --noEmit",
				"git log --oneline",
			])

			// No notification should be shown
			expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		})
	})
})
