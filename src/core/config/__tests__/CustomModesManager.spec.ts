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

vi.mock("fs/promises")

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
	const mockRoomodes = `${path.sep}mock${path.sep}workspace${path.sep}.roomodes`

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

		mockWorkspaceFolders = [{ uri: { fsPath: "/mock/workspace" } }]
		;(vscode.workspace as any).workspaceFolders = mockWorkspaceFolders
		;(vscode.workspace.onDidSaveTextDocument as Mock).mockReturnValue({ dispose: vi.fn() })
		;(getWorkspacePath as Mock).mockReturnValue("/mock/workspace")
		;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
			return path === mockSettingsPath || path === mockRoomodes
		})
		;(fs.mkdir as Mock).mockResolvedValue(undefined)
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
	})
})
