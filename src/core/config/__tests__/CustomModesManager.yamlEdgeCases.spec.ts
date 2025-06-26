// npx vitest core/config/__tests__/CustomModesManager.yamlEdgeCases.spec.ts

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

vi.mock("fs/promises")

vi.mock("../../../utils/fs")
vi.mock("../../../utils/path")

describe("CustomModesManager - YAML Edge Cases", () => {
	let manager: CustomModesManager
	let mockContext: vscode.ExtensionContext
	let mockOnUpdate: Mock
	let mockWorkspaceFolders: { uri: { fsPath: string } }[]

	const mockStoragePath = `${path.sep}mock${path.sep}settings`
	const mockSettingsPath = path.join(mockStoragePath, "settings", GlobalFileNames.customModes)
	const mockRoomodes = `${path.sep}mock${path.sep}workspace${path.sep}.roomodes`

	// Helper function to reduce duplication in fs.readFile mocks
	const mockFsReadFile = (files: Record<string, string>) => {
		;(fs.readFile as Mock).mockImplementation(async (path: string) => {
			if (files[path]) return files[path]
			throw new Error("File not found")
		})
	}

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

		// Mock createFileSystemWatcher to prevent file watching in tests
		const mockWatcher = {
			onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			dispose: vi.fn(),
		}
		;(vscode.workspace.createFileSystemWatcher as Mock).mockReturnValue(mockWatcher)

		manager = new CustomModesManager(mockContext, mockOnUpdate)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("BOM (Byte Order Mark) handling", () => {
		it("should handle UTF-8 BOM in YAML files", async () => {
			const yamlWithBOM =
				"\uFEFF" +
				yaml.stringify({
					customModes: [
						{
							slug: "test-mode",
							name: "Test Mode",
							roleDefinition: "Test role",
							groups: ["read"],
						},
					],
				})

			mockFsReadFile({
				[mockRoomodes]: yamlWithBOM,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(1)
			expect(modes[0].slug).toBe("test-mode")
			expect(modes[0].name).toBe("Test Mode")
		})

		it("should handle UTF-16 BOM in YAML files", async () => {
			// When Node.js reads UTF-16 files, the BOM is correctly decoded as \uFEFF
			const yamlWithBOM =
				"\uFEFF" +
				yaml.stringify({
					customModes: [
						{
							slug: "utf16-mode",
							name: "UTF-16 Mode",
							roleDefinition: "Test role",
							groups: ["read"],
						},
					],
				})

			mockFsReadFile({
				[mockRoomodes]: yamlWithBOM,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(1)
			expect(modes[0].slug).toBe("utf16-mode")
		})
	})

	describe("Invisible character handling", () => {
		it("should handle non-breaking spaces in YAML", async () => {
			// YAML with non-breaking spaces (U+00A0) instead of regular spaces
			const yamlWithNonBreakingSpaces = `customModes:
  - slug: "test-mode"
    name: "Test\u00A0Mode"
    roleDefinition: "Test\u00A0role\u00A0with\u00A0non-breaking\u00A0spaces"
    groups: ["read"]`

			mockFsReadFile({
				[mockRoomodes]: yamlWithNonBreakingSpaces,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(1)
			expect(modes[0].name).toBe("Test Mode") // Non-breaking spaces replaced with regular spaces
			expect(modes[0].roleDefinition).toBe("Test role with non-breaking spaces")
		})

		it("should handle zero-width characters", async () => {
			// YAML with zero-width characters
			const yamlWithZeroWidth = `customModes:
  - slug: "test-mode"
    name: "Test\u200BMode\u200C"
    roleDefinition: "Test\u200Drole"
    groups: ["read"]`

			mockFsReadFile({
				[mockRoomodes]: yamlWithZeroWidth,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(1)
			expect(modes[0].name).toBe("TestMode") // Zero-width characters removed
			expect(modes[0].roleDefinition).toBe("Testrole")
		})

		it("should normalize various quote characters", async () => {
			// Use fancy quotes that will be normalized before YAML parsing
			// The fancy quotes will be normalized to standard quotes
			const yamlWithFancyQuotes = yaml.stringify({
				customModes: [
					{
						slug: "test-mode",
						name: "Test Mode",
						roleDefinition: "Test role with \u2018fancy\u2019 quotes and \u201Ccurly\u201D quotes",
						groups: ["read"],
					},
				],
			})

			mockFsReadFile({
				[mockRoomodes]: yamlWithFancyQuotes,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(1)
			expect(modes[0].roleDefinition).toBe("Test role with 'fancy' quotes and \"curly\" quotes")
		})
	})

	// Note: YAML anchor/alias support has been removed to reduce complexity
	// If needed in the future, users should pre-process their YAML files

	describe("Complex fileRegex handling", () => {
		it("should handle complex fileRegex syntax gracefully", async () => {
			const yamlWithComplexFileRegex = yaml.stringify({
				customModes: [
					{
						slug: "test-mode",
						name: "Test Mode",
						roleDefinition: "Test role",
						groups: [
							"read",
							["edit", { fileRegex: "\\.md$", description: "Markdown files only" }],
							"browser",
						],
					},
				],
			})

			mockFsReadFile({
				[mockRoomodes]: yamlWithComplexFileRegex,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			// Should successfully parse the complex fileRegex syntax
			expect(modes).toHaveLength(1)
			expect(modes[0].groups).toHaveLength(3)
			expect(modes[0].groups[1]).toEqual(["edit", { fileRegex: "\\.md$", description: "Markdown files only" }])
		})

		it("should handle invalid fileRegex syntax with clear error", async () => {
			// This YAML has invalid structure that might cause parsing issues
			const invalidYaml = `customModes:
	 - slug: "test-mode"
	   name: "Test Mode"
	   roleDefinition: "Test role"
	   groups:
	     - read
	     - ["edit", { fileRegex: "\\.md$" }]  # This line has invalid YAML syntax
	     - browser`

			mockFsReadFile({
				[mockRoomodes]: invalidYaml,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			// Should handle the error gracefully
			expect(modes).toHaveLength(0)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("customModes.errors.yamlParseError")
		})
	})

	describe("Error messages", () => {
		it("should provide detailed syntax error messages with context", async () => {
			const invalidYaml = `customModes:
	 - slug: "test-mode"
	   name: "Test Mode"
	   roleDefinition: "Test role
	   groups: ["read"]` // Missing closing quote

			mockFsReadFile({
				[mockRoomodes]: invalidYaml,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			// Should fallback to empty array and show detailed error
			expect(modes).toHaveLength(0)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("customModes.errors.yamlParseError")
		})

		it("should provide schema validation error messages", async () => {
			const invalidSchema = yaml.stringify({
				customModes: [
					{
						slug: "test-mode",
						name: "Test Mode",
						// Missing required 'roleDefinition' field
						groups: ["read"],
					},
				],
			})

			mockFsReadFile({
				[mockRoomodes]: invalidSchema,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			// Should show schema validation error
			expect(modes).toHaveLength(0)
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("customModes.errors.schemaValidationError")
		})
	})

	describe("UTF-8 encoding", () => {
		it("should handle special characters and emojis", async () => {
			const yamlWithEmojis = yaml.stringify({
				customModes: [
					{
						slug: "emoji-mode",
						name: "📝 Writing Mode",
						roleDefinition: "A mode for writing with emojis 🚀",
						groups: ["read", "edit"],
					},
				],
			})

			mockFsReadFile({
				[mockRoomodes]: yamlWithEmojis,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(1)
			expect(modes[0].name).toBe("📝 Writing Mode")
			expect(modes[0].roleDefinition).toBe("A mode for writing with emojis 🚀")
		})

		it("should handle various international characters", async () => {
			const yamlWithInternational = yaml.stringify({
				customModes: [
					{
						slug: "intl-mode",
						name: "Mode Français",
						roleDefinition: "Mode für Deutsch, 日本語モード, Режим русский",
						groups: ["read"],
					},
				],
			})

			mockFsReadFile({
				[mockRoomodes]: yamlWithInternational,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(1)
			expect(modes[0].roleDefinition).toContain("für Deutsch")
			expect(modes[0].roleDefinition).toContain("日本語モード")
			expect(modes[0].roleDefinition).toContain("Режим русский")
		})
	})

	describe("Additional edge cases", () => {
		it("should handle mixed line endings (CRLF vs LF)", async () => {
			// YAML with mixed line endings
			const yamlWithMixedLineEndings =
				"customModes:\r\n" +
				'  - slug: "test-mode"\n' +
				'    name: "Test Mode"\r\n' +
				'    roleDefinition: "Test role with mixed line endings"\n' +
				'    groups: ["read"]'

			mockFsReadFile({
				[mockRoomodes]: yamlWithMixedLineEndings,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(1)
			expect(modes[0].slug).toBe("test-mode")
			expect(modes[0].roleDefinition).toBe("Test role with mixed line endings")
		})

		it("should handle multiple BOMs in sequence", async () => {
			// File with multiple BOMs (edge case from file concatenation)
			const yamlWithMultipleBOMs =
				"\uFEFF\uFEFF" +
				yaml.stringify({
					customModes: [
						{
							slug: "multi-bom-mode",
							name: "Multi BOM Mode",
							roleDefinition: "Test role",
							groups: ["read"],
						},
					],
				})

			mockFsReadFile({
				[mockRoomodes]: yamlWithMultipleBOMs,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(1)
			expect(modes[0].slug).toBe("multi-bom-mode")
		})

		it("should handle deeply nested structures with edge case characters", async () => {
			const yamlWithComplexNesting = yaml.stringify({
				customModes: [
					{
						slug: "complex-mode",
						name: "Complex\u00A0Mode\u2019s Name",
						roleDefinition: "Complex role with \u201Cquotes\u201D and \u2014dashes\u2014",
						groups: [
							"read",
							[
								"edit",
								{
									fileRegex: "\\.md$",
									description: "Markdown files with \u2018special\u2019 chars",
								},
							],
							[
								"browser",
								{
									fileRegex: "\\.html?$",
									description: "HTML files\u00A0only",
								},
							],
						],
					},
				],
			})

			mockFsReadFile({
				[mockRoomodes]: yamlWithComplexNesting,
				[mockSettingsPath]: yaml.stringify({ customModes: [] }),
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(1)
			expect(modes[0].name).toBe("Complex Mode's Name")
			expect(modes[0].roleDefinition).toBe('Complex role with "quotes" and -dashes-')
			expect(modes[0].groups[1]).toEqual([
				"edit",
				{
					fileRegex: "\\.md$",
					description: "Markdown files with 'special' chars",
				},
			])
			expect(modes[0].groups[2]).toEqual([
				"browser",
				{
					fileRegex: "\\.html?$",
					description: "HTML files only",
				},
			])
		})
	})
})
