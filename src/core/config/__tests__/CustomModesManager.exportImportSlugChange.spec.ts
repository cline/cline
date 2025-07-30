// npx vitest core/config/__tests__/CustomModesManager.exportImportSlugChange.spec.ts

import type { Mock } from "vitest"

import * as path from "path"
import * as fs from "fs/promises"

import * as yaml from "yaml"
import * as vscode from "vscode"

import type { ModeConfig } from "@roo-code/types"

import { fileExistsAtPath } from "../../../utils/fs"
import { getWorkspacePath } from "../../../utils/path"
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

describe("CustomModesManager - Export/Import with Slug Changes", () => {
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

	describe("Export Path Calculation", () => {
		it("should exclude rules-{slug} folder from exported relative paths", async () => {
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
				if (path.includes("rules-test-mode") && path.includes("rule1.md")) {
					return "Rule 1 content"
				}
				if (path.includes("rules-test-mode") && path.includes("subfolder") && path.includes("rule2.md")) {
					return "Rule 2 content"
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([
				{ name: "rule1.md", isFile: () => true },
				{ name: "subfolder", isFile: () => false, isDirectory: () => true },
			])

			const result = await manager.exportModeWithRules("test-mode")

			expect(result.success).toBe(true)
			const exportData = yaml.parse(result.yaml!)
			const rulesFiles = exportData.customModes[0].rulesFiles

			// Verify that paths do NOT include rules-test-mode folder
			expect(rulesFiles).toBeDefined()
			expect(rulesFiles.length).toBeGreaterThan(0)

			// Check that no path starts with rules-test-mode
			rulesFiles.forEach((file: any) => {
				expect(file.relativePath).not.toMatch(/^rules-test-mode[\/\\]/)
			})

			// Verify the actual paths are just the file names (without rules folder)
			const paths = rulesFiles.map((f: any) => f.relativePath)
			expect(paths).toContain("rule1.md")
		})

		it("should handle files at root level correctly", async () => {
			const roomodesContent = {
				customModes: [
					{
						slug: "root-mode",
						name: "Root Mode",
						roleDefinition: "Root Role",
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
				if (path.includes("rules-root-mode") && path.includes("file1.md")) {
					return "File 1 content"
				}
				if (path.includes("rules-root-mode") && path.includes("file2.md")) {
					return "File 2 content"
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([
				{ name: "file1.md", isFile: () => true },
				{ name: "file2.md", isFile: () => true },
				{ name: "subfolder", isFile: () => false }, // This will be ignored by current implementation
			])

			const result = await manager.exportModeWithRules("root-mode")

			expect(result.success).toBe(true)
			const exportData = yaml.parse(result.yaml!)
			const rulesFiles = exportData.customModes[0].rulesFiles

			// Verify files are exported without rules-root-mode prefix
			expect(rulesFiles).toBeDefined()
			expect(rulesFiles.length).toBe(2)

			const paths = rulesFiles.map((f: any) => f.relativePath)
			expect(paths).toContain("file1.md")
			expect(paths).toContain("file2.md")

			// Verify no path contains the rules folder name
			rulesFiles.forEach((file: any) => {
				expect(file.relativePath).not.toContain("rules-root-mode")
			})
		})
	})

	describe("Import with Slug Changes", () => {
		it("should place files in rules-{new-slug} folder when slug is changed", async () => {
			// Import YAML with new format (no rules folder in path)
			const importYaml = yaml.stringify({
				customModes: [
					{
						slug: "new-slug-name", // Changed slug
						name: "Imported Mode",
						roleDefinition: "Imported Role",
						groups: ["read"],
						rulesFiles: [
							{
								relativePath: "rule1.md", // New format without rules folder
								content: "Rule 1 content",
							},
							{
								relativePath: "subfolder/rule2.md",
								content: "Rule 2 content",
							},
						],
					},
				],
			})

			let writtenFiles: Record<string, string> = {}
			let createdDirs: string[] = []

			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			})
			;(fs.writeFile as Mock).mockImplementation(async (path: string, content: string) => {
				writtenFiles[path] = content
				return Promise.resolve()
			})
			;(fs.mkdir as Mock).mockImplementation(async (path: string) => {
				createdDirs.push(path)
				return Promise.resolve()
			})

			const result = await manager.importModeWithRules(importYaml)

			expect(result.success).toBe(true)

			// Verify files were written to the correct new slug folder
			const rule1Path = Object.keys(writtenFiles).find((p) => p.includes("rule1.md") && !p.includes(".roomodes"))
			const rule2Path = Object.keys(writtenFiles).find((p) => p.includes("rule2.md") && !p.includes(".roomodes"))

			expect(rule1Path).toBeDefined()
			expect(rule2Path).toBeDefined()

			// Check that files are in rules-new-slug-name folder
			expect(rule1Path).toContain(path.join(".roo", "rules-new-slug-name", "rule1.md"))
			expect(rule2Path).toContain(path.join(".roo", "rules-new-slug-name", "subfolder", "rule2.md"))

			// Verify directories were created with new slug
			expect(createdDirs.some((dir) => dir.includes("rules-new-slug-name"))).toBe(true)
		})

		it("should handle old format (with rules-{slug} in path) for backwards compatibility", async () => {
			// Import YAML with old format (includes rules folder in path)
			const importYaml = yaml.stringify({
				customModes: [
					{
						slug: "new-slug-name", // Changed slug
						name: "Imported Mode",
						roleDefinition: "Imported Role",
						groups: ["read"],
						rulesFiles: [
							{
								relativePath: "rules-old-slug/rule1.md", // Old format with rules folder
								content: "Rule 1 content",
							},
							{
								relativePath: "rules-old-slug/subfolder/rule2.md",
								content: "Rule 2 content",
							},
						],
					},
				],
			})

			let writtenFiles: Record<string, string> = {}

			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			})
			;(fs.writeFile as Mock).mockImplementation(async (path: string, content: string) => {
				writtenFiles[path] = content
				return Promise.resolve()
			})

			const result = await manager.importModeWithRules(importYaml)

			expect(result.success).toBe(true)

			// Verify files were written to the NEW slug folder, not the old one
			const rule1Path = Object.keys(writtenFiles).find((p) => p.includes("rule1.md") && !p.includes(".roomodes"))
			const rule2Path = Object.keys(writtenFiles).find((p) => p.includes("rule2.md") && !p.includes(".roomodes"))

			expect(rule1Path).toBeDefined()
			expect(rule2Path).toBeDefined()

			// Check that files are in rules-new-slug-name folder (not rules-old-slug)
			expect(rule1Path).toContain(path.join(".roo", "rules-new-slug-name", "rule1.md"))
			expect(rule2Path).toContain(path.join(".roo", "rules-new-slug-name", "subfolder", "rule2.md"))

			// Ensure old slug folder was NOT created
			expect(rule1Path).not.toContain("rules-old-slug")
			expect(rule2Path).not.toContain("rules-old-slug")
		})

		it("should handle mixed format paths correctly", async () => {
			// Import YAML with mixed formats
			const importYaml = yaml.stringify({
				customModes: [
					{
						slug: "mixed-mode",
						name: "Mixed Mode",
						roleDefinition: "Mixed Role",
						groups: ["read"],
						rulesFiles: [
							{
								relativePath: "rules-old-slug/old-format.md", // Old format
								content: "Old format content",
							},
							{
								relativePath: "new-format.md", // New format
								content: "New format content",
							},
							{
								relativePath: "rules-another-old/nested/file.md", // Old format nested
								content: "Nested old format",
							},
						],
					},
				],
			})

			let writtenFiles: Record<string, string> = {}

			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			})
			;(fs.writeFile as Mock).mockImplementation(async (path: string, content: string) => {
				writtenFiles[path] = content
				return Promise.resolve()
			})

			const result = await manager.importModeWithRules(importYaml)

			expect(result.success).toBe(true)

			// All files should be in rules-mixed-mode folder
			const oldFormatPath = Object.keys(writtenFiles).find((p) => p.includes("old-format.md"))
			const newFormatPath = Object.keys(writtenFiles).find((p) => p.includes("new-format.md"))
			const nestedPath = Object.keys(writtenFiles).find((p) => p.includes(path.join("nested", "file.md")))

			expect(oldFormatPath).toContain(path.join(".roo", "rules-mixed-mode", "old-format.md"))
			expect(newFormatPath).toContain(path.join(".roo", "rules-mixed-mode", "new-format.md"))
			expect(nestedPath).toContain(path.join(".roo", "rules-mixed-mode", "nested", "file.md"))
		})
	})

	describe("End-to-End Export/Import with Slug Change", () => {
		it("should successfully export and re-import with a different slug", async () => {
			// Step 1: Set up a mode with rules
			const originalMode = {
				slug: "original-mode",
				name: "Original Mode",
				roleDefinition: "Original Role",
				groups: ["read"],
			}

			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify({ customModes: [originalMode] })
				}
				if (path.includes("rules-original-mode") && path.includes("rule.md")) {
					return "Original rule content"
				}
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([{ name: "rule.md", isFile: () => true }])

			// Step 2: Export the mode
			const exportResult = await manager.exportModeWithRules("original-mode")
			expect(exportResult.success).toBe(true)

			// Step 3: Modify the exported YAML to change the slug
			const exportData = yaml.parse(exportResult.yaml!)
			exportData.customModes[0].slug = "renamed-mode"
			exportData.customModes[0].name = "Renamed Mode"
			const modifiedYaml = yaml.stringify(exportData)

			// Step 4: Import with the new slug
			let writtenFiles: Record<string, string> = {}
			;(fs.writeFile as Mock).mockImplementation(async (path: string, content: string) => {
				writtenFiles[path] = content
				return Promise.resolve()
			})

			const importResult = await manager.importModeWithRules(modifiedYaml)
			expect(importResult.success).toBe(true)

			// Step 5: Verify the rule file was placed in the new slug folder
			const ruleFilePath = Object.keys(writtenFiles).find(
				(p) => p.includes("rule.md") && !p.includes(".roomodes"),
			)
			expect(ruleFilePath).toBeDefined()
			expect(ruleFilePath).toContain(path.join(".roo", "rules-renamed-mode", "rule.md"))
			expect(ruleFilePath).not.toContain("rules-original-mode")

			// Verify content was preserved
			expect(writtenFiles[ruleFilePath!]).toBe("Original rule content")
		})
	})
})
