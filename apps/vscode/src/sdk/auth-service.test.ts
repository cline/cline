// Tests for the SDK-backed AuthService (Step 6: Auth & Account Flows)
//
// These tests verify the auth service's core logic:
// - Token persistence (read/write/clear from secrets)
// - Auth state management (authenticated/unauthenticated)
// - Auth info conversion (SDK OAuthCredentials → ClineAuthInfo)
// - Logout flow
// - Streaming subscription management
// - workos: prefix handling

import path from "node:path"
import { getValidClineCredentials, type ITelemetryService, type OAuthCredentials } from "@cline/core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AuthService, type ClineAuthInfo, LogoutReason } from "./auth-service"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFeatureFlagsPoll = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockIdentifyAccount = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockCaptureAuthLoggedOut = vi.hoisted(() => vi.fn())
const mockSdkTelemetry = { capture: vi.fn() } as unknown as ITelemetryService

// Mock StateManager
const mockSecrets = new Map<string, string>()
const mockGlobalState = vi.hoisted(() => new Map<string, unknown>())
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
			setGlobalState: (key: string, value: unknown) => {
				mockGlobalState.set(key, value)
			},
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

vi.mock("@/services/telemetry", () => ({
	telemetryService: {
		identifyAccount: mockIdentifyAccount,
		captureAuthLoggedOut: mockCaptureAuthLoggedOut,
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
vi.mock("@cline/core", async () => ({
	sdkDebug: () => {},
	hashSecret: () => "hashed",
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
	// Mirrors the SDK registry: cline-pass stores credentials under "cline".
	getProviderAuthStorageId: (providerId: string) =>
		providerId === "cline" || providerId === "cline-pass" ? "cline" : undefined,
}))

// Stateful in-memory provider-settings store. Cline credentials are persisted
// to providers.json (via the SDK's ProviderSettingsManager), not to secrets, so
// the credential round-trip tests exercise this store.
const mockProviderSettings = new Map<string, Record<string, unknown>>()
let mockLastUsedProvider: string | undefined
vi.mock("./provider-migration", () => ({
	getProviderSettingsManager: () => ({
		getProviderSettings: (provider: string) => mockProviderSettings.get(provider),
		read: () => ({ lastUsedProvider: mockLastUsedProvider }),
		saveProviderSettings: (settings: Record<string, unknown>, options?: { setLastUsed?: boolean }) => {
			const provider = settings.provider as string
			mockProviderSettings.set(provider, { ...settings })
			if (options?.setLastUsed !== false) {
				mockLastUsedProvider = provider
			}
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
		metadata: {
			provider: "workos",
			sessionStartedAtMs: 1_700_000_000_000,
			tokenType: "Bearer",
			userInfo: { email: "oauth@example.com" },
		},
	}
}

async function waitForCondition(condition: () => boolean): Promise<void> {
	for (let i = 0; i < 20; i++) {
		if (condition()) {
			return
		}
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
	throw new Error("Timed out waiting for condition")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthService", () => {
	let authService: AuthService

	beforeEach(() => {
		// Reset the singleton between tests
		resetSingleton()
		authService = AuthService.getInstance(undefined, mockSdkTelemetry)
		mockSecrets.clear()
		mockGlobalState.clear()
		mockProviderSettings.clear()
		mockLastUsedProvider = undefined
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

		it("returns the refreshed token when an already-expired token refreshes successfully", async () => {
			// Regression test: the process sat idle past token expiry (e.g. across
			// a laptop suspend), so the refresh happens after expiresAt has passed.
			testAccess(authService)._clineAuthInfo = createTestAuthInfo({
				expiresAt: Math.floor(Date.now() / 1000) - 100, // already expired
			})
			testAccess(authService)._authenticated = true
			vi.mocked(getValidClineCredentials).mockResolvedValue(createTestOAuthCredentials())

			const token = await authService.getAuthToken()
			expect(token).toBe("workos:oauth-access-token")
		})

		it("does not emit its own logout event when the refresh token is rejected mid-session", async () => {
			testAccess(authService)._clineAuthInfo = createTestAuthInfo({
				expiresAt: Math.floor(Date.now() / 1000) - 100, // expired → forces refresh
			})
			testAccess(authService)._authenticated = true
			// null models an invalid-grant rejection; transient failures throw.
			// The SDK resolver owns the user.auth_logged_out (token_invalid)
			// event for this case — the adapter must stay silent or the event
			// double-counts (see the boundary test below with the real resolver).
			vi.mocked(getValidClineCredentials).mockResolvedValue(null)

			const token = await authService.getAuthToken()

			expect(token).toBeNull()
			expect(testAccess(authService)._authenticated).toBe(false)
			expect(mockCaptureAuthLoggedOut).not.toHaveBeenCalled()
		})

		it("still rejects a token that comes back from refresh already expired", async () => {
			testAccess(authService)._clineAuthInfo = createTestAuthInfo({
				expiresAt: Math.floor(Date.now() / 1000) - 100, // already expired
			})
			testAccess(authService)._authenticated = true
			vi.mocked(getValidClineCredentials).mockResolvedValue({
				...createTestOAuthCredentials(),
				expires: Date.now() - 1000, // refresh returned an expired token (ms)
			})

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

		it("persists the session start time in Cline auth metadata", async () => {
			mockLoginClineOAuth.mockImplementationOnce(async ({ callbacks }) => {
				callbacks.onAuth({
					url: "https://example.com/device?user_code=ABCD-EFGH",
					instructions: "Enter this code in your browser: ABCD-EFGH",
				})

				return createTestOAuthCredentials()
			})

			await authService.createAuthRequest()
			await waitForCondition(() => mockProviderSettings.has("cline"))

			const persisted = mockProviderSettings.get("cline") as { auth?: { metadata?: Record<string, unknown> } }
			expect(persisted.auth?.metadata).toMatchObject({
				provider: "workos",
				sessionStartedAtMs: 1_700_000_000_000,
				tokenType: "Bearer",
				userInfo: { email: "oauth@example.com" },
			})
			expect(persisted.auth?.metadata).not.toHaveProperty("startedAt")
		})

		it("marks the welcome view completed only after OAuth succeeds (not when the URL opens)", async () => {
			let resolveLogin!: (credentials: OAuthCredentials) => void
			const loginCompleted = new Promise<OAuthCredentials>((resolve) => {
				resolveLogin = resolve
			})
			mockLoginClineOAuth.mockImplementationOnce(async ({ callbacks }) => {
				callbacks.onAuth({
					url: "https://example.com/device?user_code=ABCD-EFGH",
					instructions: "Enter this code in your browser: ABCD-EFGH",
				})
				return loginCompleted
			})

			// createAuthRequest resolves at URL-open time; onboarding must NOT be
			// marked complete yet (the user may abandon the browser sign-in).
			await authService.createAuthRequest()
			expect(mockGlobalState.get("welcomeViewCompleted")).toBeUndefined()

			// Complete the OAuth exchange — now the flag must flip.
			resolveLogin(createTestOAuthCredentials())
			await waitForCondition(() => mockGlobalState.get("welcomeViewCompleted") === true)
		})

		it("does not mark the welcome view completed when OAuth fails", async () => {
			mockLoginClineOAuth.mockImplementationOnce(async ({ callbacks }) => {
				callbacks.onAuth({
					url: "https://example.com/device?user_code=ABCD-EFGH",
					instructions: "Enter this code in your browser: ABCD-EFGH",
				})
				throw new Error("login aborted")
			})

			await authService.createAuthRequest()

			// Give the background login block a few ticks to settle.
			await new Promise((resolve) => setTimeout(resolve, 0))
			await new Promise((resolve) => setTimeout(resolve, 0))
			expect(mockGlobalState.get("welcomeViewCompleted")).toBeUndefined()
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
			expect(mockCaptureAuthLoggedOut).toHaveBeenCalledWith("cline", LogoutReason.USER_INITIATED)
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
			expect(testAccess(authService)._clineAuthInfo?.startedAt).toBeUndefined()
			expect(
				(mockProviderSettings.get("cline")?.auth as { metadata?: Record<string, unknown> } | undefined)?.metadata,
			).toBeUndefined()
			expect(getValidClineCredentials).toHaveBeenCalledWith(
				expect.any(Object),
				expect.objectContaining({ telemetry: mockSdkTelemetry }),
				expect.any(Object),
			)
		})

		it("does not let undefined incoming metadata erase existing metadata on restore refresh", async () => {
			mockProviderSettings.set("cline", {
				provider: "cline",
				auth: {
					accessToken: "workos:persisted-access-token",
					refreshToken: "persisted-refresh-token",
					accountId: "user-123",
					metadata: {
						provider: "workos",
						sessionStartedAtMs: 1_700_000_000_000,
						tokenType: "Bearer",
					},
				},
			})
			vi.mocked(getValidClineCredentials).mockResolvedValue({
				access: "persisted-access-token",
				refresh: "persisted-refresh-token",
				expires: Date.now() + 3600 * 1000,
				accountId: "user-123",
				email: "test@example.com",
				metadata: {
					provider: undefined,
					sessionStartedAtMs: 1_700_000_000_000,
					tokenType: "Bearer",
				},
			})

			await authService.restoreRefreshTokenAndRetrieveAuthInfo()

			const persisted = mockProviderSettings.get("cline") as { auth?: { metadata?: Record<string, unknown> } }
			expect(persisted.auth?.metadata).toMatchObject({
				provider: "workos",
				sessionStartedAtMs: 1_700_000_000_000,
				tokenType: "Bearer",
			})
		})

		it("keeps a ClinePass last-used selection when credentials are refreshed on restore (#13501)", async () => {
			mockLastUsedProvider = "cline-pass"
			mockProviderSettings.set("cline", {
				provider: "cline",
				auth: {
					accessToken: "workos:persisted-access-token",
					refreshToken: "persisted-refresh-token",
					accountId: "user-123",
				},
			})
			vi.mocked(getValidClineCredentials).mockResolvedValue({
				access: "refreshed-access-token",
				refresh: "refreshed-refresh-token",
				expires: Date.now() + 3600 * 1000,
				accountId: "user-123",
				email: "test@example.com",
			})

			await authService.restoreRefreshTokenAndRetrieveAuthInfo()

			expect(testAccess(authService)._authenticated).toBe(true)
			expect(mockLastUsedProvider).toBe("cline-pass")
		})

		it("claims the last-used slot on restore when no cline-backed provider is selected", async () => {
			mockLastUsedProvider = undefined
			mockProviderSettings.set("cline", {
				provider: "cline",
				auth: {
					accessToken: "workos:persisted-access-token",
					refreshToken: "persisted-refresh-token",
					accountId: "user-123",
				},
			})
			vi.mocked(getValidClineCredentials).mockResolvedValue({
				access: "refreshed-access-token",
				refresh: "refreshed-refresh-token",
				expires: Date.now() + 3600 * 1000,
				accountId: "user-123",
				email: "test@example.com",
			})

			await authService.restoreRefreshTokenAndRetrieveAuthInfo()

			expect(mockLastUsedProvider).toBe("cline")
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
			// The SDK resolver owns the token_invalid event — no adapter emission.
			expect(mockCaptureAuthLoggedOut).not.toHaveBeenCalled()
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
			// Startup with nothing stored is not a logout — no event.
			expect(mockCaptureAuthLoggedOut).not.toHaveBeenCalled()
		})

		it("reports nothing when refreshing the stored session fails transiently", async () => {
			mockProviderSettings.set("cline", {
				provider: "cline",
				auth: { accessToken: "workos:stale", refreshToken: "stale-refresh", accountId: "user-123" },
			})
			// The resolver throws only on transient failures (network/timeout/5xx);
			// stored credentials are kept and the next refresh recovers, so an
			// offline startup must not book as a logout. (The SDK reports these
			// as user.auth_refresh_soft_failure.)
			vi.mocked(getValidClineCredentials).mockRejectedValue(new Error("fetch failed"))

			await authService.restoreRefreshTokenAndRetrieveAuthInfo()

			expect(testAccess(authService)._authenticated).toBe(false)
			expect(mockProviderSettings.get("cline")?.auth).toBeDefined()
			expect(mockCaptureAuthLoggedOut).not.toHaveBeenCalled()
		})

		it("reports restore_error when restore fails outside the credential refresh", async () => {
			mockProviderSettings.set("cline", {
				provider: "cline",
				auth: { accessToken: "workos:stale", refreshToken: "stale-refresh", accountId: "user-123" },
			})
			vi.mocked(getValidClineCredentials).mockResolvedValue(createTestOAuthCredentials())
			vi.spyOn(authService, "sendAuthStatusUpdate").mockRejectedValue(new Error("state push failed"))

			await authService.restoreRefreshTokenAndRetrieveAuthInfo()

			expect(testAccess(authService)._authenticated).toBe(false)
			expect(mockCaptureAuthLoggedOut).toHaveBeenCalledTimes(1)
			expect(mockCaptureAuthLoggedOut).toHaveBeenCalledWith("cline", LogoutReason.RESTORE_ERROR)
		})

		it("emits exactly one auth_logged_out — from the SDK resolver — when the stored refresh token is rejected", async () => {
			// Boundary test: run the REAL getValidClineCredentials (the module
			// mock normally hides its telemetry) so a reintroduced adapter-side
			// emission would surface as a second event here. The specifier is a
			// variable so tsc doesn't pull the SDK sources into this project's
			// program (same reason the @cline/core vitest stub is tsc-excluded);
			// vitest resolves it at runtime.
			const realClineAuthModulePath = path.resolve(import.meta.dirname, "../../../../sdk/packages/core/src/auth/cline.ts")
			const { getValidClineCredentials: realGetValidClineCredentials } = (await import(
				/* @vite-ignore */ realClineAuthModulePath
			)) as { getValidClineCredentials: typeof getValidClineCredentials }
			vi.mocked(getValidClineCredentials).mockImplementation(realGetValidClineCredentials as never)
			// The resolver refreshes over global fetch; reject the refresh token.
			vi.stubGlobal(
				"fetch",
				vi.fn(
					async () =>
						new Response(JSON.stringify({ error: "invalid_grant", error_description: "refresh expired" }), {
							status: 401,
							headers: { "Content-Type": "application/json" },
						}),
				),
			)
			mockProviderSettings.set("cline", {
				provider: "cline",
				auth: {
					accessToken: "workos:stale",
					refreshToken: "stale-refresh",
					accountId: "user-123",
					expiresAt: Date.now() - 1000, // expired → forces refresh
				},
			})

			try {
				await authService.restoreRefreshTokenAndRetrieveAuthInfo()
			} finally {
				vi.unstubAllGlobals()
			}

			expect(testAccess(authService)._authenticated).toBe(false)
			expect(mockProviderSettings.get("cline")?.auth).toBeUndefined()
			// Exactly one user.auth_logged_out in total: the SDK resolver's
			// token_invalid (on the SDK telemetry instance) and nothing from
			// the adapter (on the app telemetry service).
			const sdkLogoutEvents = vi
				.mocked(mockSdkTelemetry.capture)
				.mock.calls.filter(([input]) => input.event === "user.auth_logged_out")
			expect(sdkLogoutEvents).toHaveLength(1)
			expect(sdkLogoutEvents[0][0].properties).toMatchObject({ reason: LogoutReason.TOKEN_INVALID })
			expect(mockCaptureAuthLoggedOut).not.toHaveBeenCalled()
		})
	})

	describe("LogoutReason enum", () => {
		it("has expected values", () => {
			expect(LogoutReason.USER_INITIATED).toBe("user_initiated")
			expect(LogoutReason.CROSS_WINDOW_SYNC).toBe("cross_window_sync")
			expect(LogoutReason.ERROR_RECOVERY).toBe("error_recovery")
			expect(LogoutReason.TOKEN_INVALID).toBe("token_invalid")
			expect(LogoutReason.RESTORE_ERROR).toBe("restore_error")
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
			const mockController = { postStateToWebview: vi.fn(), invalidateProviderListings: vi.fn() }

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
			const mockController = { postStateToWebview: vi.fn(), invalidateProviderListings: vi.fn() }

			await authService.subscribeToAuthStatusUpdate(
				// biome-ignore lint/suspicious/noExplicitAny: mock controller for testing
				mockController as any,
				{},
				// biome-ignore lint/suspicious/noExplicitAny: mock response stream for testing
				mockResponseStream as any,
			)

			expect(mockFeatureFlagsPoll).toHaveBeenCalledWith("user-123")
			expect(mockIdentifyAccount).toHaveBeenCalledWith(authInfo.userInfo)
			expect(mockIdentifyAccount.mock.invocationCallOrder[0]).toBeLessThan(mockFeatureFlagsPoll.mock.invocationCallOrder[0])
			expect(mockController.postStateToWebview).toHaveBeenCalled()
		})

		it("polls feature flags with null when unauthenticated", async () => {
			await authService.sendAuthStatusUpdate()

			expect(mockFeatureFlagsPoll).toHaveBeenCalledWith(null)
			expect(mockIdentifyAccount).not.toHaveBeenCalled()
		})

		it("removes subscription on cleanup", async () => {
			const mockResponseStream = vi.fn().mockResolvedValue(undefined)
			const mockController = { postStateToWebview: vi.fn(), invalidateProviderListings: vi.fn() }

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
