// npx vitest run src/__tests__/CloudService.integration.test.ts

import * as vscode from "vscode"
import { CloudService } from "../CloudService"
import { StaticSettingsService } from "../StaticSettingsService"
import { CloudSettingsService } from "../CloudSettingsService"

vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	env: {
		openExternal: vi.fn(),
	},
	Uri: {
		parse: vi.fn(),
	},
}))

describe("CloudService Integration - Settings Service Selection", () => {
	let mockContext: vscode.ExtensionContext

	beforeEach(() => {
		CloudService.resetInstance()

		mockContext = {
			subscriptions: [],
			workspaceState: {
				get: vi.fn(),
				update: vi.fn(),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: {
				get: vi.fn(),
				store: vi.fn(),
				delete: vi.fn(),
				onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			},
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
				setKeysForSync: vi.fn(),
				keys: vi.fn().mockReturnValue([]),
			},
			extensionUri: { scheme: "file", path: "/mock/path" },
			extensionPath: "/mock/path",
			extensionMode: 1,
			asAbsolutePath: vi.fn((relativePath: string) => `/mock/path/${relativePath}`),
			storageUri: { scheme: "file", path: "/mock/storage" },
			extension: {
				packageJSON: {
					version: "1.0.0",
				},
			},
		} as unknown as vscode.ExtensionContext
	})

	afterEach(() => {
		CloudService.resetInstance()
		delete process.env.ROO_CODE_CLOUD_ORG_SETTINGS
		delete process.env.ROO_CODE_CLOUD_TOKEN
	})

	it("should use CloudSettingsService when no environment variable is set", async () => {
		// Ensure no environment variables are set
		delete process.env.ROO_CODE_CLOUD_ORG_SETTINGS
		delete process.env.ROO_CODE_CLOUD_TOKEN

		const cloudService = await CloudService.createInstance(mockContext)

		// Access the private settingsService to check its type
		const settingsService = (cloudService as unknown as { settingsService: unknown }).settingsService
		expect(settingsService).toBeInstanceOf(CloudSettingsService)
	})

	it("should use StaticSettingsService when ROO_CODE_CLOUD_ORG_SETTINGS is set", async () => {
		const validSettings = {
			version: 1,
			cloudSettings: {
				recordTaskMessages: true,
				enableTaskSharing: true,
				taskShareExpirationDays: 30,
			},
			defaultSettings: {
				enableCheckpoints: true,
			},
			allowList: {
				allowAll: true,
				providers: {},
			},
		}

		// Set the environment variable
		process.env.ROO_CODE_CLOUD_ORG_SETTINGS = Buffer.from(JSON.stringify(validSettings)).toString("base64")

		const cloudService = await CloudService.createInstance(mockContext)

		// Access the private settingsService to check its type
		const settingsService = (cloudService as unknown as { settingsService: unknown }).settingsService
		expect(settingsService).toBeInstanceOf(StaticSettingsService)

		// Verify the settings are correctly loaded
		expect(cloudService.getAllowList()).toEqual(validSettings.allowList)
	})

	it("should throw error when ROO_CODE_CLOUD_ORG_SETTINGS contains invalid data", async () => {
		// Set invalid environment variable
		process.env.ROO_CODE_CLOUD_ORG_SETTINGS = "invalid-base64-data"

		await expect(CloudService.createInstance(mockContext)).rejects.toThrow("Failed to initialize CloudService")
	})

	it("should prioritize static token auth when both environment variables are set", async () => {
		const validSettings = {
			version: 1,
			cloudSettings: {
				recordTaskMessages: true,
				enableTaskSharing: true,
				taskShareExpirationDays: 30,
			},
			defaultSettings: {
				enableCheckpoints: true,
			},
			allowList: {
				allowAll: true,
				providers: {},
			},
		}

		// Set both environment variables
		process.env.ROO_CODE_CLOUD_TOKEN = "test-token"
		process.env.ROO_CODE_CLOUD_ORG_SETTINGS = Buffer.from(JSON.stringify(validSettings)).toString("base64")

		const cloudService = await CloudService.createInstance(mockContext)

		// Should use StaticSettingsService for settings
		const settingsService = (cloudService as unknown as { settingsService: unknown }).settingsService
		expect(settingsService).toBeInstanceOf(StaticSettingsService)

		// Should use StaticTokenAuthService for auth (from the existing logic)
		expect(cloudService.isAuthenticated()).toBe(true)
		expect(cloudService.hasActiveSession()).toBe(true)
	})
})
