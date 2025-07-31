import { describe, it, expect, beforeEach, vi } from "vitest"
import * as vscode from "vscode"

import { StaticTokenAuthService } from "../../auth/StaticTokenAuthService"

// Mock vscode
vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
	},
	env: {
		openExternal: vi.fn(),
		uriScheme: "vscode",
	},
	Uri: {
		parse: vi.fn(),
	},
}))

describe("StaticTokenAuthService", () => {
	let authService: StaticTokenAuthService
	let mockContext: vscode.ExtensionContext
	let mockLog: (...args: unknown[]) => void
	const testToken = "test-static-token"

	beforeEach(() => {
		mockLog = vi.fn()

		// Create a minimal mock that satisfies the constructor requirements
		const mockContextPartial = {
			extension: {
				packageJSON: {
					publisher: "TestPublisher",
					name: "test-extension",
				},
			},
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
			secrets: {
				get: vi.fn(),
				store: vi.fn(),
				delete: vi.fn(),
				onDidChange: vi.fn(),
			},
			subscriptions: [],
		}

		// Use type assertion for test mocking
		mockContext = mockContextPartial as unknown as vscode.ExtensionContext

		authService = new StaticTokenAuthService(mockContext, testToken, mockLog)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should create instance and log static token mode", () => {
			expect(authService).toBeInstanceOf(StaticTokenAuthService)
			expect(mockLog).toHaveBeenCalledWith("[auth] Using static token authentication mode")
		})

		it("should use console.log as default logger", () => {
			const serviceWithoutLog = new StaticTokenAuthService(
				mockContext as unknown as vscode.ExtensionContext,
				testToken,
			)
			// Can't directly test console.log usage, but constructor should not throw
			expect(serviceWithoutLog).toBeInstanceOf(StaticTokenAuthService)
		})
	})

	describe("initialize", () => {
		it("should start in active-session state", async () => {
			await authService.initialize()
			expect(authService.getState()).toBe("active-session")
		})

		it("should emit auth-state-changed event on initialize", async () => {
			const spy = vi.fn()
			authService.on("auth-state-changed", spy)

			await authService.initialize()

			expect(spy).toHaveBeenCalledWith({ state: "active-session", previousState: "initializing" })
		})

		it("should log successful initialization", async () => {
			await authService.initialize()
			expect(mockLog).toHaveBeenCalledWith("[auth] Static token auth service initialized in active-session state")
		})
	})

	describe("getSessionToken", () => {
		it("should return the provided token", () => {
			expect(authService.getSessionToken()).toBe(testToken)
		})

		it("should return different token when constructed with different token", () => {
			const differentToken = "different-token"
			const differentService = new StaticTokenAuthService(mockContext, differentToken, mockLog)
			expect(differentService.getSessionToken()).toBe(differentToken)
		})
	})

	describe("getUserInfo", () => {
		it("should return empty object", () => {
			expect(authService.getUserInfo()).toEqual({})
		})
	})

	describe("getStoredOrganizationId", () => {
		it("should return null", () => {
			expect(authService.getStoredOrganizationId()).toBeNull()
		})
	})

	describe("authentication state methods", () => {
		it("should always return true for isAuthenticated", () => {
			expect(authService.isAuthenticated()).toBe(true)
		})

		it("should always return true for hasActiveSession", () => {
			expect(authService.hasActiveSession()).toBe(true)
		})

		it("should always return true for hasOrIsAcquiringActiveSession", () => {
			expect(authService.hasOrIsAcquiringActiveSession()).toBe(true)
		})

		it("should return active-session for getState", () => {
			expect(authService.getState()).toBe("active-session")
		})
	})

	describe("disabled authentication methods", () => {
		const expectedErrorMessage = "Authentication methods are disabled in StaticTokenAuthService"

		it("should throw error for login", async () => {
			await expect(authService.login()).rejects.toThrow(expectedErrorMessage)
		})

		it("should throw error for logout", async () => {
			await expect(authService.logout()).rejects.toThrow(expectedErrorMessage)
		})

		it("should throw error for handleCallback", async () => {
			await expect(authService.handleCallback("code", "state")).rejects.toThrow(expectedErrorMessage)
		})

		it("should throw error for handleCallback with organization", async () => {
			await expect(authService.handleCallback("code", "state", "org_123")).rejects.toThrow(expectedErrorMessage)
		})
	})

	describe("event emission", () => {
		it("should be able to register and emit events", async () => {
			const authStateChangedSpy = vi.fn()
			const userInfoSpy = vi.fn()

			authService.on("auth-state-changed", authStateChangedSpy)
			authService.on("user-info", userInfoSpy)

			await authService.initialize()

			expect(authStateChangedSpy).toHaveBeenCalledWith({ state: "active-session", previousState: "initializing" })
			// user-info event is not emitted in static token mode
			expect(userInfoSpy).not.toHaveBeenCalled()
		})
	})
})
