// Tests for the SDK-backed AuthService (Step 6: Auth & Account Flows)
//
// These tests verify the auth service's core logic:
// - Token persistence (read/write/clear from secrets)
// - Auth state management (authenticated/unauthenticated)
// - Auth info conversion (SDK OAuthCredentials → ClineAuthInfo)
// - Logout flow
// - Streaming subscription management
// - workos: prefix handling

import { getValidClineCredentials, type OAuthCredentials } from "@cline/core"
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

const mockLoginClineOAuth = vi.hoisted(() => vi.fn())

// Mock @cline/core OAuth functions
vi.mock("@cline/core", () => ({
	createOAuthClientCallbacks: (opts: {
		onOutput?: (message: string) => void
		onPrompt: () => void
		openUrl?: (url: string) => void | Promise<void>
	}) => ({
		onAuth: ({ url, instructions }: { url: string; instructions?: string }) => {
			opts.onOutput?.(instructions ?? "Complete sign-in in your browser.")
			void opts.openUrl?.(url)
			opts.onOutput?.(url)
		},
		onPrompt: opts.onPrompt,
	}),
	loginClineOAuth: mockLoginClineOAuth,
	loginOcaOAuth: vi.fn(),
	loginOpenAICodex: vi.fn(),
	refreshClineToken: vi.fn(),
	getValidClineCredentials: vi.fn(),
}))

// Stateful in-memory provider-settings store. Cline credentials are persisted
// to providers.json (via the SDK's ProviderSettingsManager), not to secrets, so
// the credential round-trip tests exercise this store.
const mockProviderSettings = new Map<string, Record<string, unknown>>()
vi.mock("./provider-migration", () => ({
	getProviderSettingsManager: () => ({
		getProviderSettings: (provider: string) => mockProviderSettings.get(provider),
		saveProviderSettings: (settings: Record<string, unknown>) => {
			const provider = settings.provider as string
			mockProviderSettings.set(provider, { ...settings })
		},
	}),
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
		mockProviderSettings.clear()
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
			// Unset proto message fields are `undefined`, not `null`.
			expect(info.user).toBeUndefined()
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
			expect(info.user).toBeUndefined()
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

	describe("createAuthRequest()", () => {
		it("returns the SDK device auth instruction so the webview can display the browser confirmation code", async () => {
			mockLoginClineOAuth.mockImplementationOnce(async ({ callbacks, useWorkOSDeviceAuth }) => {
				expect(useWorkOSDeviceAuth).toBe(true)
				callbacks.onAuth({
					url: "https://example.com/device?user_code=ABCD-EFGH",
					instructions: "Enter this code in your browser: ABCD-EFGH",
				})

				return createTestOAuthCredentials()
			})

			const response = await authService.createAuthRequest()

			expect(response.value).toBe("Enter this code in your browser: ABCD-EFGH")
		})
	})

	describe("handleDeauth() — logout", () => {
		it("clears auth state and pushes unauthenticated state", async () => {
			const authInfo = createTestAuthInfo()
			testAccess(authService)._clineAuthInfo = authInfo
			testAccess(authService)._authenticated = true

			// Seed persisted Cline credentials in providers.json.
			mockProviderSettings.set("cline", {
				provider: "cline",
				auth: { accessToken: "workos:test-access-token", refreshToken: "test-refresh-token", accountId: "user-123" },
			})

			await authService.handleDeauth(LogoutReason.USER_INITIATED)

			// In-memory auth state should be cleared.
			expect(testAccess(authService)._clineAuthInfo).toBeNull()
			expect(testAccess(authService)._authenticated).toBe(false)

			// Persisted credentials should be cleared from providers.json.
			expect(mockProviderSettings.get("cline")?.auth).toBeUndefined()
		})
	})

	describe("token persistence (providers.json)", () => {
		// Cline OAuth credentials are persisted to providers.json via the SDK's
		// ProviderSettingsManager, not to VSCode secrets. These tests exercise
		// the round-trip through the public restore/logout surface.

		it("restores credentials persisted in providers.json", async () => {
			mockProviderSettings.set("cline", {
				provider: "cline",
				auth: {
					accessToken: "workos:persisted-access-token",
					refreshToken: "persisted-refresh-token",
					accountId: "user-123",
				},
			})
			vi.mocked(getValidClineCredentials).mockResolvedValue({
				access: "persisted-access-token",
				refresh: "persisted-refresh-token",
				expires: Date.now() + 3600 * 1000,
				accountId: "user-123",
				email: "test@example.com",
			})

			await authService.restoreRefreshTokenAndRetrieveAuthInfo()

			expect(testAccess(authService)._authenticated).toBe(true)
			expect(testAccess(authService)._clineAuthInfo?.idToken).toBe("persisted-access-token")
		})

		it("sets unauthenticated state when providers.json has no Cline auth", async () => {
			await authService.restoreRefreshTokenAndRetrieveAuthInfo()

			expect(testAccess(authService)._authenticated).toBe(false)
			expect(testAccess(authService)._clineAuthInfo).toBeNull()
		})

		it("clears persisted credentials when stored tokens are no longer valid", async () => {
			mockProviderSettings.set("cline", {
				provider: "cline",
				auth: { accessToken: "workos:stale", refreshToken: "stale-refresh", accountId: "user-123" },
			})
			// getValidClineCredentials returning null models an unrecoverable token.
			vi.mocked(getValidClineCredentials).mockResolvedValue(null)

			await authService.restoreRefreshTokenAndRetrieveAuthInfo()

			expect(testAccess(authService)._authenticated).toBe(false)
			expect(testAccess(authService)._clineAuthInfo).toBeNull()
			expect(mockProviderSettings.get("cline")?.auth).toBeUndefined()
		})
	})

	describe("restoreRefreshTokenAndRetrieveAuthInfo()", () => {
		it("strips the workos: prefix from the persisted access token", async () => {
			mockProviderSettings.set("cline", {
				provider: "cline",
				auth: { accessToken: "workos:raw-access-token", refreshToken: "r", accountId: "user-123" },
			})
			vi.mocked(getValidClineCredentials).mockResolvedValue({
				access: "raw-access-token",
				refresh: "r",
				expires: Date.now() + 3600 * 1000,
				accountId: "user-123",
				email: "test@example.com",
			})

			await authService.restoreRefreshTokenAndRetrieveAuthInfo()

			expect(testAccess(authService)._clineAuthInfo?.idToken).toBe("raw-access-token")
		})

		it("sets unauthenticated state when no credentials exist", async () => {
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
			expect(authState.user).toBeUndefined() // Not authenticated in this test
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
