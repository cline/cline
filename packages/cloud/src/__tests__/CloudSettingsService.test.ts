import type { ExtensionContext } from "vscode"

import type { OrganizationSettings, AuthService } from "@roo-code/types"

import { CloudSettingsService } from "../CloudSettingsService.js"
import { RefreshTimer } from "../RefreshTimer.js"

vi.mock("../RefreshTimer")

vi.mock("../config", () => ({
	getRooCodeApiUrl: vi.fn().mockReturnValue("https://app.roocode.com"),
}))

global.fetch = vi.fn()

describe("CloudSettingsService", () => {
	let mockContext: ExtensionContext
	let mockAuthService: {
		getState: ReturnType<typeof vi.fn>
		getSessionToken: ReturnType<typeof vi.fn>
		hasActiveSession: ReturnType<typeof vi.fn>
		on: ReturnType<typeof vi.fn>
		getStoredOrganizationId: ReturnType<typeof vi.fn>
	}
	let mockRefreshTimer: {
		start: ReturnType<typeof vi.fn>
		stop: ReturnType<typeof vi.fn>
	}
	let cloudSettingsService: CloudSettingsService
	let mockLog: ReturnType<typeof vi.fn>

	const mockSettings: OrganizationSettings = {
		version: 1,
		defaultSettings: {},
		allowList: {
			allowAll: true,
			providers: {},
		},
	}

	const mockUserSettings = {
		features: {},
		settings: {},
		version: 1,
	}

	const mockExtensionSettingsResponse = {
		organization: mockSettings,
		user: mockUserSettings,
	}

	beforeEach(() => {
		vi.clearAllMocks()

		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn().mockResolvedValue(undefined),
			},
		} as unknown as ExtensionContext

		mockAuthService = {
			getState: vi.fn().mockReturnValue("logged-out"),
			getSessionToken: vi.fn(),
			hasActiveSession: vi.fn().mockReturnValue(false),
			on: vi.fn(),
			getStoredOrganizationId: vi.fn().mockReturnValue(null),
		}

		mockRefreshTimer = {
			start: vi.fn(),
			stop: vi.fn(),
		}

		mockLog = vi.fn()

		// Mock RefreshTimer constructor
		vi.mocked(RefreshTimer).mockImplementation(() => mockRefreshTimer as unknown as RefreshTimer)

		cloudSettingsService = new CloudSettingsService(mockContext, mockAuthService as unknown as AuthService, mockLog)
	})

	afterEach(() => {
		cloudSettingsService.dispose()
	})

	describe("constructor", () => {
		it("should create CloudSettingsService with proper dependencies", () => {
			expect(cloudSettingsService).toBeInstanceOf(CloudSettingsService)
			expect(RefreshTimer).toHaveBeenCalledWith({
				callback: expect.any(Function),
				successInterval: 30000,
				initialBackoffMs: 1000,
				maxBackoffMs: 30000,
			})
		})

		it("should use console.log as default logger when none provided", () => {
			const service = new CloudSettingsService(mockContext, mockAuthService as unknown as AuthService)
			expect(service).toBeInstanceOf(CloudSettingsService)
		})
	})

	describe("initialize", () => {
		it("should load cached settings on initialization", async () => {
			const cachedSettings = {
				version: 1,
				defaultSettings: {},
				allowList: { allowAll: true, providers: {} },
			}

			// Create a fresh mock context for this test
			const testContext = {
				globalState: {
					get: vi.fn((key: string) => {
						if (key === "organization-settings") return cachedSettings
						if (key === "user-settings") return mockUserSettings
						return undefined
					}),
					update: vi.fn().mockResolvedValue(undefined),
				},
			} as unknown as ExtensionContext

			// Mock auth service to not be logged out
			const testAuthService = {
				getState: vi.fn().mockReturnValue("active"),
				getSessionToken: vi.fn(),
				hasActiveSession: vi.fn().mockReturnValue(false),
				on: vi.fn(),
			}

			// Create a new instance to test initialization
			const testService = new CloudSettingsService(
				testContext,
				testAuthService as unknown as AuthService,
				mockLog,
			)
			await testService.initialize()

			expect(testContext.globalState.get).toHaveBeenCalledWith("organization-settings")
			expect(testContext.globalState.get).toHaveBeenCalledWith("user-settings")
			expect(testService.getSettings()).toEqual(cachedSettings)

			testService.dispose()
		})

		it("should clear cached settings if user is logged out", async () => {
			const cachedSettings = {
				version: 1,
				defaultSettings: {},
				allowList: { allowAll: true, providers: {} },
			}
			mockContext.globalState.get = vi.fn((key: string) => {
				if (key === "organization-settings") return cachedSettings
				if (key === "user-settings") return mockUserSettings
				return undefined
			})
			mockAuthService.getState.mockReturnValue("logged-out")

			await cloudSettingsService.initialize()

			// Check that both cache keys are cleared
			const updateCalls = vi.mocked(mockContext.globalState.update).mock.calls
			const orgSettingsCall = updateCalls.find((call) => call[0] === "organization-settings")
			const userSettingsCall = updateCalls.find((call) => call[0] === "user-settings")

			expect(orgSettingsCall).toBeDefined()
			expect(orgSettingsCall?.[1]).toBeUndefined()
			expect(userSettingsCall).toBeDefined()
			expect(userSettingsCall?.[1]).toBeUndefined()
		})

		it("should set up auth service event listeners", async () => {
			await cloudSettingsService.initialize()

			expect(mockAuthService.on).toHaveBeenCalledWith("auth-state-changed", expect.any(Function))
		})

		it("should start timer if user has active session", async () => {
			mockAuthService.hasActiveSession.mockReturnValue(true)

			await cloudSettingsService.initialize()

			expect(mockRefreshTimer.start).toHaveBeenCalled()
		})

		it("should not start timer if user has no active session", async () => {
			mockAuthService.hasActiveSession.mockReturnValue(false)

			await cloudSettingsService.initialize()

			expect(mockRefreshTimer.start).not.toHaveBeenCalled()
		})
	})

	describe("event emission", () => {
		beforeEach(async () => {
			await cloudSettingsService.initialize()
		})

		it("should emit 'settings-updated' event when settings change", async () => {
			const eventSpy = vi.fn()
			cloudSettingsService.on("settings-updated", eventSpy)

			mockAuthService.getSessionToken.mockReturnValue("valid-token")
			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue(mockExtensionSettingsResponse),
			} as unknown as Response)

			// Get the callback function passed to RefreshTimer
			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0]?.[0]?.callback

			await timerCallback?.()

			expect(eventSpy).toHaveBeenCalledWith({})
		})

		it("should emit event when either org or user settings change", async () => {
			const eventSpy = vi.fn()

			const previousSettings = {
				version: 1,
				defaultSettings: {},
				allowList: { allowAll: true, providers: {} },
			}
			const newSettings = {
				version: 2,
				defaultSettings: {},
				allowList: { allowAll: true, providers: {} },
			}

			// Create a fresh mock context for this test
			const testContext = {
				globalState: {
					get: vi.fn((key: string) => {
						if (key === "organization-settings") return previousSettings
						if (key === "user-settings") return mockUserSettings
						return undefined
					}),
					update: vi.fn().mockResolvedValue(undefined),
				},
			} as unknown as ExtensionContext

			// Mock auth service to not be logged out
			const testAuthService = {
				getState: vi.fn().mockReturnValue("active"),
				getSessionToken: vi.fn().mockReturnValue("valid-token"),
				hasActiveSession: vi.fn().mockReturnValue(false),
				on: vi.fn(),
			}

			// Create a new service instance with cached settings
			const testService = new CloudSettingsService(
				testContext,
				testAuthService as unknown as AuthService,
				mockLog,
			)
			testService.on("settings-updated", eventSpy)
			await testService.initialize()

			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					organization: newSettings,
					user: mockUserSettings,
				}),
			} as unknown as Response)

			// Get the callback function passed to RefreshTimer for this instance
			const timerCallback =
				vi.mocked(RefreshTimer).mock.calls[vi.mocked(RefreshTimer).mock.calls.length - 1]?.[0]?.callback

			await timerCallback?.()

			expect(eventSpy).toHaveBeenCalledWith({})

			testService.dispose()
		})

		it("should not emit event when settings version is unchanged", async () => {
			const eventSpy = vi.fn()

			// Create a fresh mock context for this test
			const testContext = {
				globalState: {
					get: vi.fn((key: string) => {
						if (key === "organization-settings") return mockSettings
						if (key === "user-settings") return mockUserSettings
						return undefined
					}),
					update: vi.fn().mockResolvedValue(undefined),
				},
			} as unknown as ExtensionContext

			// Mock auth service to not be logged out
			const testAuthService = {
				getState: vi.fn().mockReturnValue("active"),
				getSessionToken: vi.fn().mockReturnValue("valid-token"),
				hasActiveSession: vi.fn().mockReturnValue(false),
				on: vi.fn(),
			}

			// Create a new service instance with cached settings
			const testService = new CloudSettingsService(
				testContext,
				testAuthService as unknown as AuthService,
				mockLog,
			)
			testService.on("settings-updated", eventSpy)
			await testService.initialize()

			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue(mockExtensionSettingsResponse), // Same version
			} as unknown as Response)

			// Get the callback function passed to RefreshTimer for this instance
			const timerCallback =
				vi.mocked(RefreshTimer).mock.calls[vi.mocked(RefreshTimer).mock.calls.length - 1]?.[0]?.callback

			await timerCallback?.()

			expect(eventSpy).not.toHaveBeenCalled()

			testService.dispose()
		})

		it("should not emit event when fetch fails", async () => {
			const eventSpy = vi.fn()
			cloudSettingsService.on("settings-updated", eventSpy)

			mockAuthService.getSessionToken.mockReturnValue("valid-token")
			vi.mocked(fetch).mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			} as unknown as Response)

			// Get the callback function passed to RefreshTimer
			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0]?.[0]?.callback

			await timerCallback?.()

			expect(eventSpy).not.toHaveBeenCalled()
		})

		it("should not emit event when no auth token available", async () => {
			const eventSpy = vi.fn()
			cloudSettingsService.on("settings-updated", eventSpy)

			mockAuthService.getSessionToken.mockReturnValue(null)

			// Get the callback function passed to RefreshTimer
			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0]?.[0]?.callback

			await timerCallback?.()

			expect(eventSpy).not.toHaveBeenCalled()
			expect(fetch).not.toHaveBeenCalled()
		})
	})

	describe("fetchSettings", () => {
		beforeEach(async () => {
			await cloudSettingsService.initialize()
		})

		it("should fetch and cache settings successfully", async () => {
			mockAuthService.getSessionToken.mockReturnValue("valid-token")
			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue(mockExtensionSettingsResponse),
			} as unknown as Response)

			// Get the callback function passed to RefreshTimer
			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0]?.[0]?.callback

			const result = await timerCallback?.()

			expect(result).toBe(true)

			expect(fetch).toHaveBeenCalledWith("https://app.roocode.com/api/extension-settings", {
				headers: {
					Authorization: "Bearer valid-token",
				},
			})

			expect(mockContext.globalState.update).toHaveBeenCalledWith("organization-settings", mockSettings)
			expect(mockContext.globalState.update).toHaveBeenCalledWith("user-settings", mockUserSettings)
		})

		it("should handle fetch errors gracefully", async () => {
			mockAuthService.getSessionToken.mockReturnValue("valid-token")
			vi.mocked(fetch).mockRejectedValue(new Error("Network error"))

			// Get the callback function passed to RefreshTimer
			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0]?.[0]?.callback

			const result = await timerCallback?.()

			expect(result).toBe(false)

			expect(mockLog).toHaveBeenCalledWith(
				"[cloud-settings] Error fetching extension settings:",
				expect.any(Error),
			)
		})

		it("should handle invalid response format", async () => {
			mockAuthService.getSessionToken.mockReturnValue("valid-token")
			vi.mocked(fetch).mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({ invalid: "data" }),
			} as unknown as Response)

			// Get the callback function passed to RefreshTimer
			const timerCallback = vi.mocked(RefreshTimer).mock.calls[0]?.[0]?.callback

			const result = await timerCallback?.()

			expect(result).toBe(false)

			expect(mockLog).toHaveBeenCalledWith(
				"[cloud-settings] Invalid extension settings format:",
				expect.any(Object),
			)
		})
	})

	describe("getAllowList", () => {
		it("should return settings allowList when available", async () => {
			mockContext.globalState.get = vi.fn((key: string) => {
				if (key === "organization-settings") return mockSettings
				return undefined
			})
			await cloudSettingsService.initialize()

			const allowList = cloudSettingsService.getAllowList()
			expect(allowList).toEqual(mockSettings.allowList)
		})

		it("should return default allow all when no settings available", () => {
			const allowList = cloudSettingsService.getAllowList()
			expect(allowList).toEqual({ allowAll: true, providers: {} })
		})
	})

	describe("getSettings", () => {
		it("should return current settings", async () => {
			// Create a fresh mock context for this test
			const testContext = {
				globalState: {
					get: vi.fn((key: string) => {
						if (key === "organization-settings") return mockSettings
						return undefined
					}),
					update: vi.fn().mockResolvedValue(undefined),
				},
			} as unknown as ExtensionContext

			// Mock auth service to not be logged out
			const testAuthService = {
				getState: vi.fn().mockReturnValue("active"),
				getSessionToken: vi.fn(),
				hasActiveSession: vi.fn().mockReturnValue(false),
				on: vi.fn(),
			}

			const testService = new CloudSettingsService(
				testContext,
				testAuthService as unknown as AuthService,
				mockLog,
			)
			await testService.initialize()

			const settings = testService.getSettings()
			expect(settings).toEqual(mockSettings)

			testService.dispose()
		})

		it("should return undefined when no settings available", () => {
			const settings = cloudSettingsService.getSettings()
			expect(settings).toBeUndefined()
		})
	})

	describe("dispose", () => {
		it("should remove all listeners and stop timer", () => {
			const removeAllListenersSpy = vi.spyOn(cloudSettingsService, "removeAllListeners")

			cloudSettingsService.dispose()

			expect(removeAllListenersSpy).toHaveBeenCalled()
			expect(mockRefreshTimer.stop).toHaveBeenCalled()
		})
	})

	describe("auth service event handlers", () => {
		it("should start timer when auth-state-changed event is triggered with active-session", async () => {
			await cloudSettingsService.initialize()

			// Get the auth-state-changed handler
			const authStateChangedHandler = mockAuthService.on.mock.calls.find(
				(call: string[]) => call[0] === "auth-state-changed",
			)?.[1]
			expect(authStateChangedHandler).toBeDefined()

			// Simulate active-session state change
			authStateChangedHandler({
				state: "active-session",
				previousState: "attempting-session",
			})
			expect(mockRefreshTimer.start).toHaveBeenCalled()
		})

		it("should stop timer and remove settings when auth-state-changed event is triggered with logged-out", async () => {
			await cloudSettingsService.initialize()

			// Get the auth-state-changed handler
			const authStateChangedHandler = mockAuthService.on.mock.calls.find(
				(call: string[]) => call[0] === "auth-state-changed",
			)?.[1]
			expect(authStateChangedHandler).toBeDefined()

			// Simulate logged-out state change from active-session
			await authStateChangedHandler({
				state: "logged-out",
				previousState: "active-session",
			})
			expect(mockRefreshTimer.stop).toHaveBeenCalled()
			expect(mockContext.globalState.update).toHaveBeenCalledWith("organization-settings", undefined)
			expect(mockContext.globalState.update).toHaveBeenCalledWith("user-settings", undefined)
		})
	})

	describe("isTaskSyncEnabled", () => {
		beforeEach(async () => {
			await cloudSettingsService.initialize()
		})

		it("should return true when org recordTaskMessages is true", () => {
			// Set up mock settings with org recordTaskMessages = true
			const mockSettings = {
				version: 1,
				cloudSettings: {
					recordTaskMessages: true,
				},
				defaultSettings: {},
				allowList: { allowAll: true, providers: {} },
			}

			// Mock that user has organization ID (indicating org settings should be used)
			mockAuthService.getStoredOrganizationId.mockReturnValue("org-123")

			// Use reflection to set private settings
			;(cloudSettingsService as unknown as { settings: typeof mockSettings }).settings = mockSettings

			expect(cloudSettingsService.isTaskSyncEnabled()).toBe(true)
		})

		it("should return false when org recordTaskMessages is false", () => {
			// Set up mock settings with org recordTaskMessages = false
			const mockSettings = {
				version: 1,
				cloudSettings: {
					recordTaskMessages: false,
				},
				defaultSettings: {},
				allowList: { allowAll: true, providers: {} },
			}

			// Mock that user has organization ID (indicating org settings should be used)
			mockAuthService.getStoredOrganizationId.mockReturnValue("org-123")

			// Use reflection to set private settings
			;(cloudSettingsService as unknown as { settings: typeof mockSettings }).settings = mockSettings

			expect(cloudSettingsService.isTaskSyncEnabled()).toBe(false)
		})

		it("should fall back to user taskSyncEnabled when org recordTaskMessages is undefined", () => {
			// Set up mock settings with org recordTaskMessages undefined
			const mockSettings = {
				version: 1,
				cloudSettings: {},
				defaultSettings: {},
				allowList: { allowAll: true, providers: {} },
			}

			const mockUserSettings = {
				version: 1,
				features: {},
				settings: {
					taskSyncEnabled: true,
				},
			}

			// Mock that user has no organization ID (indicating user settings should be used)
			mockAuthService.getStoredOrganizationId.mockReturnValue(null)

			// Use reflection to set private settings
			;(cloudSettingsService as unknown as { settings: typeof mockSettings }).settings = mockSettings
			;(cloudSettingsService as unknown as { userSettings: typeof mockUserSettings }).userSettings =
				mockUserSettings

			expect(cloudSettingsService.isTaskSyncEnabled()).toBe(true)
		})

		it("should return false when user taskSyncEnabled is false", () => {
			// Set up mock settings with org recordTaskMessages undefined
			const mockSettings = {
				version: 1,
				cloudSettings: {},
				defaultSettings: {},
				allowList: { allowAll: true, providers: {} },
			}

			const mockUserSettings = {
				version: 1,
				features: {},
				settings: {
					taskSyncEnabled: false,
				},
			}

			// Mock that user has no organization ID (indicating user settings should be used)
			mockAuthService.getStoredOrganizationId.mockReturnValue(null)

			// Use reflection to set private settings
			;(cloudSettingsService as unknown as { settings: typeof mockSettings }).settings = mockSettings
			;(cloudSettingsService as unknown as { userSettings: typeof mockUserSettings }).userSettings =
				mockUserSettings

			expect(cloudSettingsService.isTaskSyncEnabled()).toBe(false)
		})

		it("should return true when user taskSyncEnabled is undefined (default)", () => {
			// Set up mock settings with org recordTaskMessages undefined
			const mockSettings = {
				version: 1,
				cloudSettings: {},
				defaultSettings: {},
				allowList: { allowAll: true, providers: {} },
			}

			const mockUserSettings = {
				version: 1,
				features: {},
				settings: {},
			}

			// Mock that user has no organization ID (indicating user settings should be used)
			mockAuthService.getStoredOrganizationId.mockReturnValue(null)

			// Use reflection to set private settings
			;(cloudSettingsService as unknown as { settings: typeof mockSettings }).settings = mockSettings
			;(cloudSettingsService as unknown as { userSettings: typeof mockUserSettings }).userSettings =
				mockUserSettings

			expect(cloudSettingsService.isTaskSyncEnabled()).toBe(true)
		})

		it("should return false when no settings are available", () => {
			// Mock that user has no organization ID
			mockAuthService.getStoredOrganizationId.mockReturnValue(null)

			// Clear both settings
			;(cloudSettingsService as unknown as { settings: undefined }).settings = undefined
			;(cloudSettingsService as unknown as { userSettings: undefined }).userSettings = undefined

			expect(cloudSettingsService.isTaskSyncEnabled()).toBe(false)
		})

		it("should return false when only org settings are available but cloudSettings is undefined", () => {
			const mockSettings = {
				version: 1,
				defaultSettings: {},
				allowList: { allowAll: true, providers: {} },
			}

			// Mock that user has organization ID (indicating org settings should be used)
			mockAuthService.getStoredOrganizationId.mockReturnValue("org-123")

			// Use reflection to set private settings
			;(cloudSettingsService as unknown as { settings: typeof mockSettings }).settings = mockSettings
			;(cloudSettingsService as unknown as { userSettings: undefined }).userSettings = undefined

			expect(cloudSettingsService.isTaskSyncEnabled()).toBe(false)
		})

		it("should prioritize org settings over user settings", () => {
			// Set up conflicting settings: org = false, user = true
			const mockSettings = {
				version: 1,
				cloudSettings: {
					recordTaskMessages: false,
				},
				defaultSettings: {},
				allowList: { allowAll: true, providers: {} },
			}

			const mockUserSettings = {
				version: 1,
				features: {},
				settings: {
					taskSyncEnabled: true,
				},
			}

			// Mock that user has organization ID (indicating org settings should be used)
			mockAuthService.getStoredOrganizationId.mockReturnValue("org-123")

			// Use reflection to set private settings
			;(cloudSettingsService as unknown as { settings: typeof mockSettings }).settings = mockSettings
			;(cloudSettingsService as unknown as { userSettings: typeof mockUserSettings }).userSettings =
				mockUserSettings

			// Should return false (org setting takes precedence)
			expect(cloudSettingsService.isTaskSyncEnabled()).toBe(false)
		})
	})
})
