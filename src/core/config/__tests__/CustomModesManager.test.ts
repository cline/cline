// npx jest src/core/config/__tests__/CustomModesManager.test.ts

import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { CustomModesManager } from "../CustomModesManager"
import { ModeConfig } from "../../../shared/modes"
import { fileExistsAtPath } from "../../../utils/fs"
import { getWorkspacePath, arePathsEqual } from "../../../utils/path"
import { GlobalFileNames } from "../../../shared/globalFileNames"

jest.mock("vscode")
jest.mock("fs/promises")
jest.mock("../../../utils/fs")
jest.mock("../../../utils/path")

describe("CustomModesManager", () => {
	let manager: CustomModesManager
	let mockContext: vscode.ExtensionContext
	let mockOnUpdate: jest.Mock
	let mockWorkspaceFolders: { uri: { fsPath: string } }[]

	// Use path.sep to ensure correct path separators for the current platform
	const mockStoragePath = `${path.sep}mock${path.sep}settings`
	const mockSettingsPath = path.join(mockStoragePath, "settings", GlobalFileNames.customModes)
	const mockRoomodes = `${path.sep}mock${path.sep}workspace${path.sep}.roomodes`

	beforeEach(() => {
		mockOnUpdate = jest.fn()
		mockContext = {
			globalState: {
				get: jest.fn(),
				update: jest.fn(),
			},
			globalStorageUri: {
				fsPath: mockStoragePath,
			},
		} as unknown as vscode.ExtensionContext

		mockWorkspaceFolders = [{ uri: { fsPath: "/mock/workspace" } }]
		;(vscode.workspace as any).workspaceFolders = mockWorkspaceFolders
		;(vscode.workspace.onDidSaveTextDocument as jest.Mock).mockReturnValue({ dispose: jest.fn() })
		;(getWorkspacePath as jest.Mock).mockReturnValue("/mock/workspace")
		;(fileExistsAtPath as jest.Mock).mockImplementation(async (path: string) => {
			return path === mockSettingsPath || path === mockRoomodes
		})
		;(fs.mkdir as jest.Mock).mockResolvedValue(undefined)
		;(fs.readFile as jest.Mock).mockImplementation(async (path: string) => {
			if (path === mockSettingsPath) {
				return JSON.stringify({ customModes: [] })
			}
			throw new Error("File not found")
		})

		manager = new CustomModesManager(mockContext, mockOnUpdate)
	})

	afterEach(() => {
		jest.clearAllMocks()
	})

	describe("getCustomModes", () => {
		it("should merge modes with .roomodes taking precedence", async () => {
			const settingsModes = [
				{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] },
				{ slug: "mode2", name: "Mode 2", roleDefinition: "Role 2", groups: ["read"] },
			]

			const roomodesModes = [
				{ slug: "mode2", name: "Mode 2 Override", roleDefinition: "Role 2 Override", groups: ["read"] },
				{ slug: "mode3", name: "Mode 3", roleDefinition: "Role 3", groups: ["read"] },
			]

			;(fs.readFile as jest.Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return JSON.stringify({ customModes: settingsModes })
				}
				if (path === mockRoomodes) {
					return JSON.stringify({ customModes: roomodesModes })
				}
				throw new Error("File not found")
			})

			const modes = await manager.getCustomModes()

			// Should contain 3 modes (mode1 from settings, mode2 and mode3 from roomodes)
			expect(modes).toHaveLength(3)
			expect(modes.map((m) => m.slug)).toEqual(["mode2", "mode3", "mode1"])

			// mode2 should come from .roomodes since it takes precedence
			const mode2 = modes.find((m) => m.slug === "mode2")
			expect(mode2?.name).toBe("Mode 2 Override")
			expect(mode2?.roleDefinition).toBe("Role 2 Override")
		})

		it("should handle missing .roomodes file", async () => {
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]

			;(fileExistsAtPath as jest.Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.readFile as jest.Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return JSON.stringify({ customModes: settingsModes })
				}
				throw new Error("File not found")
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(1)
			expect(modes[0].slug).toBe("mode1")
		})

		it("should handle invalid JSON in .roomodes", async () => {
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]

			;(fs.readFile as jest.Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return JSON.stringify({ customModes: settingsModes })
				}
				if (path === mockRoomodes) {
					return "invalid json"
				}
				throw new Error("File not found")
			})

			const modes = await manager.getCustomModes()

			// Should fall back to settings modes when .roomodes is invalid
			expect(modes).toHaveLength(1)
			expect(modes[0].slug).toBe("mode1")
		})
	})

	describe("updateCustomMode", () => {
		it("should update mode in settings file while preserving .roomodes precedence", async () => {
			const newMode: ModeConfig = {
				slug: "mode1",
				name: "Updated Mode 1",
				roleDefinition: "Updated Role 1",
				groups: ["read"],
				source: "global",
			}

			const roomodesModes = [
				{
					slug: "mode1",
					name: "Roomodes Mode 1",
					roleDefinition: "Role 1",
					groups: ["read"],
					source: "project",
				},
			]

			const existingModes = [
				{ slug: "mode2", name: "Mode 2", roleDefinition: "Role 2", groups: ["read"], source: "global" },
			]

			let settingsContent = { customModes: existingModes }
			let roomodesContent = { customModes: roomodesModes }

			;(fs.readFile as jest.Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return JSON.stringify(roomodesContent)
				}
				if (path === mockSettingsPath) {
					return JSON.stringify(settingsContent)
				}
				throw new Error("File not found")
			})
			;(fs.writeFile as jest.Mock).mockImplementation(
				async (path: string, content: string, encoding?: string) => {
					if (path === mockSettingsPath) {
						settingsContent = JSON.parse(content)
					}
					if (path === mockRoomodes) {
						roomodesContent = JSON.parse(content)
					}
					return Promise.resolve()
				},
			)

			await manager.updateCustomMode("mode1", newMode)

			// Should write to settings file
			expect(fs.writeFile).toHaveBeenCalledWith(mockSettingsPath, expect.any(String), "utf-8")

			// Verify the content of the write
			const writeCall = (fs.writeFile as jest.Mock).mock.calls[0]
			const content = JSON.parse(writeCall[1])
			expect(content.customModes).toContainEqual(
				expect.objectContaining({
					slug: "mode1",
					name: "Updated Mode 1",
					roleDefinition: "Updated Role 1",
					source: "global",
				}),
			)

			// Should update global state with merged modes where .roomodes takes precedence
			expect(mockContext.globalState.update).toHaveBeenCalledWith(
				"customModes",
				expect.arrayContaining([
					expect.objectContaining({
						slug: "mode1",
						name: "Roomodes Mode 1", // .roomodes version should take precedence
						source: "project",
					}),
				]),
			)

			// Should trigger onUpdate
			expect(mockOnUpdate).toHaveBeenCalled()
		})

		it("creates .roomodes file when adding project-specific mode", async () => {
			const projectMode: ModeConfig = {
				slug: "project-mode",
				name: "Project Mode",
				roleDefinition: "Project Role",
				groups: ["read"],
				source: "project",
			}

			// Mock .roomodes to not exist initially
			let roomodesContent: any = null
			;(fileExistsAtPath as jest.Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.readFile as jest.Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return JSON.stringify({ customModes: [] })
				}
				if (path === mockRoomodes) {
					if (!roomodesContent) {
						throw new Error("File not found")
					}
					return JSON.stringify(roomodesContent)
				}
				throw new Error("File not found")
			})
			;(fs.writeFile as jest.Mock).mockImplementation(async (path: string, content: string) => {
				if (path === mockRoomodes) {
					roomodesContent = JSON.parse(content)
				}
				return Promise.resolve()
			})

			await manager.updateCustomMode("project-mode", projectMode)

			// Verify .roomodes was created with the project mode
			expect(fs.writeFile).toHaveBeenCalledWith(
				expect.any(String), // Don't check exact path as it may have different separators on different platforms
				expect.stringContaining("project-mode"),
				"utf-8",
			)

			// Verify the path is correct regardless of separators
			const writeCall = (fs.writeFile as jest.Mock).mock.calls[0]
			expect(path.normalize(writeCall[0])).toBe(path.normalize(mockRoomodes))

			// Verify the content written to .roomodes
			expect(roomodesContent).toEqual({
				customModes: [
					expect.objectContaining({
						slug: "project-mode",
						name: "Project Mode",
						roleDefinition: "Project Role",
						source: "project",
					}),
				],
			})
		})

		it("queues write operations", async () => {
			const mode1: ModeConfig = {
				slug: "mode1",
				name: "Mode 1",
				roleDefinition: "Role 1",
				groups: ["read"],
				source: "global",
			}
			const mode2: ModeConfig = {
				slug: "mode2",
				name: "Mode 2",
				roleDefinition: "Role 2",
				groups: ["read"],
				source: "global",
			}

			let settingsContent = { customModes: [] }
			;(fs.readFile as jest.Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return JSON.stringify(settingsContent)
				}
				throw new Error("File not found")
			})
			;(fs.writeFile as jest.Mock).mockImplementation(
				async (path: string, content: string, encoding?: string) => {
					if (path === mockSettingsPath) {
						settingsContent = JSON.parse(content)
					}
					return Promise.resolve()
				},
			)

			// Start both updates simultaneously
			await Promise.all([manager.updateCustomMode("mode1", mode1), manager.updateCustomMode("mode2", mode2)])

			// Verify final state in settings file
			expect(settingsContent.customModes).toHaveLength(2)
			expect(settingsContent.customModes.map((m: ModeConfig) => m.name)).toContain("Mode 1")
			expect(settingsContent.customModes.map((m: ModeConfig) => m.name)).toContain("Mode 2")

			// Verify global state was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith(
				"customModes",
				expect.arrayContaining([
					expect.objectContaining({
						slug: "mode1",
						name: "Mode 1",
						source: "global",
					}),
					expect.objectContaining({
						slug: "mode2",
						name: "Mode 2",
						source: "global",
					}),
				]),
			)

			// Should trigger onUpdate
			expect(mockOnUpdate).toHaveBeenCalled()
		})
	})
	describe("File Operations", () => {
		it("creates settings directory if it doesn't exist", async () => {
			const settingsPath = path.join(mockStoragePath, "settings", GlobalFileNames.customModes)
			await manager.getCustomModesFilePath()

			expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(settingsPath), { recursive: true })
		})

		it("creates default config if file doesn't exist", async () => {
			const settingsPath = path.join(mockStoragePath, "settings", GlobalFileNames.customModes)

			// Mock fileExists to return false first time, then true
			let firstCall = true
			;(fileExistsAtPath as jest.Mock).mockImplementation(async () => {
				if (firstCall) {
					firstCall = false
					return false
				}
				return true
			})

			await manager.getCustomModesFilePath()

			expect(fs.writeFile).toHaveBeenCalledWith(
				settingsPath,
				expect.stringMatching(/^\{\s+"customModes":\s+\[\s*\]\s*\}$/),
			)
		})

		it("watches file for changes", async () => {
			const configPath = path.join(mockStoragePath, "settings", GlobalFileNames.customModes)

			;(fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify({ customModes: [] }))
			;(arePathsEqual as jest.Mock).mockImplementation((path1: string, path2: string) => {
				return path.normalize(path1) === path.normalize(path2)
			})
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
		})
	})

	describe("deleteCustomMode", () => {
		it("deletes mode from settings file", async () => {
			const existingMode = {
				slug: "mode-to-delete",
				name: "Mode To Delete",
				roleDefinition: "Test role",
				groups: ["read"],
				source: "global",
			}

			let settingsContent = { customModes: [existingMode] }
			;(fs.readFile as jest.Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return JSON.stringify(settingsContent)
				}
				throw new Error("File not found")
			})
			;(fs.writeFile as jest.Mock).mockImplementation(
				async (path: string, content: string, encoding?: string) => {
					if (path === mockSettingsPath && encoding === "utf-8") {
						settingsContent = JSON.parse(content)
					}
					return Promise.resolve()
				},
			)

			// Mock the global state update to actually update the settingsContent
			;(mockContext.globalState.update as jest.Mock).mockImplementation((key: string, value: any) => {
				if (key === "customModes") {
					settingsContent.customModes = value
				}
				return Promise.resolve()
			})

			await manager.deleteCustomMode("mode-to-delete")

			// Verify mode was removed from settings file
			expect(settingsContent.customModes).toHaveLength(0)

			// Verify global state was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("customModes", [])

			// Should trigger onUpdate
			expect(mockOnUpdate).toHaveBeenCalled()
		})

		it("handles errors gracefully", async () => {
			const mockShowError = jest.fn()
			;(vscode.window.showErrorMessage as jest.Mock) = mockShowError
			;(fs.writeFile as jest.Mock).mockRejectedValue(new Error("Write error"))

			await manager.deleteCustomMode("non-existent-mode")

			expect(mockShowError).toHaveBeenCalledWith(expect.stringContaining("Write error"))
		})
	})

	describe("updateModesInFile", () => {
		it("handles corrupted JSON content gracefully", async () => {
			const corruptedJson = "{ invalid json content"
			;(fs.readFile as jest.Mock).mockResolvedValue(corruptedJson)

			const newMode: ModeConfig = {
				slug: "test-mode",
				name: "Test Mode",
				roleDefinition: "Test Role",
				groups: ["read"],
				source: "global",
			}

			await manager.updateCustomMode("test-mode", newMode)

			// Verify that a valid JSON structure was written
			const writeCall = (fs.writeFile as jest.Mock).mock.calls[0]
			const writtenContent = JSON.parse(writeCall[1])
			expect(writtenContent).toEqual({
				customModes: [
					expect.objectContaining({
						slug: "test-mode",
						name: "Test Mode",
						roleDefinition: "Test Role",
					}),
				],
			})
		})
	})
})
