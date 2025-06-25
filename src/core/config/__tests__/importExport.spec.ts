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
	})
})
