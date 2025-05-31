// npx jest src/core/config/__tests__/importExport.test.ts

import fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"

import type { ProviderName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { importSettings, exportSettings } from "../importExport"
import { ProviderSettingsManager } from "../ProviderSettingsManager"
import { ContextProxy } from "../ContextProxy"
import { CustomModesManager } from "../CustomModesManager"

jest.mock("vscode", () => ({
	window: {
		showOpenDialog: jest.fn(),
		showSaveDialog: jest.fn(),
	},
	Uri: {
		file: jest.fn((filePath) => ({ fsPath: filePath })),
	},
}))

jest.mock("fs/promises", () => ({
	readFile: jest.fn(),
	mkdir: jest.fn(),
	writeFile: jest.fn(),
}))

jest.mock("os", () => ({
	homedir: jest.fn(() => "/mock/home"),
}))

describe("importExport", () => {
	let mockProviderSettingsManager: jest.Mocked<ProviderSettingsManager>
	let mockContextProxy: jest.Mocked<ContextProxy>
	let mockExtensionContext: jest.Mocked<vscode.ExtensionContext>
	let mockCustomModesManager: jest.Mocked<CustomModesManager>

	beforeEach(() => {
		jest.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		mockProviderSettingsManager = {
			export: jest.fn(),
			import: jest.fn(),
			listConfig: jest.fn(),
		} as unknown as jest.Mocked<ProviderSettingsManager>

		mockContextProxy = {
			setValues: jest.fn(),
			setValue: jest.fn(),
			export: jest.fn().mockImplementation(() => Promise.resolve({})),
			setProviderSettings: jest.fn(),
		} as unknown as jest.Mocked<ContextProxy>

		mockCustomModesManager = { updateCustomMode: jest.fn() } as unknown as jest.Mocked<CustomModesManager>

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
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(undefined)

			const result = await importSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
				customModesManager: mockCustomModesManager,
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
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			const mockFileContent = JSON.stringify({
				providerProfiles: {
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "test-id" } },
				},
				globalSettings: { mode: "code", autoApprovalEnabled: true },
			})

			;(fs.readFile as jest.Mock).mockResolvedValue(mockFileContent)

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
				...previousProviderProfiles,
				currentApiConfigName: "test",
				apiConfigs: { test: { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "test-id" } },
			})

			expect(mockContextProxy.setValues).toHaveBeenCalledWith({ mode: "code", autoApprovalEnabled: true })
			expect(mockContextProxy.setValue).toHaveBeenCalledWith("currentApiConfigName", "test")

			expect(mockContextProxy.setValue).toHaveBeenCalledWith("listApiConfigMeta", [
				{ name: "test", id: "test-id", apiProvider: "openai" as ProviderName },
				{ name: "default", id: "default-id", apiProvider: "anthropic" as ProviderName },
			])
		})

		it("should return success: false when file content is invalid", async () => {
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			// Invalid content (missing required fields).
			const mockInvalidContent = JSON.stringify({
				providerProfiles: { apiConfigs: {} },
				globalSettings: {},
			})

			;(fs.readFile as jest.Mock).mockResolvedValue(mockInvalidContent)

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
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			const mockFileContent = JSON.stringify({
				providerProfiles: {
					currentApiConfigName: "test",
					apiConfigs: { test: { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "test-id" } },
				},
			})

			;(fs.readFile as jest.Mock).mockResolvedValue(mockFileContent)

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
				...previousProviderProfiles,
				currentApiConfigName: "test",
				apiConfigs: {
					test: { apiProvider: "openai" as ProviderName, apiKey: "test-key", id: "test-id" },
				},
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
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			const mockInvalidJson = "{ this is not valid JSON }"
			;(fs.readFile as jest.Mock).mockResolvedValue(mockInvalidJson)

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
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])
			;(fs.readFile as jest.Mock).mockRejectedValue(new Error("File read error"))

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
				customModesManager: mockCustomModesManager,
			})

			expect(result.success).toBe(true)
			expect(result.providerProfiles?.apiConfigs["openai"]).toBeDefined()
			expect(result.providerProfiles?.apiConfigs["default"]).toBeDefined()
			expect(result.providerProfiles?.apiConfigs["default"].apiProvider).toBe("anthropic")
		})

		it("should call updateCustomMode for each custom mode in config", async () => {
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([{ fsPath: "/mock/path/settings.json" }])

			const customModes = [
				{ slug: "mode1", name: "Mode One", roleDefinition: "Custom role one", groups: [] },
				{ slug: "mode2", name: "Mode Two", roleDefinition: "Custom role two", groups: [] },
			]

			const mockFileContent = JSON.stringify({
				providerProfiles: { currentApiConfigName: "test", apiConfigs: {} },
				globalSettings: { mode: "code", customModes },
			})

			;(fs.readFile as jest.Mock).mockResolvedValue(mockFileContent)

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
	})

	describe("exportSettings", () => {
		it("should not export settings when user cancels file selection", async () => {
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
			;(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({
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

			expect(fs.writeFile).toHaveBeenCalledWith(
				"/mock/path/roo-code-settings.json",
				JSON.stringify({ providerProfiles: mockProviderProfiles, globalSettings: mockGlobalSettings }, null, 2),
				"utf-8",
			)
		})

		it("should include globalSettings when allowedMaxRequests is null", async () => {
			;(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({
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

			expect(fs.writeFile).toHaveBeenCalledWith(
				"/mock/path/roo-code-settings.json",
				JSON.stringify({ providerProfiles: mockProviderProfiles, globalSettings: mockGlobalSettings }, null, 2),
				"utf-8",
			)
		})

		it("should handle errors during the export process", async () => {
			;(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			mockProviderSettingsManager.export.mockResolvedValue({
				currentApiConfigName: "test",
				apiConfigs: { test: { apiProvider: "openai" as ProviderName, id: "test-id" } },
				migrations: { rateLimitSecondsMigrated: false },
			})

			mockContextProxy.export.mockResolvedValue({ mode: "code" })
			;(fs.writeFile as jest.Mock).mockRejectedValue(new Error("Write error"))

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalled()
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()
			expect(mockContextProxy.export).toHaveBeenCalled()
			expect(fs.mkdir).toHaveBeenCalledWith("/mock/path", { recursive: true })
			expect(fs.writeFile).toHaveBeenCalled()
			// The error is caught and the function exits silently.
		})

		it("should handle errors during directory creation", async () => {
			;(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue({
				fsPath: "/mock/path/roo-code-settings.json",
			})

			mockProviderSettingsManager.export.mockResolvedValue({
				currentApiConfigName: "test",
				apiConfigs: { test: { apiProvider: "openai" as ProviderName, id: "test-id" } },
				migrations: { rateLimitSecondsMigrated: false },
			})

			mockContextProxy.export.mockResolvedValue({ mode: "code" })
			;(fs.mkdir as jest.Mock).mockRejectedValue(new Error("Directory creation error"))

			await exportSettings({
				providerSettingsManager: mockProviderSettingsManager,
				contextProxy: mockContextProxy,
			})

			expect(vscode.window.showSaveDialog).toHaveBeenCalled()
			expect(mockProviderSettingsManager.export).toHaveBeenCalled()
			expect(mockContextProxy.export).toHaveBeenCalled()
			expect(fs.mkdir).toHaveBeenCalled()
			expect(fs.writeFile).not.toHaveBeenCalled() // Should not be called since mkdir failed.
		})

		it("should use the correct default save location", async () => {
			;(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(undefined)

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
