// npx vitest core/config/__tests__/CustomModesManager.spec.ts

import type { Mock } from "vitest"

import * as path from "path"
import * as fs from "fs/promises"

import * as yaml from "yaml"
import * as vscode from "vscode"

import type { ModeConfig } from "@roo-code/types"

import { fileExistsAtPath } from "../../../utils/fs"
import { getWorkspacePath, arePathsEqual } from "../../../utils/path"
import { GlobalFileNames } from "../../../shared/globalFileNames"

import { CustomModesManager } from "../CustomModesManager"

vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [],
		onDidSaveTextDocument: vi.fn(),
		createFileSystemWatcher: vi.fn(),
	},
	window: {
		showErrorMessage: vi.fn(),
	},
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn(),
	readFile: vi.fn(),
	writeFile: vi.fn(),
	stat: vi.fn(),
	readdir: vi.fn(),
	rm: vi.fn(),
}))

vi.mock("../../../utils/fs")
vi.mock("../../../utils/path")

describe("CustomModesManager", () => {
	let manager: CustomModesManager
	let mockContext: vscode.ExtensionContext
	let mockOnUpdate: Mock
	let mockWorkspaceFolders: { uri: { fsPath: string } }[]

	// Use path.sep to ensure correct path separators for the current platform
	const mockStoragePath = `${path.sep}mock${path.sep}settings`
	const mockSettingsPath = path.join(mockStoragePath, "settings", GlobalFileNames.customModes)
	const mockWorkspacePath = path.resolve("/mock/workspace")
	const mockRoomodes = path.join(mockWorkspacePath, ".roomodes")

	beforeEach(() => {
		mockOnUpdate = vi.fn()
		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
				keys: vi.fn(() => []),
				setKeysForSync: vi.fn(),
			},
			globalStorageUri: {
				fsPath: mockStoragePath,
			},
		} as unknown as vscode.ExtensionContext

		// mockWorkspacePath is now defined at the top level
		mockWorkspaceFolders = [{ uri: { fsPath: mockWorkspacePath } }]
		;(vscode.workspace as any).workspaceFolders = mockWorkspaceFolders
		;(vscode.workspace.onDidSaveTextDocument as Mock).mockReturnValue({ dispose: vi.fn() })
		;(getWorkspacePath as Mock).mockReturnValue(mockWorkspacePath)
		;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
			return path === mockSettingsPath || path === mockRoomodes
		})
		;(fs.mkdir as Mock).mockResolvedValue(undefined)
		;(fs.writeFile as Mock).mockResolvedValue(undefined)
		;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
		;(fs.readdir as Mock).mockResolvedValue([])
		;(fs.rm as Mock).mockResolvedValue(undefined)
		;(fs.readFile as Mock).mockImplementation(async (path: string) => {
			if (path === mockSettingsPath) {
				return yaml.stringify({ customModes: [] })
			}

			throw new Error("File not found")
		})

		manager = new CustomModesManager(mockContext, mockOnUpdate)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("getCustomModes", () => {
		it("should handle valid YAML in .roomodes file and JSON for global customModes", async () => {
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]

			const roomodesModes = [{ slug: "mode2", name: "Mode 2", roleDefinition: "Role 2", groups: ["read"] }]

			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				if (path === mockRoomodes) {
					return yaml.stringify({ customModes: roomodesModes })
				}
				throw new Error("File not found")
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(2)
		})

		it("should merge modes with .roomodes taking precedence", async () => {
			const settingsModes = [
				{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] },
				{ slug: "mode2", name: "Mode 2", roleDefinition: "Role 2", groups: ["read"] },
			]

			const roomodesModes = [
				{ slug: "mode2", name: "Mode 2 Override", roleDefinition: "Role 2 Override", groups: ["read"] },
				{ slug: "mode3", name: "Mode 3", roleDefinition: "Role 3", groups: ["read"] },
			]

			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				if (path === mockRoomodes) {
					return yaml.stringify({ customModes: roomodesModes })
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

			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				throw new Error("File not found")
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(1)
			expect(modes[0].slug).toBe("mode1")
		})

		it("should handle invalid YAML in .roomodes", async () => {
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]

			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				if (path === mockRoomodes) {
					return "invalid yaml content"
				}
				throw new Error("File not found")
			})

			const modes = await manager.getCustomModes()

			// Should fall back to settings modes when .roomodes is invalid
			expect(modes).toHaveLength(1)
			expect(modes[0].slug).toBe("mode1")
		})

		it("should memoize results for 10 seconds", async () => {
			// Setup test data
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				throw new Error("File not found")
			})

			// Mock fileExistsAtPath to only return true for settings path
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})

			// First call should read from file
			const firstResult = await manager.getCustomModes()

			// Reset mock to verify it's not called again
			vi.clearAllMocks()

			// Setup mocks again for second call
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				throw new Error("File not found")
			})

			// Second call should use cached result
			const secondResult = await manager.getCustomModes()
			expect(fs.readFile).not.toHaveBeenCalled()
			expect(secondResult).toHaveLength(1)
			expect(secondResult[0].slug).toBe("mode1")

			// Results should be the same object (not just equal)
			expect(secondResult).toBe(firstResult)
		})

		it("should invalidate cache when modes are updated", async () => {
			// Setup initial data
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				throw new Error("File not found")
			})
			;(fs.writeFile as Mock).mockResolvedValue(undefined)

			// First call to cache the result
			await manager.getCustomModes()

			// Reset mocks to track new calls
			vi.clearAllMocks()

			// Update a mode
			const updatedMode: ModeConfig = {
				slug: "mode1",
				name: "Updated Mode 1",
				roleDefinition: "Updated Role 1",
				groups: ["read"],
				source: "global",
			}

			// Mock the updated file content
			const updatedSettingsModes = [updatedMode]
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: updatedSettingsModes })
				}
				throw new Error("File not found")
			})

			// Update the mode
			await manager.updateCustomMode("mode1", updatedMode)

			// Reset mocks again
			vi.clearAllMocks()

			// Next call should read from file again (cache invalidated)
			await manager.getCustomModes()
			expect(fs.readFile).toHaveBeenCalled()
		})

		it("should invalidate cache when modes are deleted", async () => {
			// Setup initial data
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				throw new Error("File not found")
			})
			;(fs.writeFile as Mock).mockResolvedValue(undefined)

			// First call to cache the result
			await manager.getCustomModes()

			// Reset mocks to track new calls
			vi.clearAllMocks()

			// Delete a mode
			await manager.deleteCustomMode("mode1")

			// Mock the updated file content (empty)
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			})

			// Reset mocks again
			vi.clearAllMocks()

			// Next call should read from file again (cache invalidated)
			await manager.getCustomModes()
			expect(fs.readFile).toHaveBeenCalled()
		})

		it("should invalidate cache when modes are updated (simulating file changes)", async () => {
			// Setup initial data
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				throw new Error("File not found")
			})
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.writeFile as Mock).mockResolvedValue(undefined)

			// First call to cache the result
			await manager.getCustomModes()

			// Reset mocks to track new calls
			vi.clearAllMocks()

			// Setup for update
			const updatedMode: ModeConfig = {
				slug: "mode1",
				name: "Updated Mode 1",
				roleDefinition: "Updated Role 1",
				groups: ["read"],
				source: "global",
			}

			// Mock the updated file content
			const updatedSettingsModes = [updatedMode]
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: updatedSettingsModes })
				}
				throw new Error("File not found")
			})

			// Simulate a file change by updating a mode
			// This should invalidate the cache
			await manager.updateCustomMode("mode1", updatedMode)

			// Reset mocks again
			vi.clearAllMocks()

			// Setup mocks again
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: updatedSettingsModes })
				}
				throw new Error("File not found")
			})

			// Next call should read from file again (cache was invalidated by the update)
			await manager.getCustomModes()
			expect(fs.readFile).toHaveBeenCalled()
		})

		it("should refresh cache after TTL expires", async () => {
			// Setup test data
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				throw new Error("File not found")
			})
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})

			// Mock Date.now to control time
			const originalDateNow = Date.now
			let currentTime = 1000
			Date.now = vi.fn(() => currentTime)

			try {
				// First call should read from file
				await manager.getCustomModes()

				// Reset mock to verify it's not called again
				vi.clearAllMocks()

				// Setup mocks again for second call
				;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
					return path === mockSettingsPath
				})
				;(fs.readFile as Mock).mockImplementation(async (path: string) => {
					if (path === mockSettingsPath) {
						return yaml.stringify({ customModes: settingsModes })
					}
					throw new Error("File not found")
				})

				// Second call within TTL should use cache
				await manager.getCustomModes()
				expect(fs.readFile).not.toHaveBeenCalled()

				// Advance time beyond TTL (10 seconds)
				currentTime += 11000

				// Reset mocks again
				vi.clearAllMocks()

				// Setup mocks again for third call
				;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
					return path === mockSettingsPath
				})
				;(fs.readFile as Mock).mockImplementation(async (path: string) => {
					if (path === mockSettingsPath) {
						return yaml.stringify({ customModes: settingsModes })
					}
					throw new Error("File not found")
				})

				// Call after TTL should read from file again
				await manager.getCustomModes()
				expect(fs.readFile).toHaveBeenCalled()
			} finally {
				// Restore original Date.now
				Date.now = originalDateNow
			}
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

			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				if (path === mockSettingsPath) {
					return yaml.stringify(settingsContent)
				}
				throw new Error("File not found")
			})
			;(fs.writeFile as Mock).mockImplementation(async (path: string, content: string, _encoding?: string) => {
				if (path === mockSettingsPath) {
					settingsContent = yaml.parse(content)
				}
				if (path === mockRoomodes) {
					roomodesContent = yaml.parse(content)
				}
				return Promise.resolve()
			})

			await manager.updateCustomMode("mode1", newMode)

			// Should write to settings file
			expect(fs.writeFile).toHaveBeenCalledWith(mockSettingsPath, expect.any(String), "utf-8")

			// Verify the content of the write
			const writeCall = (fs.writeFile as Mock).mock.calls[0]
			const content = yaml.parse(writeCall[1])
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
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				if (path === mockRoomodes) {
					if (!roomodesContent) {
						throw new Error("File not found")
					}
					return yaml.stringify(roomodesContent)
				}
				throw new Error("File not found")
			})
			;(fs.writeFile as Mock).mockImplementation(async (path: string, content: string) => {
				if (path === mockRoomodes) {
					roomodesContent = yaml.parse(content)
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
			const writeCall = (fs.writeFile as Mock).mock.calls[0]
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
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify(settingsContent)
				}
				throw new Error("File not found")
			})
			;(fs.writeFile as Mock).mockImplementation(async (path: string, content: string, _encoding?: string) => {
				if (path === mockSettingsPath) {
					settingsContent = yaml.parse(content)
				}
				return Promise.resolve()
			})

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
			;(fileExistsAtPath as Mock).mockImplementation(async () => {
				if (firstCall) {
					firstCall = false
					return false
				}
				return true
			})

			await manager.getCustomModesFilePath()

			expect(fs.writeFile).toHaveBeenCalledWith(settingsPath, expect.stringMatching(/^customModes: \[\]/))
		})

		it("watches file for changes", async () => {
			const configPath = path.join(mockStoragePath, "settings", GlobalFileNames.customModes)

			;(fs.readFile as Mock).mockResolvedValue(yaml.stringify({ customModes: [] }))
			;(arePathsEqual as Mock).mockImplementation(
				(path1: string, path2: string) => path.normalize(path1) === path.normalize(path2),
			)

			// Mock createFileSystemWatcher to return a mock watcher
			const mockWatcher = {
				onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				dispose: vi.fn(),
			}
			const createFileSystemWatcherMock = vi.fn().mockReturnValue(mockWatcher)
			;(vscode.workspace as any).createFileSystemWatcher = createFileSystemWatcherMock

			// Temporarily set NODE_ENV to allow file watching
			const originalNodeEnv = process.env.NODE_ENV
			process.env.NODE_ENV = "development"

			try {
				// Create a new manager to trigger the file watcher setup
				const testManager = new CustomModesManager(mockContext, mockOnUpdate)

				// Wait a bit for the async watchCustomModesFiles to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				// Verify createFileSystemWatcher was called
				expect(createFileSystemWatcherMock).toHaveBeenCalled()

				// Get the onChange callback that was registered
				const onChangeCall = mockWatcher.onDidChange.mock.calls[0]
				expect(onChangeCall).toBeDefined()
				const [onChangeCallback] = onChangeCall

				// Simulate file change event
				await onChangeCallback()

				// Verify file was processed
				expect(fs.readFile).toHaveBeenCalledWith(configPath, "utf-8")
				expect(mockContext.globalState.update).toHaveBeenCalled()
				expect(mockOnUpdate).toHaveBeenCalled()

				// Clean up
				testManager.dispose()
			} finally {
				// Restore original NODE_ENV
				process.env.NODE_ENV = originalNodeEnv
			}
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
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify(settingsContent)
				}
				throw new Error("File not found")
			})
			;(fs.writeFile as Mock).mockImplementation(async (path: string, content: string, encoding?: string) => {
				if (path === mockSettingsPath && encoding === "utf-8") {
					settingsContent = yaml.parse(content)
				}
				return Promise.resolve()
			})

			// Mock the global state update to actually update the settingsContent
			;(mockContext.globalState.update as Mock).mockImplementation((key: string, value: any) => {
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
			const mockShowError = vi.fn()
			;(vscode.window.showErrorMessage as Mock) = mockShowError
			;(fs.writeFile as Mock).mockRejectedValue(new Error("Write error"))

			await manager.deleteCustomMode("non-existent-mode")

			expect(mockShowError).toHaveBeenCalledWith("customModes.errors.deleteFailed")
		})
	})

	describe("updateModesInFile", () => {
		it("handles corrupted YAML content gracefully", async () => {
			const corruptedYaml = "customModes: [invalid yaml content"
			;(fs.readFile as Mock).mockResolvedValue(corruptedYaml)

			const newMode: ModeConfig = {
				slug: "test-mode",
				name: "Test Mode",
				roleDefinition: "Test Role",
				groups: ["read"],
				source: "global",
			}

			await manager.updateCustomMode("test-mode", newMode)

			// Verify that a valid YAML structure was written
			const writeCall = (fs.writeFile as Mock).mock.calls[0]
			const writtenContent = yaml.parse(writeCall[1])
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

		describe("importModeWithRules", () => {
			it("should return error when YAML content is invalid", async () => {
				const invalidYaml = "invalid yaml content"

				const result = await manager.importModeWithRules(invalidYaml)

				expect(result.success).toBe(false)
				expect(result.error).toContain("Invalid import format")
			})

			it("should return error when no custom modes found in YAML", async () => {
				const emptyYaml = yaml.stringify({ customModes: [] })

				const result = await manager.importModeWithRules(emptyYaml)

				expect(result.success).toBe(false)
				expect(result.error).toBe("Invalid import format: Expected 'customModes' array in YAML")
			})

			it("should return error when no workspace is available", async () => {
				;(getWorkspacePath as Mock).mockReturnValue(null)
				const validYaml = yaml.stringify({
					customModes: [
						{
							slug: "test-mode",
							name: "Test Mode",
							roleDefinition: "Test Role",
							groups: ["read"],
						},
					],
				})

				const result = await manager.importModeWithRules(validYaml)

				expect(result.success).toBe(false)
				expect(result.error).toBe("No workspace found")
			})

			it("should successfully import mode without rules files", async () => {
				const importYaml = yaml.stringify({
					customModes: [
						{
							slug: "imported-mode",
							name: "Imported Mode",
							roleDefinition: "Imported Role",
							groups: ["read", "edit"],
						},
					],
				})

				let roomodesContent: any = null
				;(fs.readFile as Mock).mockImplementation(async (path: string) => {
					if (path === mockSettingsPath) {
						return yaml.stringify({ customModes: [] })
					}
					if (path === mockRoomodes && roomodesContent) {
						return yaml.stringify(roomodesContent)
					}
					throw new Error("File not found")
				})
				;(fs.writeFile as Mock).mockImplementation(async (path: string, content: string) => {
					if (path === mockRoomodes) {
						roomodesContent = yaml.parse(content)
					}
					return Promise.resolve()
				})

				const result = await manager.importModeWithRules(importYaml)

				expect(result.success).toBe(true)
				expect(fs.writeFile).toHaveBeenCalledWith(
					expect.stringContaining(".roomodes"),
					expect.stringContaining("imported-mode"),
					"utf-8",
				)
			})

			it("should successfully import mode with rules files", async () => {
				const importYaml = yaml.stringify({
					customModes: [
						{
							slug: "imported-mode",
							name: "Imported Mode",
							roleDefinition: "Imported Role",
							groups: ["read"],
							rulesFiles: [
								{
									relativePath: "rules-imported-mode/rule1.md",
									content: "Rule 1 content",
								},
								{
									relativePath: "rules-imported-mode/subfolder/rule2.md",
									content: "Rule 2 content",
								},
							],
						},
					],
				})

				let roomodesContent: any = null
				let writtenFiles: Record<string, string> = {}
				;(fs.readFile as Mock).mockImplementation(async (path: string) => {
					if (path === mockSettingsPath) {
						return yaml.stringify({ customModes: [] })
					}
					if (path === mockRoomodes && roomodesContent) {
						return yaml.stringify(roomodesContent)
					}
					throw new Error("File not found")
				})
				;(fs.writeFile as Mock).mockImplementation(async (path: string, content: string) => {
					if (path === mockRoomodes) {
						roomodesContent = yaml.parse(content)
					} else {
						writtenFiles[path] = content
					}
					return Promise.resolve()
				})
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				const result = await manager.importModeWithRules(importYaml)

				expect(result.success).toBe(true)

				// Verify mode was imported
				expect(fs.writeFile).toHaveBeenCalledWith(
					expect.stringContaining(".roomodes"),
					expect.stringContaining("imported-mode"),
					"utf-8",
				)

				// Verify rules files were created
				expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("rules-imported-mode"), {
					recursive: true,
				})
				expect(fs.mkdir).toHaveBeenCalledWith(
					expect.stringContaining(path.join("rules-imported-mode", "subfolder")),
					{ recursive: true },
				)

				// Verify file contents
				const rule1Path = Object.keys(writtenFiles).find((p) => p.includes("rule1.md"))
				const rule2Path = Object.keys(writtenFiles).find((p) => p.includes("rule2.md"))
				expect(writtenFiles[rule1Path!]).toBe("Rule 1 content")
				expect(writtenFiles[rule2Path!]).toBe("Rule 2 content")
			})

			it("should import multiple modes at once", async () => {
				const importYaml = yaml.stringify({
					customModes: [
						{
							slug: "mode1",
							name: "Mode 1",
							roleDefinition: "Role 1",
							groups: ["read"],
						},
						{
							slug: "mode2",
							name: "Mode 2",
							roleDefinition: "Role 2",
							groups: ["edit"],
							rulesFiles: [
								{
									relativePath: "rules-mode2/rule.md",
									content: "Mode 2 rules",
								},
							],
						},
					],
				})

				let roomodesContent: any = null
				;(fs.readFile as Mock).mockImplementation(async (path: string) => {
					if (path === mockSettingsPath) {
						return yaml.stringify({ customModes: [] })
					}
					if (path === mockRoomodes && roomodesContent) {
						return yaml.stringify(roomodesContent)
					}
					throw new Error("File not found")
				})
				;(fs.writeFile as Mock).mockImplementation(async (path: string, content: string) => {
					if (path === mockRoomodes) {
						roomodesContent = yaml.parse(content)
					}
					return Promise.resolve()
				})

				const result = await manager.importModeWithRules(importYaml)

				expect(result.success).toBe(true)
				expect(roomodesContent.customModes).toHaveLength(2)
				expect(roomodesContent.customModes[0].slug).toBe("mode1")
				expect(roomodesContent.customModes[1].slug).toBe("mode2")
			})

			it("should handle import errors gracefully", async () => {
				const importYaml = yaml.stringify({
					customModes: [
						{
							slug: "test-mode",
							name: "Test Mode",
							roleDefinition: "Test Role",
							groups: ["read"],
							rulesFiles: [
								{
									relativePath: "rules-test-mode/rule.md",
									content: "Rule content",
								},
							],
						},
					],
				})

				// Mock fs.readFile to work normally
				;(fs.readFile as Mock).mockImplementation(async (path: string) => {
					if (path === mockSettingsPath) {
						return yaml.stringify({ customModes: [] })
					}
					if (path === mockRoomodes) {
						throw new Error("File not found")
					}
					throw new Error("File not found")
				})

				// Mock fs.mkdir to fail when creating rules directory
				;(fs.mkdir as Mock).mockRejectedValue(new Error("Permission denied"))

				// Mock fs.writeFile to work normally for .roomodes but we won't get there
				;(fs.writeFile as Mock).mockResolvedValue(undefined)

				const result = await manager.importModeWithRules(importYaml)

				expect(result.success).toBe(false)
				expect(result.error).toContain("Permission denied")
			})

			it("should prevent path traversal attacks in import", async () => {
				const maliciousYaml = yaml.stringify({
					customModes: [
						{
							slug: "test-mode",
							name: "Test Mode",
							roleDefinition: "Test Role",
							groups: ["read"],
							rulesFiles: [
								{
									relativePath: "../../../etc/passwd",
									content: "malicious content",
								},
								{
									relativePath: "rules-test-mode/../../../sensitive.txt",
									content: "malicious content",
								},
								{
									relativePath: "/absolute/path/file.txt",
									content: "malicious content",
								},
							],
						},
					],
				})

				let writtenFiles: string[] = []
				;(fs.readFile as Mock).mockImplementation(async (path: string) => {
					if (path === mockSettingsPath) {
						return yaml.stringify({ customModes: [] })
					}
					throw new Error("File not found")
				})
				;(fs.writeFile as Mock).mockImplementation(async (path: string) => {
					writtenFiles.push(path)
					return Promise.resolve()
				})
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				const result = await manager.importModeWithRules(maliciousYaml)

				expect(result.success).toBe(true)

				// Verify that no files were written outside the .roo directory
				const mockWorkspacePath = path.resolve("/mock/workspace")
				const writtenRuleFiles = writtenFiles.filter((p) => !p.includes(".roomodes"))
				writtenRuleFiles.forEach((filePath) => {
					const normalizedPath = path.normalize(filePath)
					const expectedBasePath = path.normalize(path.join(mockWorkspacePath, ".roo"))
					expect(normalizedPath.startsWith(expectedBasePath)).toBe(true)
				})

				// Verify that malicious paths were not written
				expect(writtenFiles.some((p) => p.includes("etc/passwd"))).toBe(false)
				expect(writtenFiles.some((p) => p.includes("sensitive.txt"))).toBe(false)
				expect(writtenFiles.some((p) => path.isAbsolute(p) && !p.startsWith(mockWorkspacePath))).toBe(false)
			})

			it("should handle malformed YAML gracefully", async () => {
				const malformedYaml = `
	customModes:
			- slug: test-mode
			  name: Test Mode
			  roleDefinition: Test Role
			  groups: [read
			    invalid yaml here
				`

				const result = await manager.importModeWithRules(malformedYaml)

				expect(result.success).toBe(false)
				expect(result.error).toContain("Invalid YAML format")
			})

			it("should validate mode configuration during import", async () => {
				const invalidModeYaml = yaml.stringify({
					customModes: [
						{
							slug: "test-mode",
							name: "", // Invalid: empty name
							roleDefinition: "", // Invalid: empty role definition
							groups: ["invalid-group"], // Invalid group
						},
					],
				})

				const result = await manager.importModeWithRules(invalidModeYaml)

				expect(result.success).toBe(false)
				expect(result.error).toContain("Invalid mode configuration")
			})

			it("should remove existing rules folder when importing mode without rules", async () => {
				const importYaml = yaml.stringify({
					customModes: [
						{
							slug: "test-mode",
							name: "Test Mode",
							roleDefinition: "Test Role",
							groups: ["read"],
							// No rulesFiles property - this mode has no rules
						},
					],
				})

				let roomodesContent: any = null
				;(fs.readFile as Mock).mockImplementation(async (path: string) => {
					if (path === mockSettingsPath) {
						return yaml.stringify({ customModes: [] })
					}
					if (path === mockRoomodes && roomodesContent) {
						return yaml.stringify(roomodesContent)
					}
					throw new Error("File not found")
				})
				;(fs.writeFile as Mock).mockImplementation(async (path: string, content: string) => {
					if (path === mockRoomodes) {
						roomodesContent = yaml.parse(content)
					}
					return Promise.resolve()
				})
				;(fs.rm as Mock).mockResolvedValue(undefined)

				const result = await manager.importModeWithRules(importYaml)

				expect(result.success).toBe(true)

				// Verify that fs.rm was called to remove the existing rules folder
				expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining(path.join(".roo", "rules-test-mode")), {
					recursive: true,
					force: true,
				})

				// Verify mode was imported
				expect(fs.writeFile).toHaveBeenCalledWith(
					expect.stringContaining(".roomodes"),
					expect.stringContaining("test-mode"),
					"utf-8",
				)
			})

			it("should remove existing rules folder and create new ones when importing mode with rules", async () => {
				const importYaml = yaml.stringify({
					customModes: [
						{
							slug: "test-mode",
							name: "Test Mode",
							roleDefinition: "Test Role",
							groups: ["read"],
							rulesFiles: [
								{
									relativePath: "rules-test-mode/new-rule.md",
									content: "New rule content",
								},
							],
						},
					],
				})

				let roomodesContent: any = null
				let writtenFiles: Record<string, string> = {}
				;(fs.readFile as Mock).mockImplementation(async (path: string) => {
					if (path === mockSettingsPath) {
						return yaml.stringify({ customModes: [] })
					}
					if (path === mockRoomodes && roomodesContent) {
						return yaml.stringify(roomodesContent)
					}
					throw new Error("File not found")
				})
				;(fs.writeFile as Mock).mockImplementation(async (path: string, content: string) => {
					if (path === mockRoomodes) {
						roomodesContent = yaml.parse(content)
					} else {
						writtenFiles[path] = content
					}
					return Promise.resolve()
				})
				;(fs.rm as Mock).mockResolvedValue(undefined)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				const result = await manager.importModeWithRules(importYaml)

				expect(result.success).toBe(true)

				// Verify that fs.rm was called to remove the existing rules folder
				expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining(path.join(".roo", "rules-test-mode")), {
					recursive: true,
					force: true,
				})

				// Verify new rules files were created
				expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("rules-test-mode"), { recursive: true })

				// Verify file contents
				const newRulePath = Object.keys(writtenFiles).find((p) => p.includes("new-rule.md"))
				expect(writtenFiles[newRulePath!]).toBe("New rule content")
			})
		})
	})

	describe("checkRulesDirectoryHasContent", () => {
		it("should return false when no workspace is available", async () => {
			;(getWorkspacePath as Mock).mockReturnValue(null)

			const result = await manager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(false)
		})

		it("should return false when mode is not in .roomodes file", async () => {
			const roomodesContent = { customModes: [{ slug: "other-mode", name: "Other Mode" }] }
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				throw new Error("File not found")
			})

			const result = await manager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(false)
		})

		it("should return false when .roomodes doesn't exist and mode is not a custom mode", async () => {
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			})

			const result = await manager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(false)
		})

		it("should return false when rules directory doesn't exist", async () => {
			const roomodesContent = { customModes: [{ slug: "test-mode", name: "Test Mode" }] }
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockRejectedValue(new Error("Directory not found"))

			const result = await manager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(false)
		})

		it("should return false when rules directory is empty", async () => {
			const roomodesContent = { customModes: [{ slug: "test-mode", name: "Test Mode" }] }
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([])

			const result = await manager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(false)
		})

		it("should return true when rules directory has content files", async () => {
			const roomodesContent = { customModes: [{ slug: "test-mode", name: "Test Mode" }] }
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				if (path.includes("rules-test-mode")) {
					return "Some rule content"
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([
				{ name: "rule1.md", isFile: () => true, parentPath: "/mock/workspace/.roo/rules-test-mode" },
			])

			const result = await manager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(true)
		})

		it("should work with global custom modes when .roomodes doesn't exist", async () => {
			const settingsContent = {
				customModes: [{ slug: "test-mode", name: "Test Mode", groups: ["read"], roleDefinition: "Test Role" }],
			}

			// Create a fresh manager instance to avoid cache issues
			const freshManager = new CustomModesManager(mockContext, mockOnUpdate)

			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath // .roomodes doesn't exist
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify(settingsContent)
				}
				if (path.includes("rules-test-mode")) {
					return "Some rule content"
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([
				{ name: "rule1.md", isFile: () => true, parentPath: "/mock/workspace/.roo/rules-test-mode" },
			])

			const result = await freshManager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(true)
		})
	})

	describe("exportModeWithRules", () => {
		it("should return error when no workspace is available", async () => {
			// Create a fresh manager instance to avoid cache issues
			const freshManager = new CustomModesManager(mockContext, mockOnUpdate)

			// Mock no workspace folders
			;(vscode.workspace as any).workspaceFolders = []
			;(getWorkspacePath as Mock).mockReturnValue(null)
			;(fileExistsAtPath as Mock).mockResolvedValue(false)
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			})

			const result = await freshManager.exportModeWithRules("test-mode")

			expect(result.success).toBe(false)
			expect(result.error).toBe("No workspace found")
		})

		it("should return error when mode is not found", async () => {
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			})
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})

			const result = await manager.exportModeWithRules("test-mode")

			expect(result.success).toBe(false)
			expect(result.error).toBe("Mode not found")
		})

		it("should successfully export mode without rules when rules directory doesn't exist", async () => {
			const roomodesContent = {
				customModes: [{ slug: "test-mode", name: "Test Mode", roleDefinition: "Test Role", groups: ["read"] }],
			}
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockRejectedValue(new Error("Directory not found"))

			const result = await manager.exportModeWithRules("test-mode")

			expect(result.success).toBe(true)
			expect(result.yaml).toContain("test-mode")
			expect(result.yaml).toContain("Test Mode")
		})

		it("should successfully export mode without rules when no rule files are found", async () => {
			const roomodesContent = {
				customModes: [{ slug: "test-mode", name: "Test Mode", roleDefinition: "Test Role", groups: ["read"] }],
			}
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([])

			const result = await manager.exportModeWithRules("test-mode")

			expect(result.success).toBe(true)
			expect(result.yaml).toContain("test-mode")
		})

		it("should successfully export mode with rules for a custom mode in .roomodes", async () => {
			const roomodesContent = {
				customModes: [
					{
						slug: "test-mode",
						name: "Test Mode",
						roleDefinition: "Test Role",
						groups: ["read"],
						customInstructions: "Existing instructions",
					},
				],
			}

			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				if (path.includes("rules-test-mode")) {
					return "New rule content from files"
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([
				{ name: "rule1.md", isFile: () => true, parentPath: "/mock/workspace/.roo/rules-test-mode" },
			])

			const result = await manager.exportModeWithRules("test-mode")

			expect(result.success).toBe(true)
			expect(result.yaml).toContain("test-mode")
			expect(result.yaml).toContain("Existing instructions")
			expect(result.yaml).toContain("New rule content from files")
			// Should NOT delete the rules directory
			expect(fs.rm).not.toHaveBeenCalled()
		})

		it("should successfully export mode with rules for a built-in mode customized in .roomodes", async () => {
			const roomodesContent = {
				customModes: [
					{
						slug: "code",
						name: "Custom Code Mode",
						roleDefinition: "Custom Role",
						groups: ["read"],
					},
				],
			}

			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				if (path.includes("rules-code")) {
					return "Custom rules for code mode"
				}
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([
				{ name: "rule1.md", isFile: () => true, parentPath: "/mock/workspace/.roo/rules-code" },
			])

			const result = await manager.exportModeWithRules("code")

			expect(result.success).toBe(true)
			expect(result.yaml).toContain("Custom Code Mode")
			expect(result.yaml).toContain("Custom rules for code mode")
			// Should NOT delete the rules directory
			expect(fs.rm).not.toHaveBeenCalled()
		})

		it("should handle file read errors gracefully", async () => {
			const roomodesContent = {
				customModes: [
					{
						slug: "test-mode",
						name: "Test Mode",
						roleDefinition: "Test Role",
						groups: ["read"],
					},
				],
			}

			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				if (path.includes("rules-test-mode")) {
					throw new Error("Permission denied")
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([
				{ name: "rule1.md", isFile: () => true, parentPath: "/mock/workspace/.roo/rules-test-mode" },
			])

			const result = await manager.exportModeWithRules("test-mode")

			// Should still succeed even if file read fails
			expect(result.success).toBe(true)
			expect(result.yaml).toContain("test-mode")
		})
	})
})
