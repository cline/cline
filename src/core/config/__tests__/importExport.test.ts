// npx jest src/core/config/__tests__/importExport.test.ts

import fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"

import { ProviderName } from "../../../schemas"
import { importSettings, exportSettings } from "../importExport"
import { ProviderSettingsManager } from "../ProviderSettingsManager"
import { ContextProxy } from "../ContextProxy"

// Mock VSCode modules
jest.mock("vscode", () => ({
	window: {
		showOpenDialog: jest.fn(),
		showSaveDialog: jest.fn(),
	},
	Uri: {
		file: jest.fn((filePath) => ({ fsPath: filePath })),
	},
}))

// Mock fs/promises
jest.mock("fs/promises", () => ({
	readFile: jest.fn(),
	mkdir: jest.fn(),
	writeFile: jest.fn(),
}))

// Mock os module
jest.mock("os", () => ({
	homedir: jest.fn(() => "/mock/home"),
}))

describe("importExport", () => {
	let mockProviderSettingsManager: jest.Mocked<ProviderSettingsManager>
	let mockContextProxy: jest.Mocked<ContextProxy>
	let mockExtensionContext: jest.Mocked<vscode.ExtensionContext>

	beforeEach(() => {
		// Reset all mocks
		jest.clearAllMocks()

		// Setup providerSettingsManager mock
		mockProviderSettingsManager = {
			export: jest.fn(),
			import: jest.fn(),
			listConfig: jest.fn(),
		} as unknown as jest.Mocked<ProviderSettingsManager>

		// Setup contextProxy mock with properly typed export method
		mockContextProxy = {
			setValues: jest.fn(),
			setValue: jest.fn(),
			export: jest.fn().mockImplementation(() => Promise.resolve({})),
		} as unknown as jest.Mocked<ContextProxy>

		const map = new Map<string, string>()

		mockExtensionContext = {
			secrets: {
				get: jest.fn().mockImplementation((key: string) => map.get(key)),
				store: jest.fn().mockImplementation((key: string, value: string) => map.set(key, value)),
			},
		} as unknown as jest.Mocked<vscode.ExtensionContext>
	})

	describe("importSettings", () => {
		it("should return success: false when user cancels file selection", async () => {
			// Mock user canceling file selection
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(undefined)

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(result).toEqual({ success: false })
			expect(vscode.window.showOpenDialog).toHaveBeenCalledWith({
				filters: { JSON: ["json"] },
				canSelectMany: false,
			})
			expect(fs.readFile).not.toHaveBeenCalled()
			expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
			expect(mockContextProxy.setValues).not.toHaveBeenCalled()
		})

		it("should import settings successfully from a valid file", async () => {
			// Mock successful file selection
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			// Valid settings content
			const mockFileContent = JSON.stringify({
				providerProfiles: {
					currentApiConfigName: "test",
					apiConfigs: {
						test: {
							apiProvider: "openai" as ProviderName,
							apiKey: "test-key",
							id: "test-id",
						},
					},
				},
				globalSettings: {
					mode: "code",
					autoApprovalEnabled: true,
				},
			})

			// Mock reading file
			;(fs.readFile as jest.Mock).mockResolvedValue(mockFileContent)

			// Mock export returning previous provider profiles
			const previousProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: {
						apiProvider: "anthropic" as ProviderName,
						id: "default-id",
					},
				},
			}

			mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)

			// Mock listConfig
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "test", id: "test-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])

			// Mock contextProxy.export
			mockContextProxy.export.mockResolvedValue({
				mode: "code",
			})

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(result.success).toBe(true)
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()
			expect(mockProviderSettingsManager.import).toHaveBeenCalledWith({
				...previousProviderProfiles,
				currentApiConfigName: "test",
				apiConfigs: {
					test: {
						apiProvider: "openai" as ProviderName,
						apiKey: "test-key",
						id: "test-id",
					},
				},
			})
			expect(mockContextProxy.setValues).toHaveBeenCalledWith({
				mode: "code",
				autoApprovalEnabled: true,
			})
			expect(mockContextProxy.setValue).toHaveBeenCalledWith("currentApiConfigName", "test")
			expect(mockContextProxy.setValue).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test", id: "test-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])
		})

		it("should return success: false when file content is invalid", async () => {
			// Mock successful file selection
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			// Invalid content (missing required fields)
			const mockInvalidContent = JSON.stringify({
				providerProfiles: { apiConfigs: {} },
				globalSettings: {},
			})

			// Mock reading file
			;(fs.readFile as jest.Mock).mockResolvedValue(mockInvalidContent)

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(result).toEqual({ success: false })
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
			expect(mockContextProxy.setValues).not.toHaveBeenCalled()
		})

		it("should return success: false when file content is not valid JSON", async () => {
			// Mock successful file selection
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			// Invalid JSON
			const mockInvalidJson = "{ this is not valid JSON }"

			// Mock reading file
			;(fs.readFile as jest.Mock).mockResolvedValue(mockInvalidJson)

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(result).toEqual({ success: false })
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
			expect(mockContextProxy.setValues).not.toHaveBeenCalled()
		})

		it("should return success: false when reading file fails", async () => {
			// Mock successful file selection
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			// Mock file read error
			;(fs.readFile as jest.Mock).mockRejectedValue(new Error("File read error"))

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(result).toEqual({ success: false })
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
			expect(mockContextProxy.setValues).not.toHaveBeenCalled()
		})

		it("should not clobber existing api configs", async () => {
			const providerSettingsManager = new ProviderSettingsManager(mockExtensionContext)
			await providerSettingsManager.saveConfig("openai", { apiProvider: "openai", id: "openai" })

			const configs = await providerSettingsManager.listConfig()
			expect(configs[0].name).toBe("default")
			expect(configs[1].name).toBe("openai")
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			const mockFileContent = JSON.stringify({
				globalSettings: { mode: "code" },
				providerProfiles: {
					currentApiConfigName: "anthropic",
					apiConfigs: { default: { apiProvider: "anthropic" as const, id: "anthropic" } },
				},
			})

			;(fs.readFile as jest.Mock).mockResolvedValue(mockFileContent)

			mockContextProxy.export.mockResolvedValue({ mode: "code" })

			const result = await importSettings({
				providerSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(result.success).toBe(true)
			expect(result.providerProfiles?.apiConfigs["openai"]).toBeDefined()
			expect(result.providerProfiles?.apiConfigs["default"]).toBeDefined()
			expect(result.providerProfiles?.apiConfigs["default"].apiProvider).toBe("anthropic")
		})
	})

	describe("exportSettings", () => {
		it("should not export settings when user cancels file selection", async () => {
			// Mock user canceling file selection
			;(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(undefined)

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalledWith({
				filters: { JSON: ["json"] },
				defaultUri: expect.anything(),
			})
			expect(mockProviderSettingsManager.export).not.toHaveBeenCalled()
			expect(mockContextProxy.export).not.toHaveBeenCalled()
			expect(fs.writeFile).not.toHaveBeenCalled()
		})

		it("should export settings to the selected file location", async () => {
			// Mock successful file location selection
			;(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			// Mock providerProfiles data
			const mockProviderProfiles = {
				currentApiConfigName: "test",
				apiConfigs: {
					test: {
						apiProvider: "openai" as ProviderName,
						id: "test-id",
					},
				},
				migrations: {
					rateLimitSecondsMigrated: false,
				},
			}
			mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)

			// Mock globalSettings data
			const mockGlobalSettings = {
				mode: "code",
				autoApprovalEnabled: true,
			}
			mockContextProxy.export.mockResolvedValue(mockGlobalSettings)

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalledWith({
				filters: { JSON: ["json"] },
				defaultUri: expect.anything(),
			})
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()
			expect(mockContextProxy.export).toHaveBeenCalled()
			expect(fs.mkdir).toHaveBeenCalledWith("/mock/path", { recursive: true })
			expect(fs.writeFile).toHaveBeenCalledWith(
				"/mock/path/roo-code-settings.json",
				JSON.stringify(
					{
						providerProfiles: mockProviderProfiles,
						globalSettings: mockGlobalSettings,
					},
					null,
					2,
				),
				"utf-8",
			)
		})

		it("should handle errors during the export process", async () => {
			// Mock successful file location selection
			;(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			// Mock provider profiles
			mockProviderSettingsManager.export.mockResolvedValue({
				currentApiConfigName: "test",
				apiConfigs: {
					test: {
						apiProvider: "openai" as ProviderName,
						id: "test-id",
					},
				},
				migrations: {
					rateLimitSecondsMigrated: false,
				},
			})

			// Mock global settings
			mockContextProxy.export.mockResolvedValue({
				mode: "code",
			})

			// Mock file write error
			;(fs.writeFile as jest.Mock).mockRejectedValue(new Error("Write error"))

			// The function catches errors internally and doesn't throw or return anything
			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalled()
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()
			expect(mockContextProxy.export).toHaveBeenCalled()
			expect(fs.mkdir).toHaveBeenCalledWith("/mock/path", { recursive: true })
			expect(fs.writeFile).toHaveBeenCalled()
			// The error is caught and the function exits silently
		})

		it("should handle errors during directory creation", async () => {
			// Mock successful file location selection
			;(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			// Mock provider profiles
			mockProviderSettingsManager.export.mockResolvedValue({
				currentApiConfigName: "test",
				apiConfigs: {
					test: {
						apiProvider: "openai" as ProviderName,
						id: "test-id",
					},
				},
				migrations: {
					rateLimitSecondsMigrated: false,
				},
			})

			// Mock global settings
			mockContextProxy.export.mockResolvedValue({
				mode: "code",
			})

			// Mock directory creation error
			;(fs.mkdir as jest.Mock).mockRejectedValue(new Error("Directory creation error"))

			// The function catches errors internally and doesn't throw or return anything
			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalled()
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()
			expect(mockContextProxy.export).toHaveBeenCalled()
			expect(fs.mkdir).toHaveBeenCalled()
			expect(fs.writeFile).not.toHaveBeenCalled() // Should not be called since mkdir failed
		})

		it("should use the correct default save location", async () => {
			// Mock user cancels to avoid full execution
			;(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(undefined)

			// Call the function
			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			// Verify the default save location
			expect(vscode.window.showSaveDialog).toHaveBeenCalledWith({
				filters: { JSON: ["json"] },
				defaultUri: expect.anything(),
			})

			// Verify Uri.file was called with the correct path
			expect(vscode.Uri.file).toHaveBeenCalledWith(path.join("/mock/home", "Documents", "roo-code-settings.json"))
		})
	})
})
