import { MarketplaceManager } from "../MarketplaceManager"
import { vi } from "vitest"

// Mock dependencies for vitest
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
}))
vi.mock("yaml", () => ({
	parse: vi.fn(),
}))
vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [
			{
				uri: { fsPath: "/test/workspace" },
			},
		],
		openTextDocument: vi.fn(),
	},
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showTextDocument: vi.fn(),
	},
	Range: class MockRange {
		start: { line: number; character: number }
		end: { line: number; character: number }

		constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
			this.start = { line: startLine, character: startCharacter }
			this.end = { line: endLine, character: endCharacter }
		}
	},
}))
vi.mock("../../../shared/globalFileNames", () => ({
	GlobalFileNames: {
		mcpSettings: "mcp_settings.json",
		customModes: "custom_modes.yaml",
	},
}))
vi.mock("../../../utils/globalContext", () => ({
	ensureSettingsDirectoryExists: vi.fn().mockResolvedValue("/mock/global/settings"),
}))

// Import the mocked modules
import * as fs from "fs/promises"
import * as yaml from "yaml"

const mockFs = fs as any
const mockYaml = yaml as any

// Create a mock vscode module for type safety
const mockVscode = {
	workspace: {
		workspaceFolders: [
			{
				uri: { fsPath: "/test/workspace" },
			},
		],
	},
} as any

describe("MarketplaceManager", () => {
	let marketplaceManager: MarketplaceManager
	let mockContext: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Mock VSCode workspace
		mockVscode.workspace = {
			workspaceFolders: [
				{
					uri: { fsPath: "/test/workspace" },
				},
			],
		} as any

		// Mock extension context
		mockContext = {} as any

		marketplaceManager = new MarketplaceManager(mockContext)
	})

	describe("getInstallationMetadata", () => {
		it("should return empty metadata when no config files exist", async () => {
			// Mock file read failures (files don't exist)
			mockFs.readFile.mockRejectedValue(new Error("ENOENT: no such file or directory"))

			const result = await marketplaceManager.getInstallationMetadata()

			expect(result).toEqual({
				project: {},
				global: {},
			})
		})

		it("should parse project MCP configuration correctly", async () => {
			const mockMcpConfig = {
				mcpServers: {
					"test-mcp": {
						command: "node",
						args: ["test.js"],
					},
				},
			}

			mockFs.readFile.mockImplementation((filePath: any) => {
				// Normalize path separators for cross-platform compatibility
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes(".roo/mcp.json")) {
					return Promise.resolve(JSON.stringify(mockMcpConfig))
				}
				return Promise.reject(new Error("ENOENT"))
			})

			const result = await marketplaceManager.getInstallationMetadata()

			expect(result.project["test-mcp"]).toEqual({
				type: "mcp",
			})
		})

		it("should parse project modes configuration correctly", async () => {
			const mockModesConfig = {
				customModes: [
					{
						slug: "test-mode",
						name: "Test Mode",
						description: "A test mode",
					},
				],
			}

			mockFs.readFile.mockImplementation((filePath: any) => {
				// Normalize path separators for cross-platform compatibility
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes(".roomodes")) {
					return Promise.resolve("mock-yaml-content")
				}
				return Promise.reject(new Error("ENOENT"))
			})

			mockYaml.parse.mockReturnValue(mockModesConfig)

			const result = await marketplaceManager.getInstallationMetadata()

			expect(result.project["test-mode"]).toEqual({
				type: "mode",
			})
		})

		it("should parse global configurations correctly", async () => {
			const mockGlobalMcp = {
				mcpServers: {
					"global-mcp": {
						command: "node",
						args: ["global.js"],
					},
				},
			}

			const mockGlobalModes = {
				customModes: [
					{
						slug: "global-mode",
						name: "Global Mode",
						description: "A global mode",
					},
				],
			}

			mockFs.readFile.mockImplementation((filePath: any) => {
				// Normalize path separators for cross-platform compatibility
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes("mcp_settings.json")) {
					return Promise.resolve(JSON.stringify(mockGlobalMcp))
				}
				if (normalizedPath.includes("custom_modes.yaml")) {
					return Promise.resolve("mock-yaml-content")
				}
				return Promise.reject(new Error("ENOENT"))
			})

			mockYaml.parse.mockReturnValue(mockGlobalModes)

			const result = await marketplaceManager.getInstallationMetadata()

			expect(result.global["global-mcp"]).toEqual({
				type: "mcp",
			})
			expect(result.global["global-mode"]).toEqual({
				type: "mode",
			})
		})

		it("should handle mixed project and global installations", async () => {
			const mockProjectMcp = {
				mcpServers: {
					"project-mcp": { command: "node", args: ["project.js"] },
				},
			}

			const mockGlobalModes = {
				customModes: [
					{
						slug: "global-mode",
						name: "Global Mode",
					},
				],
			}

			mockFs.readFile.mockImplementation((filePath: any) => {
				// Normalize path separators for cross-platform compatibility
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes(".roo/mcp.json")) {
					return Promise.resolve(JSON.stringify(mockProjectMcp))
				}
				if (normalizedPath.includes("custom_modes.yaml")) {
					return Promise.resolve("mock-yaml-content")
				}
				return Promise.reject(new Error("ENOENT"))
			})

			mockYaml.parse.mockReturnValue(mockGlobalModes)

			const result = await marketplaceManager.getInstallationMetadata()

			expect(result.project["project-mcp"]).toEqual({
				type: "mcp",
			})
			expect(result.global["global-mode"]).toEqual({
				type: "mode",
			})
		})
	})
})
