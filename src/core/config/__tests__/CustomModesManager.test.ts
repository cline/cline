import { ModeConfig } from "../../../shared/modes"
import { CustomModesManager } from "../CustomModesManager"
import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as path from "path"

// Mock dependencies
jest.mock("vscode")
jest.mock("fs/promises")
jest.mock("../../../utils/fs", () => ({
	fileExistsAtPath: jest.fn().mockResolvedValue(false),
}))

describe("CustomModesManager", () => {
	let manager: CustomModesManager
	let mockContext: vscode.ExtensionContext
	let mockOnUpdate: jest.Mock
	let mockStoragePath: string

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks()

		// Mock storage path
		mockStoragePath = "/test/storage/path"

		// Mock context
		mockContext = {
			globalStorageUri: { fsPath: mockStoragePath },
			globalState: {
				get: jest.fn().mockResolvedValue([]),
				update: jest.fn().mockResolvedValue(undefined),
			},
		} as unknown as vscode.ExtensionContext

		// Mock onUpdate callback
		mockOnUpdate = jest.fn().mockResolvedValue(undefined)

		// Mock fs.mkdir to do nothing
		;(fs.mkdir as jest.Mock).mockResolvedValue(undefined)

		// Create manager instance
		manager = new CustomModesManager(mockContext, mockOnUpdate)
	})

	describe("Mode Configuration Validation", () => {
		test("validates valid custom mode configuration", async () => {
			const validMode = {
				slug: "test-mode",
				name: "Test Mode",
				roleDefinition: "Test role definition",
				groups: ["read"] as const,
			} satisfies ModeConfig

			// Mock file read/write operations
			;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ customModes: [] }))
			;(fs.writeFile as jest.Mock).mockResolvedValue(undefined)

			await manager.updateCustomMode(validMode.slug, validMode)

			// Verify file was written with the new mode
			expect(fs.writeFile).toHaveBeenCalledWith(
				expect.stringContaining("cline_custom_modes.json"),
				expect.stringContaining(validMode.name),
			)

			// Verify global state was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith(
				"customModes",
				expect.arrayContaining([validMode]),
			)

			// Verify onUpdate was called
			expect(mockOnUpdate).toHaveBeenCalled()
		})

		test("handles file read errors gracefully", async () => {
			// Mock fs.readFile to throw error
			;(fs.readFile as jest.Mock).mockRejectedValueOnce(new Error("Test error"))

			const modes = await manager.getCustomModes()

			// Should return empty array on error
			expect(modes).toEqual([])
		})

		test("handles file write errors gracefully", async () => {
			const validMode = {
				slug: "123e4567-e89b-12d3-a456-426614174000",
				name: "Test Mode",
				roleDefinition: "Test role definition",
				groups: ["read"] as const,
			} satisfies ModeConfig

			// Mock fs.writeFile to throw error
			;(fs.writeFile as jest.Mock).mockRejectedValueOnce(new Error("Write error"))

			const mockShowError = jest.fn()
			;(vscode.window.showErrorMessage as jest.Mock) = mockShowError

			await manager.updateCustomMode(validMode.slug, validMode)

			// Should show error message
			expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("Write error"))
		})
	})

	describe("File Operations", () => {
		test("creates settings directory if it doesn't exist", async () => {
			const configPath = path.join(mockStoragePath, "settings", "cline_custom_modes.json")
			await manager.getCustomModesFilePath()

			expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(configPath), { recursive: true })
		})

		test("creates default config if file doesn't exist", async () => {
			const configPath = path.join(mockStoragePath, "settings", "cline_custom_modes.json")
			await manager.getCustomModesFilePath()

			expect(fs.writeFile).toHaveBeenCalledWith(configPath, JSON.stringify({ customModes: [] }, null, 2))
		})

		test("watches file for changes", async () => {
			// Mock file path resolution
			const configPath = path.join(mockStoragePath, "settings", "cline_custom_modes.json")
			;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ customModes: [] }))

			// Create manager and wait for initialization
			const manager = new CustomModesManager(mockContext, mockOnUpdate)
			await manager.getCustomModesFilePath() // This ensures watchCustomModesFile has completed

			// Get the registered callback
			const registerCall = (vscode.workspace.onDidSaveTextDocument as jest.Mock).mock.calls[0]
			expect(registerCall).toBeDefined()
			const [callback] = registerCall

			// Simulate file save event
			const mockDocument = {
				uri: { fsPath: configPath },
			}
			await callback(mockDocument)

			// Verify file was processed
			expect(fs.readFile).toHaveBeenCalledWith(configPath, "utf-8")
			expect(mockContext.globalState.update).toHaveBeenCalled()
			expect(mockOnUpdate).toHaveBeenCalled()

			// Verify file content was processed
			expect(fs.readFile).toHaveBeenCalled()
		})
	})

	describe("Mode Operations", () => {
		const validMode = {
			slug: "123e4567-e89b-12d3-a456-426614174000",
			name: "Test Mode",
			roleDefinition: "Test role definition",
			groups: ["read"] as const,
		} satisfies ModeConfig

		beforeEach(() => {
			// Mock fs.readFile to return empty config
			;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ customModes: [] }))
		})

		test("adds new custom mode", async () => {
			await manager.updateCustomMode(validMode.slug, validMode)

			expect(fs.writeFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining(validMode.name))
			expect(mockOnUpdate).toHaveBeenCalled()
		})

		test("updates existing custom mode", async () => {
			// Mock existing mode
			;(fs.readFile as jest.Mock).mockResolvedValue(
				JSON.stringify({
					customModes: [validMode],
				}),
			)

			const updatedMode = {
				...validMode,
				name: "Updated Name",
			}

			await manager.updateCustomMode(validMode.slug, updatedMode)

			expect(fs.writeFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining("Updated Name"))
			expect(mockOnUpdate).toHaveBeenCalled()
		})

		test("deletes custom mode", async () => {
			// Mock existing mode
			;(fs.readFile as jest.Mock).mockResolvedValue(
				JSON.stringify({
					customModes: [validMode],
				}),
			)

			await manager.deleteCustomMode(validMode.slug)

			expect(fs.writeFile).toHaveBeenCalledWith(expect.any(String), expect.not.stringContaining(validMode.name))
			expect(mockOnUpdate).toHaveBeenCalled()
		})

		test("queues write operations", async () => {
			const mode1 = {
				...validMode,
				name: "Mode 1",
			}
			const mode2 = {
				...validMode,
				slug: "mode-2",
				name: "Mode 2",
			}

			// Mock initial empty state and track writes
			let currentModes: ModeConfig[] = []
			;(fs.readFile as jest.Mock).mockImplementation(() => JSON.stringify({ customModes: currentModes }))
			;(fs.writeFile as jest.Mock).mockImplementation(async (path, content) => {
				const data = JSON.parse(content)
				currentModes = data.customModes
				return Promise.resolve()
			})

			// Start both updates simultaneously
			await Promise.all([
				manager.updateCustomMode(mode1.slug, mode1),
				manager.updateCustomMode(mode2.slug, mode2),
			])

			// Verify final state
			expect(currentModes).toHaveLength(2)
			expect(currentModes.map((m) => m.name)).toContain("Mode 1")
			expect(currentModes.map((m) => m.name)).toContain("Mode 2")

			// Verify write was called with both modes
			const lastWriteCall = (fs.writeFile as jest.Mock).mock.calls.pop()
			const finalContent = JSON.parse(lastWriteCall[1])
			expect(finalContent.customModes).toHaveLength(2)
			expect(finalContent.customModes.map((m: ModeConfig) => m.name)).toContain("Mode 1")
			expect(finalContent.customModes.map((m: ModeConfig) => m.name)).toContain("Mode 2")
		})
	})
})
