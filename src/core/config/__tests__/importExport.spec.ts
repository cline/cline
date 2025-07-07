// npx vitest src/core/config/__tests__/importExport.spec.ts

import fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"

import type { ProviderName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { importSettings, importSettingsFromFile, importSettingsWithFeedback, exportSettings } from "../importExport"
import { ProviderSettingsManager } from "../ProviderSettingsManager"
import { ContextProxy } from "../ContextProxy"
import { CustomModesManager } from "../CustomModesManager"
import { safeWriteJson } from "../../../utils/safeWriteJson"

import type { Mock } from "vitest"

vi.mock("vscode", () => ({
	window: {
		showOpenDialog: vi.fn(),
		showSaveDialog: vi.fn(),
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	},
	Uri: {
		file: vi.fn((filePath) => ({ fsPath: filePath })),
	},
}))

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn(),
		mkdir: vi.fn(),
		writeFile: vi.fn(),
		access: vi.fn(),
		constants: {
			F_OK: 0,
			R_OK: 4,
		},
	},
	readFile: vi.fn(),
	mkdir: vi.fn(),
	writeFile: vi.fn(),
	access: vi.fn(),
	constants: {
		F_OK: 0,
		R_OK: 4,
	},
}))

vi.mock("os", () => ({
	default: {
		homedir: vi.fn(() => "/mock/home"),
	},
	homedir: vi.fn(() => "/mock/home"),
}))

vi.mock("../../../utils/safeWriteJson")

describe("importExport", () => {
	let mockProviderSettingsManager: ReturnType<typeof vi.mocked<ProviderSettingsManager>>
	let mockContextProxy: ReturnType<typeof vi.mocked<ContextProxy>>
	let mockExtensionContext: ReturnType<typeof vi.mocked<vscode.ExtensionContext>>
	let mockCustomModesManager: ReturnType<typeof vi.mocked<CustomModesManager>>

	beforeEach(() => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		mockProviderSettingsManager = {
			export: vi.fn(),
			import: vi.fn(),
			listConfig: vi.fn(),
		} as unknown as ReturnType<typeof vi.mocked<ProviderSettingsManager>>

		mockContextProxy = {
			setValues: vi.fn(),
			setValue: vi.fn(),
			export: vi.fn().mockImplementation(() => Promise.resolve({})),
			setProviderSettings: vi.fn(),
		} as unknown as ReturnType<typeof vi.mocked<ContextProxy>>

		mockCustomModesManager = { updateCustomMode: vi.fn() } as unknown as ReturnType<
			typeof vi.mocked<CustomModesManager>
		>

		const map = new Map<string, string>()

		mockExtensionContext = {
			secrets: {
				get: vi.fn().mockImplementation((key: string) => map.get(key)),
				store: vi.fn().mockImplementation((key: string, value: string) => map.set(key, value)),
			},
		} as unknown as ReturnType<typeof vi.mocked<vscode.ExtensionContext>>
	})

	describe("importSettings", () => {
		it("should return success: false when user cancels file selection", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue(undefined)

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result).toEqual({ success: false, error: "User cancelled file selection" })

			expect(vscode.window.showOpenDialog).toHaveBeenCalledWith({
				filters: { JSON: ["json"] },
				canSelectMany: false,
			})

			expect(fs.readFile).not.toHaveBeenCalled()
			expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
			expect(mockContextProxy.setValues).not.toHaveBeenCalled()
		})

		it("should import settings successfully from a valid file", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			const mockFileContent = JSON.stringify({
				providerProfiles: {
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "test-id" } },
				},
				globalSettings: { mode: "code", autoApprovalEnabled: true },
			})

			;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

			const previousProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
			}

			mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)

			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "test", id: "test-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])

			mockContextProxy.export.mockResolvedValue({ mode: "code" })

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()

			expect(mockProviderSettingsManager.import).toHaveBeenCalledWith({
				currentApiConfigName: "test",
				apiConfigs: {
					default: { apiProvider: "anthropic" as ProviderName, id: "default-id" },
					test: { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "test-id" },
				},
				modeApiConfigs: {},
			})

			expect(mockContextProxy.setValues).toHaveBeenCalledWith({ mode: "code", autoApprovalEnabled: true })
			expect(mockContextProxy.setValue).toHaveBeenCalledWith("currentApiConfigName", "test")

			expect(mockContextProxy.setValue).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test", id: "test-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])
		})

		it("should return success: false when file content is invalid", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			// Invalid content (missing required fields).
			const mockInvalidContent = JSON.stringify({
				providerProfiles: { apiConfigs: {} },
				globalSettings: {},
			})

			;(fs.readFile as Mock).mockResolvedValue(mockInvalidContent)

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result).toEqual({ success: false, error: "[providerProfiles.currentApiConfigName]: Required" })
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
			expect(mockContextProxy.setValues).not.toHaveBeenCalled()
		})

		it("should import settings successfully when globalSettings key is missing", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			const mockFileContent = JSON.stringify({
				providerProfiles: {
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "test-id" } },
				},
			})

			;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

			const previousProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
			}

			mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)

			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "test", id: "test-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])

			mockContextProxy.export.mockResolvedValue({ mode: "code" })

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()
			expect(mockProviderSettingsManager.import).toHaveBeenCalledWith({
				currentApiConfigName: "test",
				apiConfigs: {
					default: { apiProvider: "anthropic" as ProviderName, id: "default-id" },
					test: { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "test-id" },
				},
				modeApiConfigs: {},
			})

			// Should call setValues with an empty object since globalSettings is missing.
			expect(mockContextProxy.setValues).toHaveBeenCalledWith({})
			expect(mockContextProxy.setValue).toHaveBeenCalledWith("currentApiConfigName", "test")
			expect(mockContextProxy.setValue).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test", id: "test-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])
		})

		it("should return success: false when file content is not valid JSON", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			const mockInvalidJson = "{ this is not valid JSON }"
			;(fs.readFile as Mock).mockResolvedValue(mockInvalidJson)

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(false)
			expect(result.error).toMatch(/^Expected property name or '}' in JSON at position 2/)
			expect(fs.readFile).toHaveBeenCalledWith("/mock/path/settings.json", "utf-8")
			expect(mockProviderSettingsManager.import).not.toHaveBeenCalled()
			expect(mockContextProxy.setValues).not.toHaveBeenCalled()
		})

		it("should return success: false when reading file fails", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockRejectedValue(new Error("File read error"))

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result).toEqual({ success: false, error: "File read error" })
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
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			const mockFileContent = JSON.stringify({
				globalSettings: { mode: "code" },
				providerProfiles: {
					currentApiConfigName: "anthropic",
					apiConfigs: { default: { apiProvider: "anthropic" as const, id: "anthropic" } },
				},
			})

			;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

			mockContextProxy.export.mockResolvedValue({ mode: "code" })

			const result = await importSettings({
				providerSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			if (result.success && "providerProfiles" in result) {
				expect(result.providerProfiles?.apiConfigs["openai"]).toBeDefined()
				expect(result.providerProfiles?.apiConfigs["default"]).toBeDefined()
				expect(result.providerProfiles?.apiConfigs["default"].apiProvider).toBe("anthropic")
			}
		})

		it("should call updateCustomMode for each custom mode in config", async () => {
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			const customModes = [
				{ slug: "mode1", name: "Mode One", roleDefinition: "Custom role one", groups: [] },
				{ slug: "mode2", name: "Mode Two", roleDefinition: "Custom role two", groups: [] },
			]

			const mockFileContent = JSON.stringify({
				providerProfiles: { currentApiConfigName: "test", apiConfigs: {} },
				globalSettings: { mode: "code", customModes },
			})

			;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

			mockProviderSettingsManager.export.mockResolvedValue({
				currentApiConfigName: "test",
				apiConfigs: {},
			})

			mockProviderSettingsManager.listConfig.mockResolvedValue([])

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect(mockCustomModesManager.updateCustomMode).toHaveBeenCalledTimes(customModes.length)

			customModes.forEach((mode) => {
				expect(mockCustomModesManager.updateCustomMode).toHaveBeenCalledWith(mode.slug, mode)
			})
		})

		it("should import settings from provided file path without showing dialog", async () => {
			const filePath = "/mock/path/settings.json"
			const mockFileContent = JSON.stringify({
				providerProfiles: {
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "test-id" } },
				},
				globalSettings: { mode: "code", autoApprovalEnabled: true },
			})

			;(fs.readFile as Mock).mockResolvedValue(mockFileContent)
			;(fs.access as Mock).mockResolvedValue(undefined) // File exists and is readable

			const previousProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
			}

			mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "test", id: "test-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])
			mockContextProxy.export.mockResolvedValue({ mode: "code" })

			const result = await importSettingsFromFile(
				{
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
				},
				vscode.Uri.file(filePath),
			)

			expect(vscode.window.showOpenDialog).not.toHaveBeenCalled()
			expect(fs.readFile).toHaveBeenCalledWith(filePath, "utf-8")
			expect(result.success).toBe(true)
			expect(mockProviderSettingsManager.import).toHaveBeenCalledWith({
				currentApiConfigName: "test",
				apiConfigs: {
					default: { apiProvider: "anthropic" as ProviderName, id: "default-id" },
					test: { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "test-id" },
				},
				modeApiConfigs: {},
			})
			expect(mockContextProxy.setValues).toHaveBeenCalledWith({ mode: "code", autoApprovalEnabled: true })
		})

		it("should return error when provided file path does not exist", async () => {
			const filePath = "/nonexistent/path/settings.json"
			const accessError = new Error("ENOENT: no such file or directory")

			;(fs.access as Mock).mockRejectedValue(accessError)

			// Create a mock provider for the test
			const mockProvider = {
				settingsImportedAt: 0,
				postStateToWebview: vi.fn().mockResolvedValue(undefined),
			}

			// Mock the showErrorMessage to capture the error
			const showErrorMessageSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined)

			await importSettingsWithFeedback(
				{
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
					provider: mockProvider,
				},
				filePath,
			)

			expect(vscode.window.showOpenDialog).not.toHaveBeenCalled()
			expect(fs.access).toHaveBeenCalledWith(filePath, fs.constants.F_OK | fs.constants.R_OK)
			expect(fs.readFile).not.toHaveBeenCalled()
			expect(showErrorMessageSpy).toHaveBeenCalledWith(expect.stringContaining("errors.settings_import_failed"))

			showErrorMessageSpy.mockRestore()
		})
	})

	describe("exportSettings", () => {
		it("should not export settings when user cancels file selection", async () => {
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue(undefined)

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
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			const mockProviderProfiles = {
				currentApiConfigName: "test",
				apiConfigs: { test: { apiProvider: "openai" as ProviderName, id: "test-id" } },
				migrations: { rateLimitSecondsMigrated: false },
			}

			mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
			const mockGlobalSettings = { mode: "code", autoApprovalEnabled: true }
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

			expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/roo-code-settings.json", {
				providerProfiles: mockProviderProfiles,
				globalSettings: mockGlobalSettings,
			})
		})

		it("should include globalSettings when allowedMaxRequests is null", async () => {
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			const mockProviderProfiles = {
				currentApiConfigName: "test",
				apiConfigs: { test: { apiProvider: "openai" as ProviderName, id: "test-id" } },
				migrations: { rateLimitSecondsMigrated: false },
			}

			mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)

			const mockGlobalSettings = {
				mode: "code",
				autoApprovalEnabled: true,
				allowedMaxRequests: null,
			}

			mockContextProxy.export.mockResolvedValue(mockGlobalSettings)

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/roo-code-settings.json", {
				providerProfiles: mockProviderProfiles,
				globalSettings: mockGlobalSettings,
			})
		})

		it("should handle errors during the export process", async () => {
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			mockProviderSettingsManager.export.mockResolvedValue({
				currentApiConfigName: "test",
				apiConfigs: { test: { apiProvider: "openai" as ProviderName, id: "test-id" } },
				migrations: { rateLimitSecondsMigrated: false },
			})

			mockContextProxy.export.mockResolvedValue({ mode: "code" })
			// Simulate an error during the safeWriteJson operation
			;(safeWriteJson as Mock).mockRejectedValueOnce(new Error("Safe write error"))

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalled()
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()
			expect(mockContextProxy.export).toHaveBeenCalled()
			expect(fs.mkdir).toHaveBeenCalledWith("/mock/path", { recursive: true })
			expect(safeWriteJson).toHaveBeenCalled() // safeWriteJson is called, but it will throw
			// The error is caught and the function exits silently.
			// Optionally, ensure no error message was shown if that's part of "silent"
			// expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
		})

		it("should handle errors during directory creation", async () => {
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			mockProviderSettingsManager.export.mockResolvedValue({
				currentApiConfigName: "test",
				apiConfigs: { test: { apiProvider: "openai" as ProviderName, id: "test-id" } },
				migrations: { rateLimitSecondsMigrated: false },
			})

			mockContextProxy.export.mockResolvedValue({ mode: "code" })
			;(fs.mkdir as Mock).mockRejectedValue(new Error("Directory creation error"))

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalled()
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()
			expect(mockContextProxy.export).toHaveBeenCalled()
			expect(fs.mkdir).toHaveBeenCalled()
			expect(safeWriteJson).not.toHaveBeenCalled() // Should not be called since mkdir failed.
		})

		it("should use the correct default save location", async () => {
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue(undefined)

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalledWith({
				filters: { JSON: ["json"] },
				defaultUri: expect.anything(),
			})

			expect(vscode.Uri.file).toHaveBeenCalledWith(path.join("/mock/home", "Documents", "roo-code-settings.json"))
		})

		describe("codebase indexing export", () => {
			it("should export correct base URL for OpenAI Compatible provider", async () => {
				;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
					fsPath: "/mock/path/roo-code-settings.json",
				})

				const mockProviderProfiles = {
					currentApiConfigName: "openai-compatible-provider",
					apiConfigs: {
						"openai-compatible-provider": {
							apiProvider: "openai" as ProviderName,
							id: "openai-compatible-id",
							// Remove OpenAI Compatible settings from provider profile
						},
						"ollama-provider": {
							apiProvider: "ollama" as ProviderName,
							id: "ollama-id",
							codebaseIndexOllamaBaseUrl: "http://localhost:11434",
						},
					},
					modeApiConfigs: {},
				}

				const mockGlobalSettings = {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "http://localhost:11434", // Wrong URL from Ollama
						// OpenAI Compatible settings are now stored directly in codebaseIndexConfig
						codebaseIndexOpenAiCompatibleBaseUrl: "https://custom-openai-api.example.com/v1",
						codebaseIndexOpenAiCompatibleModelDimension: 1536,
					},
				}

				mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
				mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				await exportSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
				})

				expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/roo-code-settings.json", {
					providerProfiles: mockProviderProfiles,
					globalSettings: mockGlobalSettings,
				})
			})

			it("should export model dimension for OpenAI Compatible provider", async () => {
				;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
					fsPath: "/mock/path/roo-code-settings.json",
				})

				const mockProviderProfiles = {
					currentApiConfigName: "test-provider",
					apiConfigs: {
						"test-provider": {
							apiProvider: "openai" as ProviderName,
							id: "test-id",
							// Remove OpenAI Compatible settings from provider profile
						},
					},
					modeApiConfigs: {},
				}

				const mockGlobalSettings = {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "custom-embedding-model",
						codebaseIndexEmbedderBaseUrl: "",
						// OpenAI Compatible settings are now stored directly in codebaseIndexConfig
						codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
						codebaseIndexOpenAiCompatibleModelDimension: 768,
					},
				}

				mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
				mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				await exportSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
				})

				const exportedData = (safeWriteJson as Mock).mock.calls[0][1]
				// Settings are now exported as-is from codebaseIndexConfig
				expect(
					exportedData.globalSettings.codebaseIndexConfig.codebaseIndexOpenAiCompatibleModelDimension,
				).toBe(768)
				expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexOpenAiCompatibleBaseUrl).toBe(
					"https://api.example.com/v1",
				)
			})

			it("should not mix settings between different providers", async () => {
				;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
					fsPath: "/mock/path/roo-code-settings.json",
				})

				const mockProviderProfiles = {
					currentApiConfigName: "openai-compatible-provider",
					apiConfigs: {
						"openai-compatible-provider": {
							apiProvider: "openai" as ProviderName,
							id: "openai-compatible-id",
							// Remove OpenAI Compatible settings from provider profile
						},
						"ollama-provider": {
							apiProvider: "ollama" as ProviderName,
							id: "ollama-id",
							codebaseIndexOllamaBaseUrl: "http://localhost:11434",
						},
						"anthropic-provider": {
							apiProvider: "anthropic" as ProviderName,
							id: "anthropic-id",
						},
					},
					modeApiConfigs: {},
				}

				const mockGlobalSettings = {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "http://localhost:11434", // Wrong URL from Ollama
						// OpenAI Compatible settings are now stored directly in codebaseIndexConfig
						codebaseIndexOpenAiCompatibleBaseUrl: "https://openai-compatible.example.com/v1",
						codebaseIndexOpenAiCompatibleModelDimension: 1536,
					},
				}

				mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
				mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				await exportSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
				})

				const exportedData = (safeWriteJson as Mock).mock.calls[0][1]
				// Settings are now exported as-is from codebaseIndexConfig
				expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexOpenAiCompatibleBaseUrl).toBe(
					"https://openai-compatible.example.com/v1",
				)
				expect(
					exportedData.globalSettings.codebaseIndexConfig.codebaseIndexOpenAiCompatibleModelDimension,
				).toBe(1536)
				// The generic embedder base URL is still there
				expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexEmbedderBaseUrl).toBe(
					"http://localhost:11434",
				)
			})

			it("should handle missing provider-specific settings gracefully", async () => {
				;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
					fsPath: "/mock/path/roo-code-settings.json",
				})

				const mockProviderProfiles = {
					currentApiConfigName: "incomplete-provider",
					apiConfigs: {
						"incomplete-provider": {
							apiProvider: "openai" as ProviderName,
							id: "incomplete-id",
							// Missing codebaseIndexOpenAiCompatibleBaseUrl and dimension
						},
					},
					modeApiConfigs: {},
				}

				const mockGlobalSettings = {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "https://fallback.example.com/v1",
					},
				}

				// Mock getGlobalState to return undefined (no settings)
				mockContextProxy.getGlobalState = vi.fn().mockReturnValue(undefined)

				mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
				mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				await exportSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
				})

				// Should not throw an error and should preserve original settings
				expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/roo-code-settings.json", {
					providerProfiles: mockProviderProfiles,
					globalSettings: mockGlobalSettings, // Should remain unchanged
				})
			})

			it("should maintain backward compatibility with existing exports", async () => {
				;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
					fsPath: "/mock/path/roo-code-settings.json",
				})

				const mockProviderProfiles = {
					currentApiConfigName: "openai-provider",
					apiConfigs: {
						"openai-provider": {
							apiProvider: "openai" as ProviderName,
							id: "openai-id",
							// Regular OpenAI provider without OpenAI Compatible settings
						},
					},
					modeApiConfigs: {},
				}

				const mockGlobalSettings = {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai" as const, // Not openai-compatible
						codebaseIndexEmbedderModelId: "text-embedding-ada-002",
						codebaseIndexEmbedderBaseUrl: "https://api.openai.com/v1",
					},
				}

				mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
				mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				await exportSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
				})

				// Should not modify settings for non-openai-compatible providers
				expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/roo-code-settings.json", {
					providerProfiles: mockProviderProfiles,
					globalSettings: mockGlobalSettings, // Should remain unchanged
				})
			})

			it("should handle missing current provider gracefully", async () => {
				;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
					fsPath: "/mock/path/roo-code-settings.json",
				})

				const mockProviderProfiles = {
					currentApiConfigName: "nonexistent-provider",
					apiConfigs: {
						"other-provider": {
							apiProvider: "openai" as ProviderName,
							id: "other-id",
						},
					},
					modeApiConfigs: {},
				}

				const mockGlobalSettings = {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "https://fallback.example.com/v1",
					},
				}

				// Mock getGlobalState to return undefined (no settings)
				mockContextProxy.getGlobalState = vi.fn().mockReturnValue(undefined)

				mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
				mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				await exportSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
				})

				// Should not throw an error and should preserve original settings
				expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/roo-code-settings.json", {
					providerProfiles: mockProviderProfiles,
					globalSettings: mockGlobalSettings, // Should remain unchanged
				})
			})
		})

		describe("import with OpenAI Compatible codebase indexing settings", () => {
			it("should properly import OpenAI Compatible settings in codebaseIndexConfig", async () => {
				;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

				const mockFileContent = JSON.stringify({
					providerProfiles: {
						currentApiConfigName: "openai-compatible-provider",
						apiConfigs: {
							"openai-compatible-provider": {
								apiProvider: "openai" as ProviderName,
								id: "openai-compatible-id",
								// Provider-specific settings remain in provider profile
								codebaseIndexOpenAiCompatibleBaseUrl: "https://old-url.example.com/v1",
								codebaseIndexOpenAiCompatibleModelDimension: 512,
							},
						},
						modeApiConfigs: {},
					},
					globalSettings: {
						mode: "code",
						codebaseIndexConfig: {
							codebaseIndexEnabled: true,
							codebaseIndexEmbedderProvider: "openai-compatible" as const,
							codebaseIndexEmbedderModelId: "text-embedding-3-small",
							codebaseIndexEmbedderBaseUrl: "https://imported-url.example.com/v1",
							codebaseIndexEmbedderModelDimension: 1536,
							// OpenAI Compatible settings are now stored directly here
							codebaseIndexOpenAiCompatibleBaseUrl: "https://imported-url.example.com/v1",
							codebaseIndexOpenAiCompatibleModelDimension: 1536,
						},
					},
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

				const previousProviderProfiles = {
					currentApiConfigName: "default",
					apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
				}

				mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{
						name: "openai-compatible-provider",
						id: "openai-compatible-id",
						apiProvider: "openai" as ProviderName,
					},
					{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
				])

				const result = await importSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
				})

				expect(result.success).toBe(true)

				// Verify that the global settings were imported correctly
				expect(mockContextProxy.setValues).toHaveBeenCalledWith(
					expect.objectContaining({
						codebaseIndexConfig: expect.objectContaining({
							codebaseIndexOpenAiCompatibleBaseUrl: "https://imported-url.example.com/v1",
							codebaseIndexOpenAiCompatibleModelDimension: 1536,
						}),
					}),
				)

				// Provider profiles are imported as-is
				const importedProviderProfiles = mockProviderSettingsManager.import.mock.calls[0][0]
				const importedProvider = importedProviderProfiles.apiConfigs["openai-compatible-provider"]

				// Provider still has its own settings (not modified by import)
				expect(importedProvider.codebaseIndexOpenAiCompatibleBaseUrl).toBe("https://old-url.example.com/v1")
				expect(importedProvider.codebaseIndexOpenAiCompatibleModelDimension).toBe(512)
			})

			it("should handle missing OpenAI Compatible settings gracefully during import", async () => {
				;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

				const mockFileContent = JSON.stringify({
					providerProfiles: {
						currentApiConfigName: "openai-compatible-provider",
						apiConfigs: {
							"openai-compatible-provider": {
								apiProvider: "openai" as ProviderName,
								id: "openai-compatible-id",
							},
						},
						modeApiConfigs: {},
					},
					globalSettings: {
						mode: "code",
						codebaseIndexConfig: {
							codebaseIndexEnabled: true,
							codebaseIndexEmbedderProvider: "openai-compatible" as const,
							codebaseIndexEmbedderModelId: "text-embedding-3-small",
							// Missing base URL and model dimension
						},
					},
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

				const previousProviderProfiles = {
					currentApiConfigName: "default",
					apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
				}

				mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{
						name: "openai-compatible-provider",
						id: "openai-compatible-id",
						apiProvider: "openai" as ProviderName,
					},
				])

				const result = await importSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
				})

				expect(result.success).toBe(true)
				// Should not throw an error when settings are missing
			})

			it("should not modify provider settings for non-openai-compatible providers during import", async () => {
				;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

				const mockFileContent = JSON.stringify({
					providerProfiles: {
						currentApiConfigName: "anthropic-provider",
						apiConfigs: {
							"anthropic-provider": {
								apiProvider: "anthropic" as ProviderName,
								id: "anthropic-id",
							},
						},
						modeApiConfigs: {},
					},
					globalSettings: {
						mode: "code",
						codebaseIndexConfig: {
							codebaseIndexEnabled: true,
							codebaseIndexEmbedderProvider: "openai" as const, // Not openai-compatible
							codebaseIndexEmbedderModelId: "text-embedding-ada-002",
							codebaseIndexEmbedderBaseUrl: "https://api.openai.com/v1",
							codebaseIndexEmbedderModelDimension: 1536,
						},
					},
				})

				;(fs.readFile as Mock).mockResolvedValue(mockFileContent)

				const previousProviderProfiles = {
					currentApiConfigName: "default",
					apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
				}

				mockProviderSettingsManager.export.mockResolvedValue(previousProviderProfiles)
				mockProviderSettingsManager.listConfig.mockResolvedValue([
					{ name: "anthropic-provider", id: "anthropic-id", apiProvider: "anthropic" as ProviderName },
				])

				const result = await importSettings({
					providerSettingsManager: mockProviderSettingsManager,
					contextProxy: mockContextProxy,
					customModesManager: mockCustomModesManager,
				})

				expect(result.success).toBe(true)

				// Verify that the provider settings were not modified with OpenAI Compatible fields
				const importedProviderProfiles = mockProviderSettingsManager.import.mock.calls[0][0]
				const importedProvider = importedProviderProfiles.apiConfigs["anthropic-provider"]

				expect(importedProvider.codebaseIndexOpenAiCompatibleBaseUrl).toBeUndefined()
				expect(importedProvider.codebaseIndexOpenAiCompatibleModelDimension).toBeUndefined()
			})
		})

		it("should preserve model dimension exactly in export/import roundtrip", async () => {
			// This test specifically isolates the model dimension export/import roundtrip
			// to catch the exact issue the user is experiencing

			const testModelDimension = 768

			// Step 1: Set up a provider without OpenAI Compatible settings in profile
			const mockProviderProfiles = {
				currentApiConfigName: "test-openai-compatible",
				apiConfigs: {
					"test-openai-compatible": {
						apiProvider: "openai" as ProviderName,
						id: "test-id",
						// Remove OpenAI Compatible settings from provider profile
					},
				},
				modeApiConfigs: {},
			}

			const mockGlobalSettings = {
				mode: "code",
				codebaseIndexConfig: {
					codebaseIndexEnabled: true,
					codebaseIndexEmbedderProvider: "openai-compatible" as const,
					codebaseIndexEmbedderModelId: "custom-embedding-model",
					codebaseIndexEmbedderBaseUrl: "https://api.example.com/v1",
					codebaseIndexEmbedderModelDimension: testModelDimension,
					// OpenAI Compatible settings are now stored directly in codebaseIndexConfig
					codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
					codebaseIndexOpenAiCompatibleModelDimension: testModelDimension,
				},
			}

			// Step 2: Mock export operation
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/test-settings.json",
			})

			mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
			mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
			;(fs.mkdir as Mock).mockResolvedValue(undefined)

			// Step 3: Export settings
			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			// Step 4: Verify the exported data includes the model dimension
			expect(safeWriteJson).toHaveBeenCalledWith("/mock/path/test-settings.json", {
				providerProfiles: mockProviderProfiles,
				globalSettings: mockGlobalSettings,
			})

			// Step 5: Get the exported data for import test
			const exportedData = (safeWriteJson as Mock).mock.calls[0][1]
			const exportedFileContent = JSON.stringify(exportedData)

			// Step 6: Mock import operation
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/test-settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(exportedFileContent)

			// Reset mocks for import
			vi.clearAllMocks()
			mockProviderSettingsManager.export.mockResolvedValue({
				currentApiConfigName: "default",
				apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
			})
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "test-openai-compatible", id: "test-id", apiProvider: "openai" as ProviderName },
			])

			// Step 7: Import the settings back
			const importResult = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			// Step 8: Verify import was successful
			expect(importResult.success).toBe(true)

			// Step 9: Verify that the model dimension was preserved exactly in global settings
			const importedGlobalSettings = mockContextProxy.setValues.mock.calls[0][0]
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleModelDimension).toBe(
				testModelDimension,
			)
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl).toBe(
				"https://api.example.com/v1",
			)

			// Step 10: Verify that the embedder settings were imported correctly
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexEmbedderModelDimension).toBe(
				testModelDimension,
			)
		})

		it("should handle edge case model dimension values (0, null) correctly", async () => {
			// Test with model dimension = 0 (which is falsy but valid)
			const testModelDimension = 0

			const mockProviderProfiles = {
				currentApiConfigName: "test-openai-compatible",
				apiConfigs: {
					"test-openai-compatible": {
						apiProvider: "openai" as ProviderName,
						id: "test-id",
						// Remove OpenAI Compatible settings from provider profile
					},
				},
				modeApiConfigs: {},
			}

			const mockGlobalSettings = {
				mode: "code",
				codebaseIndexConfig: {
					codebaseIndexEnabled: true,
					codebaseIndexEmbedderProvider: "openai-compatible" as const,
					codebaseIndexEmbedderModelId: "custom-embedding-model",
					codebaseIndexEmbedderBaseUrl: "https://api.example.com/v1",
					// OpenAI Compatible settings are now stored directly in codebaseIndexConfig
					codebaseIndexOpenAiCompatibleBaseUrl: "https://api.example.com/v1",
					codebaseIndexOpenAiCompatibleModelDimension: testModelDimension, // 0 is a valid value
				},
			}

			// Mock export operation
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/test-settings.json",
			})

			mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
			mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
			;(fs.mkdir as Mock).mockResolvedValue(undefined)

			// Export settings
			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			// Verify the exported data includes the model dimension even when it's 0
			const exportedData = (safeWriteJson as Mock).mock.calls[0][1]
			expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexOpenAiCompatibleModelDimension).toBe(0)

			// Test import roundtrip
			const exportedFileContent = JSON.stringify(exportedData)
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/test-settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(exportedFileContent)

			// Reset mocks for import
			vi.clearAllMocks()
			mockProviderSettingsManager.export.mockResolvedValue({
				currentApiConfigName: "default",
				apiConfigs: { default: { apiProvider: "anthropic" as ProviderName, id: "default-id" } },
			})
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "test-openai-compatible", id: "test-id", apiProvider: "openai" as ProviderName },
			])

			// Import the settings back
			const importResult = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(importResult.success).toBe(true)

			// Verify that model dimension 0 was preserved in global settings
			const setValuesCall = mockContextProxy.setValues.mock.calls[0][0]
			expect(setValuesCall.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleModelDimension).toBe(0)
		})

		it("should handle missing model dimension gracefully", async () => {
			// Test when model dimension is undefined in global state
			const mockProviderProfiles = {
				currentApiConfigName: "test-openai-compatible",
				apiConfigs: {
					"test-openai-compatible": {
						apiProvider: "openai" as ProviderName,
						id: "test-id",
						// Remove OpenAI Compatible settings from provider profile
					},
				},
				modeApiConfigs: {},
			}

			const mockGlobalSettings = {
				mode: "code",
				codebaseIndexConfig: {
					codebaseIndexEnabled: true,
					codebaseIndexEmbedderProvider: "openai-compatible" as const,
					codebaseIndexEmbedderModelId: "custom-embedding-model",
					codebaseIndexEmbedderBaseUrl: "https://api.example.com/v1",
				},
			}

			// Mock getGlobalState to return undefined for model dimension
			mockContextProxy.getGlobalState = vi.fn().mockImplementation((key: string) => {
				if (key === "codebaseIndexOpenAiCompatibleBaseUrl") {
					return "https://api.example.com/v1"
				}
				if (key === "codebaseIndexOpenAiCompatibleModelDimension") {
					return undefined
				}
				return undefined
			})

			// Mock export operation
			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/test-settings.json",
			})

			mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
			mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
			;(fs.mkdir as Mock).mockResolvedValue(undefined)

			// Export settings
			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			// Verify the exported data does NOT include model dimension when it's undefined
			const exportedData = (safeWriteJson as Mock).mock.calls[0][1]
			expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexEmbedderModelDimension).toBeUndefined()
		})

		it("should handle provider mismatch during import - BUG REPRODUCTION", async () => {
			// This test reproduces the bug where model dimension is lost when importing
			// settings where the current provider is different from the exported provider

			// Step 1: Create exported settings from "provider-a" with model dimension
			const exportedSettings = {
				providerProfiles: {
					currentApiConfigName: "provider-a",
					apiConfigs: {
						"provider-a": {
							apiProvider: "openai" as ProviderName,
							id: "provider-a-id",
							codebaseIndexOpenAiCompatibleBaseUrl: "https://api-a.example.com/v1",
							codebaseIndexOpenAiCompatibleModelDimension: 1536,
						},
						"provider-b": {
							apiProvider: "anthropic" as ProviderName,
							id: "provider-b-id",
						},
					},
					modeApiConfigs: {},
				},
				globalSettings: {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "https://api-a.example.com/v1",
						codebaseIndexEmbedderModelDimension: 1536,
					},
				},
			}

			// Step 2: Set up import environment where current provider is "provider-b" (different!)
			const currentProviderProfiles = {
				currentApiConfigName: "provider-b", // Different from exported settings!
				apiConfigs: {
					"provider-b": {
						apiProvider: "anthropic" as ProviderName,
						id: "provider-b-id",
					},
				},
			}

			// Step 3: Mock import operation
			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(JSON.stringify(exportedSettings))

			mockProviderSettingsManager.export.mockResolvedValue(currentProviderProfiles)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "provider-a", id: "provider-a-id", apiProvider: "openai" as ProviderName },
				{ name: "provider-b", id: "provider-b-id", apiProvider: "anthropic" as ProviderName },
			])

			// Step 4: Import the settings
			const importResult = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(importResult.success).toBe(true)

			// Step 5: Check what was imported
			const importedProviderProfiles = mockProviderSettingsManager.import.mock.calls[0][0]

			// The bug: provider-a should have its model dimension preserved, but it might be lost
			// because the import logic only updates the CURRENT provider (provider-b)
			const providerA = importedProviderProfiles.apiConfigs["provider-a"]
			const providerB = importedProviderProfiles.apiConfigs["provider-b"]

			// This should pass but might fail due to the bug
			expect(providerA.codebaseIndexOpenAiCompatibleModelDimension).toBe(1536)
			expect(providerA.codebaseIndexOpenAiCompatibleBaseUrl).toBe("https://api-a.example.com/v1")

			// Provider B should not have OpenAI Compatible settings
			expect(providerB.codebaseIndexOpenAiCompatibleModelDimension).toBeUndefined()
			expect(providerB.codebaseIndexOpenAiCompatibleBaseUrl).toBeUndefined()
		})

		it("should NOT copy OpenAI Compatible settings to provider profiles - FIXED BEHAVIOR", async () => {
			// This test verifies the FIXED behavior: OpenAI Compatible settings stay in global settings only

			const exportedSettings = {
				providerProfiles: {
					currentApiConfigName: "openai-compatible-provider",
					apiConfigs: {
						"openai-compatible-provider": {
							apiProvider: "openai" as ProviderName,
							id: "openai-compatible-id",
							// NO OpenAI Compatible settings here in the fixed version
						},
						"anthropic-provider": {
							apiProvider: "anthropic" as ProviderName,
							id: "anthropic-id",
						},
					},
					modeApiConfigs: {},
				},
				globalSettings: {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "https://new-url.example.com/v1",
						codebaseIndexEmbedderModelDimension: 1536,
						// OpenAI Compatible settings are stored here
						codebaseIndexOpenAiCompatibleBaseUrl: "https://new-url.example.com/v1",
						codebaseIndexOpenAiCompatibleModelDimension: 1536,
					},
				},
			}

			const currentProviderProfiles = {
				currentApiConfigName: "anthropic-provider",
				apiConfigs: {
					"anthropic-provider": {
						apiProvider: "anthropic" as ProviderName,
						id: "anthropic-id",
					},
				},
			}

			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(JSON.stringify(exportedSettings))

			mockProviderSettingsManager.export.mockResolvedValue(currentProviderProfiles)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{
					name: "openai-compatible-provider",
					id: "openai-compatible-id",
					apiProvider: "openai" as ProviderName,
				},
				{ name: "anthropic-provider", id: "anthropic-id", apiProvider: "anthropic" as ProviderName },
			])

			const importResult = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(importResult.success).toBe(true)

			// Verify OpenAI Compatible settings are imported to global settings
			const importedGlobalSettings = mockContextProxy.setValues.mock.calls[0][0]
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl).toBe(
				"https://new-url.example.com/v1",
			)
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleModelDimension).toBe(1536)

			// Verify provider profiles do NOT have OpenAI Compatible settings
			const importedProviderProfiles = mockProviderSettingsManager.import.mock.calls[0][0]
			const openaiCompatibleProvider = importedProviderProfiles.apiConfigs["openai-compatible-provider"]
			const anthropicProvider = importedProviderProfiles.apiConfigs["anthropic-provider"]

			// Neither provider should have OpenAI Compatible settings
			expect(openaiCompatibleProvider.codebaseIndexOpenAiCompatibleBaseUrl).toBeUndefined()
			expect(openaiCompatibleProvider.codebaseIndexOpenAiCompatibleModelDimension).toBeUndefined()
			expect(anthropicProvider.codebaseIndexOpenAiCompatibleBaseUrl).toBeUndefined()
			expect(anthropicProvider.codebaseIndexOpenAiCompatibleModelDimension).toBeUndefined()
		})

		it("should keep OpenAI Compatible settings in global state only - FIXED BEHAVIOR", async () => {
			// This test verifies that OpenAI Compatible settings remain in global state
			// and are NOT copied to provider profiles

			const exportedSettings = {
				providerProfiles: {
					currentApiConfigName: "anthropic-provider",
					apiConfigs: {
						"anthropic-provider": {
							apiProvider: "anthropic" as ProviderName,
							id: "anthropic-id",
						},
						"openai-compatible-provider": {
							apiProvider: "openai" as ProviderName,
							id: "openai-compatible-id",
							// NO OpenAI Compatible settings in provider profiles
						},
					},
					modeApiConfigs: {},
				},
				globalSettings: {
					mode: "code",
					codebaseIndexConfig: {
						codebaseIndexEnabled: true,
						codebaseIndexEmbedderProvider: "openai-compatible" as const,
						codebaseIndexEmbedderModelId: "text-embedding-3-small",
						codebaseIndexEmbedderBaseUrl: "https://updated.example.com/v1",
						codebaseIndexEmbedderModelDimension: 1536,
						// OpenAI Compatible settings are stored here
						codebaseIndexOpenAiCompatibleBaseUrl: "https://updated.example.com/v1",
						codebaseIndexOpenAiCompatibleModelDimension: 1536,
					},
				},
			}

			const currentProviderProfiles = {
				currentApiConfigName: "default",
				apiConfigs: {
					default: {
						apiProvider: "openai" as ProviderName,
						id: "default-id",
					},
				},
			}

			;(vscode.window.showOpenDialog as Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as Mock).mockResolvedValue(JSON.stringify(exportedSettings))

			mockProviderSettingsManager.export.mockResolvedValue(currentProviderProfiles)
			mockProviderSettingsManager.listConfig.mockResolvedValue([
				{ name: "anthropic-provider", id: "anthropic-id", apiProvider: "anthropic" as ProviderName },
				{
					name: "openai-compatible-provider",
					id: "openai-compatible-id",
					apiProvider: "openai" as ProviderName,
				},
				{ name: "default", id: "default-id", apiProvider: "openai" as ProviderName },
			])

			const importResult = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
			})

			expect(importResult.success).toBe(true)

			// Verify OpenAI Compatible settings are imported to global settings
			const importedGlobalSettings = mockContextProxy.setValues.mock.calls[0][0]
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl).toBe(
				"https://updated.example.com/v1",
			)
			expect(importedGlobalSettings.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleModelDimension).toBe(1536)

			// Verify NO provider profiles have OpenAI Compatible settings
			const importedProviderProfiles = mockProviderSettingsManager.import.mock.calls[0][0]
			const anthropicProvider = importedProviderProfiles.apiConfigs["anthropic-provider"]
			const openaiCompatibleProvider = importedProviderProfiles.apiConfigs["openai-compatible-provider"]

			// Neither provider should have OpenAI Compatible settings
			expect(anthropicProvider.codebaseIndexOpenAiCompatibleBaseUrl).toBeUndefined()
			expect(anthropicProvider.codebaseIndexOpenAiCompatibleModelDimension).toBeUndefined()
			expect(openaiCompatibleProvider.codebaseIndexOpenAiCompatibleBaseUrl).toBeUndefined()
			expect(openaiCompatibleProvider.codebaseIndexOpenAiCompatibleModelDimension).toBeUndefined()
		})

		it("should export OpenAI Compatible settings from global state when provider is openai-compatible", async () => {
			// This test reproduces the bug where codebaseIndexEmbedderModelDimension is missing from exported JSON
			// when the OpenAI Compatible settings are stored in global state via contextProxy

			;(vscode.window.showSaveDialog as Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			// Set up provider profiles - note that the OpenAI Compatible provider does NOT have
			// the codebaseIndexOpenAiCompatibleBaseUrl and codebaseIndexOpenAiCompatibleModelDimension
			// fields in the provider profile itself
			const mockProviderProfiles = {
				currentApiConfigName: "openrouter-provider", // Current provider is OpenRouter
				apiConfigs: {
					"openrouter-provider": {
						apiProvider: "openrouter" as ProviderName,
						id: "openrouter-id",
						// OpenRouter doesn't have OpenAI Compatible fields
					},
				},
				modeApiConfigs: {},
			}

			// The global settings now include OpenAI Compatible settings directly in codebaseIndexConfig
			const mockGlobalSettings = {
				mode: "code",
				codebaseIndexConfig: {
					codebaseIndexEnabled: true,
					codebaseIndexEmbedderProvider: "openai-compatible" as const,
					codebaseIndexEmbedderModelId: "text-embedding-3-small",
					codebaseIndexEmbedderBaseUrl: "https://custom-api.example.com/v1",
					codebaseIndexEmbedderModelDimension: 1536,
					// OpenAI Compatible settings are now included directly
					codebaseIndexOpenAiCompatibleBaseUrl: "https://custom-api.example.com/v1",
					codebaseIndexOpenAiCompatibleModelDimension: 1536,
				},
			}

			mockProviderSettingsManager.export.mockResolvedValue(mockProviderProfiles)
			mockContextProxy.export.mockResolvedValue(mockGlobalSettings)
			;(fs.mkdir as Mock).mockResolvedValue(undefined)

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			// Verify that the exported JSON contains the OpenAI Compatible settings
			const exportedData = (safeWriteJson as Mock).mock.calls[0][1]

			// With the fix, these values are now properly exported
			expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexOpenAiCompatibleModelDimension).toBe(
				1536,
			)
			expect(exportedData.globalSettings.codebaseIndexConfig.codebaseIndexOpenAiCompatibleBaseUrl).toBe(
				"https://custom-api.example.com/v1",
			)
		})
	})
})
