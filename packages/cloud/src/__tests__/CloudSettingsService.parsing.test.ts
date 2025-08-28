// pnpm test src/__tests__/CloudSettingsService.parsing.test.ts

import type { ExtensionContext } from "vscode"

import type { AuthService } from "@roo-code/types"

import { CloudSettingsService } from "../CloudSettingsService.js"

describe("CloudSettingsService - Response Parsing", () => {
	let mockContext: ExtensionContext
	let mockAuthService: AuthService
	let service: CloudSettingsService

	beforeEach(() => {
		// Mock ExtensionContext
		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn().mockResolvedValue(undefined),
			},
		} as unknown as ExtensionContext

		// Mock AuthService with active session
		mockAuthService = {
			getState: vi.fn().mockReturnValue("active-session"),
			hasActiveSession: vi.fn().mockReturnValue(true),
			getSessionToken: vi.fn().mockReturnValue("test-token"),
			on: vi.fn(),
			removeListener: vi.fn(),
		} as unknown as AuthService

		service = new CloudSettingsService(mockContext, mockAuthService, vi.fn())
	})

	it("should successfully parse valid extension settings response", async () => {
		// Mock fetch response with a valid settings structure
		const mockResponse = {
			organization: {
				version: 1,
				defaultSettings: {},
				allowList: {
					allowAll: true,
					providers: {},
				},
			},
			user: {
				features: {},
				settings: {},
				version: 1,
			},
		}

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue(mockResponse),
		})

		// Initialize the service
		await service.initialize()

		// Wait for the fetch to be called (timer executes immediately but asynchronously)
		await vi.waitFor(() => {
			expect(global.fetch).toHaveBeenCalled()
		})

		// Wait a bit for the async processing to complete
		await new Promise((resolve) => setTimeout(resolve, 10))

		// Verify settings were parsed correctly
		const orgSettings = service.getSettings()
		const userSettings = service.getUserSettings()

		expect(orgSettings).toEqual(mockResponse.organization)
		expect(userSettings).toEqual(mockResponse.user)
	})

	it("should handle complex nested provider settings without type errors", async () => {
		// Mock response with complex nested provider settings
		const mockResponse = {
			organization: {
				version: 2,
				defaultSettings: {
					maxOpenTabsContext: 10,
					maxReadFileLine: 1000,
				},
				allowList: {
					allowAll: false,
					providers: {
						anthropic: {
							allowAll: true,
						},
						openai: {
							allowAll: false,
							models: ["gpt-4", "gpt-3.5-turbo"],
						},
					},
				},
				providerProfiles: {
					default: {
						id: "default",
						apiProvider: "anthropic",
						apiModelId: "claude-3-opus-20240229",
						apiKey: "test-key",
						modelTemperature: 0.7,
					},
				},
			},
			user: {
				features: {
					roomoteControlEnabled: true,
				},
				settings: {
					extensionBridgeEnabled: true,
				},
				version: 1,
			},
		}

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue(mockResponse),
		})

		// Initialize the service
		await service.initialize()

		// Wait for the fetch to be called (timer executes immediately but asynchronously)
		await vi.waitFor(() => {
			expect(global.fetch).toHaveBeenCalled()
		})

		// Wait a bit for the async processing to complete
		await new Promise((resolve) => setTimeout(resolve, 10))

		// Verify complex settings were parsed correctly
		const orgSettings = service.getSettings()
		const userSettings = service.getUserSettings()

		expect(orgSettings).toEqual(mockResponse.organization)
		expect(userSettings).toEqual(mockResponse.user)
		expect(orgSettings?.providerProfiles?.default).toBeDefined()
	})

	it("should handle invalid response gracefully", async () => {
		// Mock invalid response
		const mockResponse = {
			organization: {
				// Missing required fields
				version: 1,
			},
			user: {
				// Missing required fields
				version: 1,
			},
		}

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: vi.fn().mockResolvedValue(mockResponse),
		})

		// Initialize the service
		await service.initialize()

		// Settings should remain undefined due to validation failure
		const orgSettings = service.getSettings()
		const userSettings = service.getUserSettings()

		expect(orgSettings).toBeUndefined()
		expect(userSettings).toBeUndefined()
	})
})
