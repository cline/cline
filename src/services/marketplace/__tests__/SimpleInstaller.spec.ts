// npx vitest services/marketplace/__tests__/SimpleInstaller.spec.ts

import { SimpleInstaller } from "../SimpleInstaller"
import * as fs from "fs/promises"
import * as yaml from "yaml"
import * as vscode from "vscode"
import * as os from "os"
import type { MarketplaceItem } from "@roo-code/types"
import type { CustomModesManager } from "../../../core/config/CustomModesManager"
import * as path from "path"
import { fileExistsAtPath } from "../../../utils/fs"

vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rm: vi.fn(),
}))
vi.mock("os")
vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [
			{
				uri: { fsPath: "/test/workspace" },
				name: "test",
				index: 0,
			},
		],
	},
}))
vi.mock("../../../utils/globalContext")
vi.mock("../../../utils/fs")

const mockFs = vi.mocked(fs)

describe("SimpleInstaller", () => {
	let installer: SimpleInstaller
	let mockContext: vscode.ExtensionContext
	let mockCustomModesManager: CustomModesManager

	beforeEach(() => {
		mockContext = {} as vscode.ExtensionContext
		mockCustomModesManager = {
			deleteCustomMode: vi.fn().mockResolvedValue(undefined),
			importModeWithRules: vi.fn().mockResolvedValue({ success: true }),
			getCustomModes: vi.fn().mockResolvedValue([]),
		} as any
		installer = new SimpleInstaller(mockContext, mockCustomModesManager)
		vi.clearAllMocks()

		// Mock mkdir to always succeed
		mockFs.mkdir.mockResolvedValue(undefined as any)
		// Mock rm to always succeed
		mockFs.rm.mockResolvedValue(undefined as any)
		// Mock os.homedir
		vi.mocked(os.homedir).mockReturnValue("/home/user")
		// Mock fileExistsAtPath to return false by default
		vi.mocked(fileExistsAtPath).mockResolvedValue(false)
	})

	describe("installMode", () => {
		const mockModeItem: MarketplaceItem = {
			id: "test-mode",
			name: "Test Mode",
			description: "A test mode for testing",
			type: "mode",
			content: yaml.stringify({
				slug: "test",
				name: "Test Mode",
				roleDefinition: "Test role",
				groups: ["read"],
			}),
		}

		it("should install mode using CustomModesManager", async () => {
			// Mock file not found error for getModeFilePath
			const notFoundError = new Error("File not found") as any
			notFoundError.code = "ENOENT"
			mockFs.readFile.mockRejectedValueOnce(notFoundError)

			const result = await installer.installItem(mockModeItem, { target: "project" })

			expect(result.filePath).toBe(path.join("/test/workspace", ".roomodes"))
			expect(mockCustomModesManager.importModeWithRules).toHaveBeenCalled()

			// Verify the import was called with correct YAML structure
			const importCall = (mockCustomModesManager.importModeWithRules as any).mock.calls[0]
			const importedYaml = importCall[0]
			const importedData = yaml.parse(importedYaml)
			expect(importedData.customModes).toHaveLength(1)
			expect(importedData.customModes[0].slug).toBe("test")
		})

		it("should handle import failure from CustomModesManager", async () => {
			mockCustomModesManager.importModeWithRules = vi.fn().mockResolvedValue({
				success: false,
				error: "Import failed",
			})

			await expect(installer.installItem(mockModeItem, { target: "project" })).rejects.toThrow("Import failed")
		})

		it("should throw error for array content in mode", async () => {
			const arrayContentMode: MarketplaceItem = {
				...mockModeItem,
				content: ["content1", "content2"] as any,
			}

			await expect(installer.installItem(arrayContentMode, { target: "project" })).rejects.toThrow(
				"Mode content should not be an array",
			)
		})

		it("should throw error for missing content", async () => {
			const noContentMode: MarketplaceItem = {
				...mockModeItem,
				content: undefined as any,
			}

			await expect(installer.installItem(noContentMode, { target: "project" })).rejects.toThrow(
				"Mode item missing content",
			)
		})

		it("should work without CustomModesManager (fallback)", async () => {
			const installerWithoutManager = new SimpleInstaller(mockContext)

			// Mock file not found
			const notFoundError = new Error("File not found") as any
			notFoundError.code = "ENOENT"
			mockFs.readFile.mockRejectedValueOnce(notFoundError)
			mockFs.writeFile.mockResolvedValueOnce(undefined as any)

			const result = await installerWithoutManager.installItem(mockModeItem, { target: "project" })

			expect(result.filePath).toBe(path.join("/test/workspace", ".roomodes"))
			expect(mockFs.writeFile).toHaveBeenCalled()
		})
	})

	describe("installMcp", () => {
		const mockMcpItem: MarketplaceItem = {
			id: "test-mcp",
			name: "Test MCP",
			description: "A test MCP server for testing",
			type: "mcp",
			url: "https://example.com/mcp",
			content: JSON.stringify({
				command: "test-server",
				args: ["--test"],
			}),
		}

		it("should install MCP when mcp.json file does not exist", async () => {
			const notFoundError = new Error("File not found") as any
			notFoundError.code = "ENOENT"
			mockFs.readFile.mockRejectedValueOnce(notFoundError)
			mockFs.writeFile.mockResolvedValueOnce(undefined as any)

			const result = await installer.installItem(mockMcpItem, { target: "project" })

			expect(result.filePath).toBe(path.join("/test/workspace", ".roo", "mcp.json"))
			expect(mockFs.writeFile).toHaveBeenCalled()

			// Verify the written content contains the new server
			const writtenContent = mockFs.writeFile.mock.calls[0][1] as string
			const writtenData = JSON.parse(writtenContent)
			expect(writtenData.mcpServers["test-mcp"]).toBeDefined()
		})

		it("should throw error when mcp.json contains invalid JSON", async () => {
			const invalidJson = '{ "mcpServers": { invalid json'

			mockFs.readFile.mockResolvedValueOnce(invalidJson)

			await expect(installer.installItem(mockMcpItem, { target: "project" })).rejects.toThrow(
				"Cannot install MCP server: The .roo/mcp.json file contains invalid JSON",
			)

			// Should NOT write to file
			expect(mockFs.writeFile).not.toHaveBeenCalled()
		})

		it("should install MCP when mcp.json contains valid JSON", async () => {
			const existingContent = JSON.stringify({
				mcpServers: {
					"existing-server": { command: "existing", args: [] },
				},
			})

			mockFs.readFile.mockResolvedValueOnce(existingContent)
			mockFs.writeFile.mockResolvedValueOnce(undefined as any)

			await installer.installItem(mockMcpItem, { target: "project" })

			const writtenContent = mockFs.writeFile.mock.calls[0][1] as string
			const writtenData = JSON.parse(writtenContent)

			// Should contain both existing and new server
			expect(Object.keys(writtenData.mcpServers)).toHaveLength(2)
			expect(writtenData.mcpServers["existing-server"]).toBeDefined()
			expect(writtenData.mcpServers["test-mcp"]).toBeDefined()
		})
	})

	describe("removeMode", () => {
		const mockModeItem: MarketplaceItem = {
			id: "test-mode",
			name: "Test Mode",
			description: "A test mode for testing",
			type: "mode",
			content: yaml.stringify({
				slug: "test",
				name: "Test Mode",
				roleDefinition: "Test role",
				groups: ["read"],
			}),
		}

		it("should use CustomModesManager to delete mode and clean up rules folder", async () => {
			// Mock that the mode exists with project source
			vi.mocked(mockCustomModesManager.getCustomModes).mockResolvedValueOnce([
				{ slug: "test", name: "Test Mode", source: "project" } as any,
			])

			await installer.removeItem(mockModeItem, { target: "project" })

			// Should call deleteCustomMode with fromMarketplace flag set to true
			expect(mockCustomModesManager.deleteCustomMode).toHaveBeenCalledWith("test", true)
			// The rules folder deletion is now handled by CustomModesManager, not SimpleInstaller
			expect(fileExistsAtPath).not.toHaveBeenCalled()
			expect(mockFs.rm).not.toHaveBeenCalled()
		})

		it("should handle global mode removal with rules cleanup", async () => {
			// Mock that the mode exists with global source
			vi.mocked(mockCustomModesManager.getCustomModes).mockResolvedValueOnce([
				{ slug: "test", name: "Test Mode", source: "global" } as any,
			])

			await installer.removeItem(mockModeItem, { target: "global" })

			// Should call deleteCustomMode with fromMarketplace flag set to true
			expect(mockCustomModesManager.deleteCustomMode).toHaveBeenCalledWith("test", true)
			// The rules folder deletion is now handled by CustomModesManager, not SimpleInstaller
			expect(fileExistsAtPath).not.toHaveBeenCalled()
			expect(mockFs.rm).not.toHaveBeenCalled()
		})

		it("should handle case when rules folder does not exist", async () => {
			// Mock that the mode exists
			vi.mocked(mockCustomModesManager.getCustomModes).mockResolvedValueOnce([
				{ slug: "test", name: "Test Mode", source: "project" } as any,
			])

			await installer.removeItem(mockModeItem, { target: "project" })

			// Should call deleteCustomMode with fromMarketplace flag set to true
			expect(mockCustomModesManager.deleteCustomMode).toHaveBeenCalledWith("test", true)
			// The rules folder deletion is now handled by CustomModesManager, not SimpleInstaller
			expect(fileExistsAtPath).not.toHaveBeenCalled()
			expect(mockFs.rm).not.toHaveBeenCalled()
		})

		it("should throw error if deleteCustomMode fails", async () => {
			// Mock that the mode exists
			vi.mocked(mockCustomModesManager.getCustomModes).mockResolvedValueOnce([
				{ slug: "test", name: "Test Mode", source: "project" } as any,
			])
			// Mock that deleteCustomMode fails
			mockCustomModesManager.deleteCustomMode = vi.fn().mockRejectedValueOnce(new Error("Permission denied"))

			// Should throw the error from deleteCustomMode
			await expect(installer.removeItem(mockModeItem, { target: "project" })).rejects.toThrow("Permission denied")

			expect(mockCustomModesManager.deleteCustomMode).toHaveBeenCalledWith("test", true)
		})

		it("should handle mode not found in custom modes list", async () => {
			// Mock that the mode doesn't exist in the list
			vi.mocked(mockCustomModesManager.getCustomModes).mockResolvedValueOnce([])

			await installer.removeItem(mockModeItem, { target: "project" })

			expect(mockCustomModesManager.deleteCustomMode).toHaveBeenCalledWith("test", true)
			// Should not attempt to delete rules folder
			expect(fileExistsAtPath).not.toHaveBeenCalled()
			expect(mockFs.rm).not.toHaveBeenCalled()
		})

		it("should throw error when mode content is invalid YAML", async () => {
			const invalidModeItem: MarketplaceItem = {
				...mockModeItem,
				content: "invalid: yaml: content: {",
			}

			await expect(installer.removeItem(invalidModeItem, { target: "project" })).rejects.toThrow(
				"Invalid mode content: unable to parse YAML",
			)

			expect(mockCustomModesManager.deleteCustomMode).not.toHaveBeenCalled()
		})

		it("should throw error when mode has no slug", async () => {
			const noSlugModeItem: MarketplaceItem = {
				...mockModeItem,
				content: yaml.stringify({
					name: "Test Mode",
					roleDefinition: "Test role",
					groups: ["read"],
				}),
			}

			await expect(installer.removeItem(noSlugModeItem, { target: "project" })).rejects.toThrow(
				"Mode missing slug identifier",
			)

			expect(mockCustomModesManager.deleteCustomMode).not.toHaveBeenCalled()
		})

		it("should handle array content format", async () => {
			const arrayContentItem: MarketplaceItem = {
				...mockModeItem,
				content: [
					{
						content: yaml.stringify({
							slug: "test-array",
							name: "Test Array Mode",
							roleDefinition: "Test role",
							groups: ["read"],
						}),
					},
				] as any,
			}

			await installer.removeItem(arrayContentItem, { target: "project" })

			expect(mockCustomModesManager.deleteCustomMode).toHaveBeenCalledWith("test-array", true)
		})

		it("should throw error when CustomModesManager is not available", async () => {
			const installerWithoutManager = new SimpleInstaller(mockContext)

			await expect(installerWithoutManager.removeItem(mockModeItem, { target: "project" })).rejects.toThrow(
				"CustomModesManager is not available",
			)
		})
	})
})
