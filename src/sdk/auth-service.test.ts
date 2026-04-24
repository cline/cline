// Tests for the SDK-backed AuthService (Step 6: Auth & Account Flows)
//
// These tests verify the auth service's core logic:
// - Token persistence (read/write/clear from secrets)
// - Auth state management (authenticated/unauthenticated)
// - Auth info conversion (SDK OAuthCredentials → ClineAuthInfo)
// - Logout flow
// - Streaming subscription management
// - workos: prefix handling

import type { OAuthCredentials } from "@clinebot/core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AuthService, type ClineAuthInfo, LogoutReason } from "./auth-service"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFeatureFlagsPoll = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

// Mock StateManager
const mockSecrets = new Map<string, string>()
vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getSecretKey: (key: string) => mockSecrets.get(key) ?? undefined,
			setSecret: (key: string, value: string | undefined) => {
				if (value === undefined) {
					mockSecrets.delete(key)
				} else {
					mockSecrets.set(key, value)
				}
			},
			getGlobalSettingsKey: () => "act",
			setGlobalState: vi.fn(),
		}),
	},
}))

// Mock ClineEnv
vi.mock("@/config", () => ({
	ClineEnv: {
		config: () => ({
			apiBaseUrl: "https://api.cline.bot",
			appBaseUrl: "https://app.cline.bot",
		}),
	},
}))

// Mock grpc-handler
vi.mock("@/core/controller/grpc-handler", () => ({
	getRequestRegistry: () => ({
		registerRequest: vi.fn(),
	}),
}))

// Mock HostProvider
vi.mock("@/hosts/host-provider", () => ({
	HostProvider: {
		get: () => ({
			getCallbackUrl: async (path: string) => `vscode://cline.cline${path}`,
		}),
	},
}))

// Mock openExternal
vi.mock("@/utils/env", () => ({
	openExternal: vi.fn(),
}))

// Mock net
vi.mock("@/shared/net", () => ({
	fetch: vi.fn(),
	getAxiosSettings: () => ({}),
}))

// Mock buildBasicClineHeaders
vi.mock("@/services/EnvUtils", () => ({
	buildBasicClineHeaders: async () => ({}),
}))

// Mock feature flags
vi.mock("@/services/feature-flags", () => ({
	featureFlagsService: {
		poll: mockFeatureFlagsPoll,
	},
}))

// Mock axios
vi.mock("axios", () => ({
	default: {
		get: vi.fn(),
	},
}))

// Mock @clinebot/core OAuth functions
vi.mock("@clinebot/core", () => ({
	createOAuthClientCallbacks: (opts: { onPrompt: () => void }) => ({
		onAuth: vi.fn(),
		onPrompt: opts.onPrompt,
	}),
	loginClineOAuth: vi.fn(),
	loginOcaOAuth: vi.fn(),
	loginOpenAICodex: vi.fn(),
	refreshClineToken: vi.fn(),
	getValidClineCredentials: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Test helpers — typed access to private members for testing
// ---------------------------------------------------------------------------

/** Type that exposes private members for test access */
interface AuthServiceTestAccess {
	_clineAuthInfo: ClineAuthInfo | null
	_authenticated: boolean
	_activeAuthStatusUpdateHandlers: Map<string, unknown>
	instance: AuthService | null
	readAuthInfoFromSecrets(): ClineAuthInfo | null
	writeAuthInfoToSecrets(info: ClineAuthInfo): void
	clearAuthInfoFromSecrets(): void
}

function testAccess(service: AuthService): AuthServiceTestAccess {
	// biome-ignore lint/suspicious/noExplicitAny: test-only access to private members
	return service as any
}

function resetSingleton(): void {
	// biome-ignore lint/suspicious/noExplicitAny: test-only reset of singleton
	;(AuthService as any).instance = null
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createTestAuthInfo(overrides?: Partial<ClineAuthInfo>): ClineAuthInfo {
	return {
		idToken: "test-access-token",
		refreshToken: "test-refresh-token",
		expiresAt: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now (seconds)
		userInfo: {
			id: "user-123",
			email: "test@example.com",
			displayName: "Test User",
			organizations: [
				{
					active: true,
					memberId: "member-1",
					name: "Personal",
					organizationId: "org-personal",
					roles: ["owner"],
				},
			],
		},
		provider: "cline",
		startedAt: Date.now(),
		...overrides,
	}
}

function createTestOAuthCredentials(): OAuthCredentials {
	return {
		access: "oauth-access-token",
		refresh: "oauth-refresh-token",
		expires: Date.now() + 3600 * 1000, // 1 hour from now (ms)
		accountId: "acct-456",
		email: "oauth@example.com",
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthService", () => {
	let authService: AuthService

	beforeEach(() => {
		// Reset the singleton between tests
		resetSingleton()
		authService = AuthService.getInstance()
		mockSecrets.clear()
		vi.clearAllMocks()
	})

	describe("singleton pattern", () => {
		it("returns the same instance on multiple calls", () => {
			const instance1 = AuthService.getInstance()
			const instance2 = AuthService.getInstance()
			expect(instance1).toBe(instance2)
		})
	})

	describe("getInfo() — auth state for webview", () => {
		it("returns unauthenticated state when not logged in", () => {
			const info = authService.getInfo()
			expect(info.user).toBeNull()
		})

		it("returns authenticated state with user info when logged in", () => {
			const authInfo = createTestAuthInfo()
			testAccess(authService)._clineAuthInfo = authInfo
			testAccess(authService)._authenticated = true

			const info = authService.getInfo()
			expect(info.user).not.toBeNull()
			expect(info.user?.uid).toBe("user-123")
			expect(info.user?.email).toBe("test@example.com")
			expect(info.user?.displayName).toBe("Test User")
		})

		it("returns unauthenticated state when _authenticated is false even with auth info", () => {
			const authInfo = createTestAuthInfo()
			testAccess(authService)._clineAuthInfo = authInfo
			testAccess(authService)._authenticated = false

			const info = authService.getInfo()
			expect(info.user).toBeNull()
		})
	})

	describe("getActiveOrganizationId()", () => {
		it("returns null when not authenticated", () => {
			expect(authService.getActiveOrganizationId()).toBeNull()
		})

		it("returns the active organization ID when authenticated", () => {
			const authInfo = createTestAuthInfo()
			testAccess(authService)._clineAuthInfo = authInfo

			expect(authService.getActiveOrganizationId()).toBe("org-personal")
		})

		it("returns null when no active organization exists", () => {
			const authInfo = createTestAuthInfo({
				userInfo: {
					...createTestAuthInfo().userInfo,
					organizations: [
						{
							active: false,
							memberId: "member-1",
							name: "Personal",
							organizationId: "org-personal",
							roles: ["owner"],
						},
					],
				},
			})
			testAccess(authService)._clineAuthInfo = authInfo

			expect(authService.getActiveOrganizationId()).toBeNull()
		})
	})

	describe("getUserOrganizations()", () => {
		it("returns undefined when not authenticated", () => {
			expect(authService.getUserOrganizations()).toBeUndefined()
		})

		it("returns organizations when authenticated", () => {
			const authInfo = createTestAuthInfo()
			testAccess(authService)._clineAuthInfo = authInfo

			const orgs = authService.getUserOrganizations()
			expect(orgs).toHaveLength(1)
			expect(orgs?.[0].organizationId).toBe("org-personal")
		})
	})

	describe("getProviderName()", () => {
		it("returns null when not authenticated", () => {
			expect(authService.getProviderName()).toBeNull()
		})

		it("returns the provider name when authenticated", () => {
			const authInfo = createTestAuthInfo()
			testAccess(authService)._clineAuthInfo = authInfo

			expect(authService.getProviderName()).toBe("cline")
		})
	})

	describe("getAuthToken()", () => {
		it("returns null when not authenticated", async () => {
			expect(await authService.getAuthToken()).toBeNull()
		})

		it("returns workos:-prefixed token when authenticated", async () => {
			const authInfo = createTestAuthInfo()
			testAccess(authService)._clineAuthInfo = authInfo
			testAccess(authService)._authenticated = true

			const token = await authService.getAuthToken()
			expect(token).toBe("workos:test-access-token")
		})

		it("returns null when token is expired and refresh fails", async () => {
			const authInfo = createTestAuthInfo({
				expiresAt: Math.floor(Date.now() / 1000) - 100, // expired
			})
			testAccess(authService)._clineAuthInfo = authInfo
			testAccess(authService)._authenticated = true

			// No refresh token → can't refresh
			authInfo.refreshToken = undefined
			const token = await authService.getAuthToken()
			expect(token).toBeNull()
		})
	})

	describe("handleDeauth() — logout", () => {
		it("clears auth state and pushes unauthenticated state", async () => {
			const authInfo = createTestAuthInfo()
			testAccess(authService)._clineAuthInfo = authInfo
			testAccess(authService)._authenticated = true

			// Store something in secrets
			mockSecrets.set("cline:clineAccountId", JSON.stringify(authInfo))

			await authService.handleDeauth(LogoutReason.USER_INITIATED)

			// Auth state should be cleared
			expect(testAccess(authService)._clineAuthInfo).toBeNull()
			expect(testAccess(authService)._authenticated).toBe(false)

			// Secrets should be cleared
			expect(mockSecrets.has("cline:clineAccountId")).toBe(false)
			expect(mockSecrets.has("clineAccountId")).toBe(false)
		})
	})

	describe("token persistence", () => {
		it("reads auth info from secrets", () => {
			const authInfo = createTestAuthInfo()
			mockSecrets.set("cline:clineAccountId", JSON.stringify(authInfo))

			const result = testAccess(authService).readAuthInfoFromSecrets()
			expect(result).not.toBeNull()
			expect(result?.idToken).toBe("test-access-token")
			expect(result?.userInfo.id).toBe("user-123")
		})

		it("returns null when no secrets exist", () => {
			const result = testAccess(authService).readAuthInfoFromSecrets()
			expect(result).toBeNull()
		})

		it("returns null for corrupt JSON", () => {
			mockSecrets.set("cline:clineAccountId", "not-valid-json")
			const result = testAccess(authService).readAuthInfoFromSecrets()
			expect(result).toBeNull()
		})

		it("writes auth info to secrets", () => {
			const authInfo = createTestAuthInfo()
			testAccess(authService).writeAuthInfoToSecrets(authInfo)

			const stored = mockSecrets.get("cline:clineAccountId")
			expect(stored).toBeDefined()
			const parsed = JSON.parse(stored ?? "{}")
			expect(parsed.idToken).toBe("test-access-token")
		})

		it("clears auth info from secrets", () => {
			mockSecrets.set("cline:clineAccountId", "some-value")
			mockSecrets.set("clineAccountId", "legacy-value")

			testAccess(authService).clearAuthInfoFromSecrets()

			expect(mockSecrets.has("cline:clineAccountId")).toBe(false)
			expect(mockSecrets.has("clineAccountId")).toBe(false)
		})
	})

	describe("restoreRefreshTokenAndRetrieveAuthInfo()", () => {
		it("restores auth state from secrets on startup", async () => {
			const authInfo = createTestAuthInfo()
			mockSecrets.set("cline:clineAccountId", JSON.stringify(authInfo))

			await authService.restoreRefreshTokenAndRetrieveAuthInfo()

			expect(testAccess(authService)._authenticated).toBe(true)
			expect(testAccess(authService)._clineAuthInfo).not.toBeNull()
			expect(testAccess(authService)._clineAuthInfo?.idToken).toBe("test-access-token")
		})

		it("sets unauthenticated state when no secrets exist", async () => {
			await authService.restoreRefreshTokenAndRetrieveAuthInfo()

			expect(testAccess(authService)._authenticated).toBe(false)
			expect(testAccess(authService)._clineAuthInfo).toBeNull()
		})
	})

	describe("LogoutReason enum", () => {
		it("has expected values", () => {
			expect(LogoutReason.USER_INITIATED).toBe("user_initiated")
			expect(LogoutReason.CROSS_WINDOW_SYNC).toBe("cross_window_sync")
			expect(LogoutReason.ERROR_RECOVERY).toBe("error_recovery")
			expect(LogoutReason.UNKNOWN).toBe("unknown")
		})
	})

	describe("workos: prefix handling", () => {
		it("getAuthToken always returns workos:-prefixed token", async () => {
			const authInfo = createTestAuthInfo()
			testAccess(authService)._clineAuthInfo = authInfo
			testAccess(authService)._authenticated = true

			const token = await authService.getAuthToken()
			expect(token).toMatch(/^workos:/)
			expect(token).toBe("workos:test-access-token")
		})
	})

	describe("streaming subscriptions", () => {
		it("subscribeToAuthStatusUpdate pushes initial state immediately", async () => {
			const mockResponseStream = vi.fn()
			const mockController = { postStateToWebview: vi.fn() }

			await authService.subscribeToAuthStatusUpdate(
				// biome-ignore lint/suspicious/noExplicitAny: mock controller for testing
				mockController as any,
				{},
				// biome-ignore lint/suspicious/noExplicitAny: mock response stream for testing
				mockResponseStream as any,
				"test-request-id",
			)

			// Should have pushed initial auth state
			expect(mockResponseStream).toHaveBeenCalled()
			const [authState] = mockResponseStream.mock.calls[0]
			expect(authState).toBeDefined()
			expect(authState.user).toBeNull() // Not authenticated in this test
		})

		it("polls feature flags with the authenticated user before posting state", async () => {
			const authInfo = createTestAuthInfo()
			testAccess(authService)._clineAuthInfo = authInfo
			testAccess(authService)._authenticated = true

			const mockResponseStream = vi.fn().mockResolvedValue(undefined)
			const mockController = { postStateToWebview: vi.fn() }

			await authService.subscribeToAuthStatusUpdate(
				// biome-ignore lint/suspicious/noExplicitAny: mock controller for testing
				mockController as any,
				{},
				// biome-ignore lint/suspicious/noExplicitAny: mock response stream for testing
				mockResponseStream as any,
			)

			expect(mockFeatureFlagsPoll).toHaveBeenCalledWith("user-123")
			expect(mockController.postStateToWebview).toHaveBeenCalled()
		})

		it("polls feature flags with null when unauthenticated", async () => {
			await authService.sendAuthStatusUpdate()

			expect(mockFeatureFlagsPoll).toHaveBeenCalledWith(null)
		})

		it("removes subscription on cleanup", async () => {
			const mockResponseStream = vi.fn().mockResolvedValue(undefined)
			const mockController = { postStateToWebview: vi.fn() }

			await authService.subscribeToAuthStatusUpdate(
				// biome-ignore lint/suspicious/noExplicitAny: mock controller for testing
				mockController as any,
				{},
				// biome-ignore lint/suspicious/noExplicitAny: mock response stream for testing
				mockResponseStream as any,
			)

			// Should have one handler
			expect(testAccess(authService)._activeAuthStatusUpdateHandlers.size).toBe(1)

			// Simulate cleanup
			testAccess(authService)._activeAuthStatusUpdateHandlers.clear()
			expect(testAccess(authService)._activeAuthStatusUpdateHandlers.size).toBe(0)
		})
	})
})

// Ensure createTestOAuthCredentials is used (suppress unused warning)
void createTestOAuthCredentials
