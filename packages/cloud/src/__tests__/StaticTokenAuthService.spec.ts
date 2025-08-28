import type { ExtensionContext } from "vscode"

import { StaticTokenAuthService } from "../StaticTokenAuthService.js"

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
	let mockContext: ExtensionContext
	let mockLog: (...args: unknown[]) => void
	const testToken = "test-static-token"

	// Job token (t:'cj') with userId and orgId - sub is CloudJob ID
	const jobTokenWithOrg =
		"eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJyY2MiLCJzdWIiOiIzIiwiZXhwIjoxNzU2Mjc5NzU0LCJpYXQiOjE3NTYyNzU4NTQsIm5iZiI6MTc1NjI3NTgyNCwidiI6MSwiciI6eyJ1IjoidXNlcl8yeG1CaGVqTmVEVHdhbk04Q2dJT25NZ1Z4ekMiLCJvIjoib3JnXzEyM2FiYyIsInQiOiJjaiJ9fQ.k6VgV0cZUbx75kdedaeAsVYSRT7PzxDOCseLowq6moX92B4QuqtNkPRLKtQX7pJCxjuqRwEjJxmfTeXtQ82Pyg"

	// Job token without orgId (orgId was null during creation)
	const jobTokenNoOrg =
		"eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJyY2MiLCJzdWIiOiI1IiwiZXhwIjoxNzU2Mjc5NzU0LCJpYXQiOjE3NTYyNzU4NTQsIm5iZiI6MTc1NjI3NTgyNCwidiI6MSwiciI6eyJ1IjoidXNlcl8yeG1CaGVqTmVEVHdhbk04Q2dJT25NZ1Z4ekMiLCJ0IjoiY2oifX0.signature"

	// Auth token (t:'auth') - sub is User ID
	const authToken =
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJyY2MiLCJzdWIiOiJ1c2VyXzEyMyIsImV4cCI6MTc1NjI3OTc1NCwiaWF0IjoxNzU2Mjc1ODU0LCJuYmYiOjE3NTYyNzU4MjQsInYiOjEsInIiOnsidSI6InVzZXJfMTIzIiwidCI6ImF1dGgifX0.signature"

	// JWT without the 'r' field (legacy format)
	const legacyJWT =
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsImlhdCI6MTUxNjIzOTAyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"

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
		mockContext = mockContextPartial as unknown as ExtensionContext

		authService = new StaticTokenAuthService(mockContext, testToken, mockLog)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("constructor", () => {
		it("should create instance and log static token mode", () => {
			expect(authService).toBeInstanceOf(StaticTokenAuthService)
			expect(mockLog).toHaveBeenCalledWith("[auth] Using StaticTokenAuthService")
		})

		it("should use console.log as default logger", () => {
			const serviceWithoutLog = new StaticTokenAuthService(mockContext as unknown as ExtensionContext, testToken)
			// Can't directly test console.log usage, but constructor should not throw
			expect(serviceWithoutLog).toBeInstanceOf(StaticTokenAuthService)
		})

		it("should parse job token with orgId and extract userId from r.u", () => {
			const serviceWithJWT = new StaticTokenAuthService(mockContext, jobTokenWithOrg, mockLog)

			const userInfo = serviceWithJWT.getUserInfo()
			expect(userInfo?.id).toBe("user_2xmBhejNeDTwanM8CgIOnMgVxzC")
			expect(userInfo?.organizationId).toBe("org_123abc")
			expect(userInfo?.extensionBridgeEnabled).toBe(true)
		})

		it("should parse job token without orgId (null orgId case)", () => {
			const serviceWithJWT = new StaticTokenAuthService(mockContext, jobTokenNoOrg, mockLog)

			const userInfo = serviceWithJWT.getUserInfo()
			expect(userInfo?.id).toBe("user_2xmBhejNeDTwanM8CgIOnMgVxzC")
			expect(userInfo?.organizationId).toBeUndefined()
			expect(userInfo?.extensionBridgeEnabled).toBe(true)
		})

		it("should parse auth token and extract userId from r.u", () => {
			const serviceWithAuthToken = new StaticTokenAuthService(mockContext, authToken, mockLog)

			const userInfo = serviceWithAuthToken.getUserInfo()
			expect(userInfo?.id).toBe("user_123")
			expect(userInfo?.organizationId).toBeUndefined()
			expect(userInfo?.extensionBridgeEnabled).toBe(true)
		})

		it("should handle legacy JWT format with sub field", () => {
			const serviceWithLegacyJWT = new StaticTokenAuthService(mockContext, legacyJWT, mockLog)

			const userInfo = serviceWithLegacyJWT.getUserInfo()
			expect(userInfo?.id).toBe("user_123")
			expect(userInfo?.organizationId).toBeUndefined()
			expect(userInfo?.extensionBridgeEnabled).toBe(true)
		})

		it("should handle invalid JWT gracefully", () => {
			const serviceWithInvalidJWT = new StaticTokenAuthService(mockContext, "invalid-jwt-token", mockLog)

			const userInfo = serviceWithInvalidJWT.getUserInfo()
			expect(userInfo?.id).toBeUndefined()
			expect(userInfo?.organizationId).toBeUndefined()
			expect(userInfo?.extensionBridgeEnabled).toBe(true)

			expect(mockLog).toHaveBeenCalledWith("[auth] Failed to parse JWT:", expect.any(Error))
		})

		it("should handle malformed JWT payload", () => {
			// JWT with invalid base64 in payload
			const malformedJWT = "header.!!!invalid-base64!!!.signature"
			const serviceWithMalformedJWT = new StaticTokenAuthService(mockContext, malformedJWT, mockLog)

			const userInfo = serviceWithMalformedJWT.getUserInfo()
			expect(userInfo?.id).toBeUndefined()
			expect(userInfo?.organizationId).toBeUndefined()

			expect(mockLog).toHaveBeenCalledWith("[auth] Failed to parse JWT:", expect.any(Error))
		})
	})

	describe("initialize", () => {
		it("should start in active-session state", async () => {
			await authService.initialize()
			expect(authService.getState()).toBe("active-session")
		})

		it("should not emit events on initialize", async () => {
			const authStateChangedSpy = vi.fn()
			const userInfoSpy = vi.fn()

			authService.on("auth-state-changed", authStateChangedSpy)
			authService.on("user-info", userInfoSpy)

			await authService.initialize()

			expect(authStateChangedSpy).not.toHaveBeenCalled()
			expect(userInfoSpy).not.toHaveBeenCalled()
		})
	})

	describe("broadcast", () => {
		it("should emit auth-state-changed event", () => {
			const spy = vi.fn()
			authService.on("auth-state-changed", spy)

			authService.broadcast()

			expect(spy).toHaveBeenCalledWith({
				state: "active-session",
				previousState: "initializing",
			})
		})

		it("should emit user-info event", () => {
			const spy = vi.fn()
			authService.on("user-info", spy)

			authService.broadcast()

			expect(spy).toHaveBeenCalledWith({
				userInfo: expect.objectContaining({
					extensionBridgeEnabled: true,
				}),
			})
		})

		it("should emit user-info with parsed JWT data", () => {
			const serviceWithJWT = new StaticTokenAuthService(mockContext, jobTokenWithOrg, mockLog)

			const spy = vi.fn()
			serviceWithJWT.on("user-info", spy)

			serviceWithJWT.broadcast()

			expect(spy).toHaveBeenCalledWith({
				userInfo: {
					extensionBridgeEnabled: true,
					id: "user_2xmBhejNeDTwanM8CgIOnMgVxzC",
					organizationId: "org_123abc",
				},
			})
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
		it("should return object with extensionBridgeEnabled flag", () => {
			const userInfo = authService.getUserInfo()
			expect(userInfo).toHaveProperty("extensionBridgeEnabled")
			expect(userInfo?.extensionBridgeEnabled).toBe(true)
		})
	})

	describe("getStoredOrganizationId", () => {
		it("should return null for non-JWT token", () => {
			expect(authService.getStoredOrganizationId()).toBeNull()
		})

		it("should return organizationId from parsed JWT", () => {
			const serviceWithJWT = new StaticTokenAuthService(mockContext, jobTokenWithOrg, mockLog)

			expect(serviceWithJWT.getStoredOrganizationId()).toBe("org_123abc")
		})

		it("should return null when JWT has no organizationId", () => {
			const serviceWithNoOrg = new StaticTokenAuthService(mockContext, jobTokenNoOrg, mockLog)

			expect(serviceWithNoOrg.getStoredOrganizationId()).toBeNull()
		})

		it("should return null for legacy JWT format", () => {
			const serviceWithLegacyJWT = new StaticTokenAuthService(mockContext, legacyJWT, mockLog)

			expect(serviceWithLegacyJWT.getStoredOrganizationId()).toBeNull()
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
		it("should be able to register and emit events via broadcast", () => {
			const authStateChangedSpy = vi.fn()
			const userInfoSpy = vi.fn()

			authService.on("auth-state-changed", authStateChangedSpy)
			authService.on("user-info", userInfoSpy)

			authService.broadcast()

			expect(authStateChangedSpy).toHaveBeenCalledWith({
				state: "active-session",
				previousState: "initializing",
			})

			expect(userInfoSpy).toHaveBeenCalledWith({
				userInfo: expect.objectContaining({
					extensionBridgeEnabled: true,
				}),
			})
		})
	})
})
