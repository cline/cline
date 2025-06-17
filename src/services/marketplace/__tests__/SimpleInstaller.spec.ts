// npx vitest services/marketplace/__tests__/SimpleInstaller.spec.ts

import { SimpleInstaller } from "../SimpleInstaller"
import * as fs from "fs/promises"
import * as yaml from "yaml"
import * as vscode from "vscode"
import type { MarketplaceItem } from "@roo-code/types"
import * as path from "path"

vi.mock("fs/promises")
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

const mockFs = fs as any

describe("SimpleInstaller", () => {
	let installer: SimpleInstaller
	let mockContext: vscode.ExtensionContext

	beforeEach(() => {
		mockContext = {} as vscode.ExtensionContext
		installer = new SimpleInstaller(mockContext)
		vi.clearAllMocks()

		// Mock mkdir to always succeed
		mockFs.mkdir.mockResolvedValue(undefined as any)
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

		it("should install mode when .roomodes file does not exist", async () => {
			// Mock file not found error
			const notFoundError = new Error("File not found") as any
			notFoundError.code = "ENOENT"
			mockFs.readFile.mockRejectedValueOnce(notFoundError)
			mockFs.writeFile.mockResolvedValueOnce(undefined as any)

			const result = await installer.installItem(mockModeItem, { target: "project" })

			expect(result.filePath).toBe(path.join("/test/workspace", ".roomodes"))
			expect(mockFs.writeFile).toHaveBeenCalled()

			// Verify the written content contains the new mode
			const writtenContent = mockFs.writeFile.mock.calls[0][1] as string
			const writtenData = yaml.parse(writtenContent)
			expect(writtenData.customModes).toHaveLength(1)
			expect(writtenData.customModes[0].slug).toBe("test")
		})

		it("should install mode when .roomodes contains valid YAML", async () => {
			const existingContent = yaml.stringify({
				customModes: [{ slug: "existing", name: "Existing Mode", roleDefinition: "Existing", groups: [] }],
			})

			mockFs.readFile.mockResolvedValueOnce(existingContent)
			mockFs.writeFile.mockResolvedValueOnce(undefined as any)

			await installer.installItem(mockModeItem, { target: "project" })

			expect(mockFs.writeFile).toHaveBeenCalled()
			const writtenContent = mockFs.writeFile.mock.calls[0][1] as string
			const writtenData = yaml.parse(writtenContent)

			// Should contain both existing and new mode
			expect(writtenData.customModes).toHaveLength(2)
			expect(writtenData.customModes.find((m: any) => m.slug === "existing")).toBeDefined()
			expect(writtenData.customModes.find((m: any) => m.slug === "test")).toBeDefined()
		})

		it("should throw error when .roomodes contains invalid YAML", async () => {
			const invalidYaml = "invalid: yaml: content: {"

			mockFs.readFile.mockResolvedValueOnce(invalidYaml)

			await expect(installer.installItem(mockModeItem, { target: "project" })).rejects.toThrow(
				"Cannot install mode: The .roomodes file contains invalid YAML",
			)

			// Should NOT write to file
			expect(mockFs.writeFile).not.toHaveBeenCalled()
		})

		it("should replace existing mode with same slug", async () => {
			const existingContent = yaml.stringify({
				customModes: [{ slug: "test", name: "Old Test Mode", roleDefinition: "Old role", groups: [] }],
			})

			mockFs.readFile.mockResolvedValueOnce(existingContent)
			mockFs.writeFile.mockResolvedValueOnce(undefined as any)

			await installer.installItem(mockModeItem, { target: "project" })

			const writtenContent = mockFs.writeFile.mock.calls[0][1] as string
			const writtenData = yaml.parse(writtenContent)

			// Should contain only one mode with updated content
			expect(writtenData.customModes).toHaveLength(1)
			expect(writtenData.customModes[0].slug).toBe("test")
			expect(writtenData.customModes[0].name).toBe("Test Mode") // New name
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

		it("should throw error when .roomodes contains invalid YAML during removal", async () => {
			const invalidYaml = "invalid: yaml: content: {"

			mockFs.readFile.mockResolvedValueOnce(invalidYaml)

			await expect(installer.removeItem(mockModeItem, { target: "project" })).rejects.toThrow(
				"Cannot remove mode: The .roomodes file contains invalid YAML",
			)

			// Should NOT write to file
			expect(mockFs.writeFile).not.toHaveBeenCalled()
		})

		it("should do nothing when file does not exist", async () => {
			const notFoundError = new Error("File not found") as any
			notFoundError.code = "ENOENT"
			mockFs.readFile.mockRejectedValueOnce(notFoundError)

			// Should not throw
			await installer.removeItem(mockModeItem, { target: "project" })

			expect(mockFs.writeFile).not.toHaveBeenCalled()
		})
	})
})
