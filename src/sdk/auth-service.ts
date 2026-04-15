// Replaces classic src/services/auth/AuthService.ts (see origin/main)
//
// SDK-backed authentication service. Uses @clinebot/core OAuth functions
// for login flows and ProviderSettingsManager (providers.json) as the
// single source of truth for credentials.
//
// User profile info (email, displayName, organizations) is NOT stored on
// disk — it's fetched from the Cline API on startup and cached in memory.
// This matches the CLI's pattern (see apps/cli/src/runtime/interactive-welcome.ts).

import type { OAuthCredentials } from "@clinebot/core"
import { createOAuthClientCallbacks, loginClineOAuth, loginOcaOAuth, loginOpenAICodex, refreshClineToken } from "@clinebot/core"
import { AuthState, UserInfo } from "@shared/proto/cline/account"
import type { EmptyRequest, String } from "@shared/proto/cline/common"
import axios from "axios"
import { ClineEnv } from "@/config"
import type { Controller } from "@/core/controller"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { HostProvider } from "@/hosts/host-provider"
import { BannerService } from "@/services/banner/BannerService"
import { buildBasicClineHeaders } from "@/services/EnvUtils"
import { CLINE_API_ENDPOINT } from "@/shared/cline/api"
import { fetch, getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { openExternal } from "@/utils/env"
import { getProviderSettingsManager } from "./provider-migration"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the auth info cached in memory (NOT persisted to disk). */
export interface ClineAuthInfo {
	idToken: string
	refreshToken?: string
	expiresAt?: number // seconds since epoch
	userInfo: ClineAccountUserInfo
	provider: string
	startedAt?: number
}

export interface ClineAccountUserInfo {
	createdAt?: string
	displayName: string
	email: string
	id: string
	organizations: ClineAccountOrganization[]
	appBaseUrl?: string
	subject?: string
}

export interface ClineAccountOrganization {
	active: boolean
	memberId: string
	name: string
	organizationId: string
	roles: string[]
}

/** Logout reason for telemetry */
export enum LogoutReason {
	USER_INITIATED = "user_initiated",
	CROSS_WINDOW_SYNC = "cross_window_sync",
	ERROR_RECOVERY = "error_recovery",
	UNKNOWN = "unknown",
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKOS_TOKEN_PREFIX = "workos:"

// ---------------------------------------------------------------------------
// providers.json helpers
// ---------------------------------------------------------------------------

/**
 * Read Cline OAuth credentials from providers.json.
 * Returns { accessToken, refreshToken, expiresAt, accountId } or null.
 */
function readClineCredentials(): {
	accessToken: string
	refreshToken?: string
	expiresAt?: number // milliseconds since epoch (providers.json convention)
	accountId?: string
} | null {
	try {
		const manager = getProviderSettingsManager()
		const settings = manager.getProviderSettings("cline")
		if (!settings?.auth?.accessToken) return null

		// Strip workos: prefix if present (providers.json stores it with prefix)
		let accessToken = settings.auth.accessToken
		if (accessToken.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX)) {
			accessToken = accessToken.slice(WORKOS_TOKEN_PREFIX.length)
		}

		return {
			accessToken,
			refreshToken: settings.auth.refreshToken,
			expiresAt: (settings.auth as { expiresAt?: number }).expiresAt,
			accountId: settings.auth.accountId,
		}
	} catch (error) {
		Logger.error("[SdkAuthService] Failed to read credentials from providers.json:", error)
		return null
	}
}

/**
 * Write Cline OAuth credentials to providers.json.
 */
function writeClineCredentials(credentials: {
	accessToken: string
	refreshToken?: string
	expiresAt?: number // milliseconds since epoch
	accountId?: string
}): void {
	try {
		const manager = getProviderSettingsManager()
		const existing = manager.getProviderSettings("cline")

		const auth = {
			...(existing?.auth ?? {}),
			accessToken: `${WORKOS_TOKEN_PREFIX}${credentials.accessToken}`,
			refreshToken: credentials.refreshToken,
			accountId: credentials.accountId,
		} as Record<string, unknown>
		if (credentials.expiresAt !== undefined) {
			auth.expiresAt = credentials.expiresAt
		}

		manager.saveProviderSettings(
			{
				...(existing ?? { provider: "cline" }),
				provider: "cline",
				auth: auth as { accessToken?: string; refreshToken?: string; accountId?: string },
			},
			{ tokenSource: "oauth", setLastUsed: true },
		)
	} catch (error) {
		Logger.error("[SdkAuthService] Failed to write credentials to providers.json:", error)
	}
}

/**
 * Clear Cline OAuth credentials from providers.json.
 */
function clearClineCredentials(): void {
	try {
		const manager = getProviderSettingsManager()
		const existing = manager.getProviderSettings("cline")
		if (existing) {
			manager.saveProviderSettings(
				{
					...existing,
					provider: "cline",
					auth: undefined,
				},
				{ tokenSource: "manual" },
			)
		}
	} catch (error) {
		Logger.error("[SdkAuthService] Failed to clear credentials from providers.json:", error)
	}
}

// ---------------------------------------------------------------------------
// AuthService
// ---------------------------------------------------------------------------

export class AuthService {
	private static instance: AuthService | null = null

	private _authenticated = false
	private _clineAuthInfo: ClineAuthInfo | null = null
	private _activeAuthStatusUpdateHandlers = new Set<StreamingResponseHandler<AuthState>>()
	private _handlerToController = new Map<StreamingResponseHandler<AuthState>, Controller>()
	private _refreshPromise: Promise<string | undefined> | null = null

	private constructor() {}

	/**
	 * Gets the singleton instance of AuthService.
	 * On first call with a controller, initializes BannerService.
	 */
	public static getInstance(controller?: Controller): AuthService {
		if (!AuthService.instance) {
			AuthService.instance = new AuthService()
		}
		// Initialize BannerService on first call with a controller
		// (mirrors classic AuthService behavior)
		if (controller) {
			try {
				BannerService.initialize(controller)
			} catch {
				// BannerService may already be initialized — that's fine
			}
		}
		return AuthService.instance
	}

	set controller(_controller: Controller) {
		// Kept for interface compatibility — not needed in SDK-backed version
	}

	// ---- SDK OAuth → ClineAuthInfo conversion ----

	/**
	 * Convert SDK OAuthCredentials to our ClineAuthInfo format.
	 * Also fetches full user info from the Cline API.
	 */
	private async credentialsToAuthInfo(credentials: OAuthCredentials, provider: string): Promise<ClineAuthInfo> {
		// Fetch full user info from the API using the access token
		const userInfo = await this.fetchUserInfoFromApi(credentials.access)

		return {
			idToken: credentials.access,
			refreshToken: credentials.refresh,
			expiresAt: credentials.expires ? credentials.expires / 1000 : undefined, // SDK uses ms, we store seconds
			userInfo: userInfo ?? {
				id: credentials.accountId ?? "",
				email: credentials.email ?? "",
				displayName: "",
				organizations: [],
			},
			provider,
			startedAt: Date.now(),
		}
	}

	/**
	 * Fetch user info from the Cline API using an access token.
	 */
	private async fetchUserInfoFromApi(accessToken: string): Promise<ClineAccountUserInfo | null> {
		try {
			const apiBaseUrl = ClineEnv.config().apiBaseUrl
			// Ensure the token has the workos: prefix for the API
			const bearerToken = accessToken.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX)
				? accessToken
				: `${WORKOS_TOKEN_PREFIX}${accessToken}`
			const response = await axios.get(`${apiBaseUrl}/api/v1/users/me`, {
				headers: {
					Authorization: `Bearer ${bearerToken}`,
					"Content-Type": "application/json",
					...(await buildBasicClineHeaders()),
				},
				...getAxiosSettings(),
			})
			return response.data?.data ?? null
		} catch (error) {
			Logger.error("[SdkAuthService] Failed to fetch user info from API:", error)
			return null
		}
	}

	// ---- Public API (used by gRPC handlers) ----

	/**
	 * Returns the current authentication token with the `workos:` prefix.
	 * Refreshes if necessary using the SDK's token management.
	 */
	async getAuthToken(): Promise<string | null> {
		if (!this._clineAuthInfo?.idToken) {
			return null
		}

		// Check if we need to refresh
		const expiresAt = this._clineAuthInfo.expiresAt
		if (expiresAt) {
			const currentTime = Date.now() / 1000
			const bufferSeconds = 5 * 60 // 5 minute buffer
			if (currentTime + bufferSeconds >= expiresAt) {
				// Token is expired or about to expire — try to refresh
				const refreshed = await this.refreshAccessToken()
				if (!refreshed) {
					return null
				}
			}
		}

		// Verify the token is still valid (not past expiry)
		if (expiresAt && Date.now() / 1000 >= expiresAt) {
			return null
		}

		return `${WORKOS_TOKEN_PREFIX}${this._clineAuthInfo.idToken}`
	}

	/**
	 * Refresh the access token using the SDK's refreshClineToken().
	 * Persists refreshed credentials to providers.json.
	 */
	private async refreshAccessToken(): Promise<boolean> {
		if (this._refreshPromise) {
			await this._refreshPromise
			return this._clineAuthInfo?.idToken !== undefined
		}

		if (!this._clineAuthInfo?.refreshToken) {
			return false
		}

		this._refreshPromise = (async () => {
			try {
				const apiBaseUrl = ClineEnv.config().apiBaseUrl
				const currentInfo = this._clineAuthInfo
				if (!currentInfo?.refreshToken) {
					return undefined
				}
				const newCredentials = await refreshClineToken(
					{
						access: currentInfo.idToken,
						refresh: currentInfo.refreshToken,
						expires: currentInfo.expiresAt ? currentInfo.expiresAt * 1000 : 0,
						accountId: currentInfo.userInfo.id,
						email: currentInfo.userInfo.email,
					},
					{ apiBaseUrl },
				)

				// Update auth info with new credentials
				const userInfo = await this.fetchUserInfoFromApi(newCredentials.access)
				this._clineAuthInfo = {
					idToken: newCredentials.access,
					refreshToken: newCredentials.refresh,
					expiresAt: newCredentials.expires ? newCredentials.expires / 1000 : undefined,
					userInfo: userInfo ?? currentInfo.userInfo,
					provider: currentInfo.provider,
					startedAt: currentInfo.startedAt ?? Date.now(),
				}
				this._authenticated = true

				// Persist refreshed credentials to providers.json
				writeClineCredentials({
					accessToken: newCredentials.access,
					refreshToken: newCredentials.refresh,
					expiresAt: newCredentials.expires,
					accountId: this._clineAuthInfo.userInfo.id,
				})

				// Push auth state update
				setImmediate(() => {
					this.sendAuthStatusUpdate().catch((err) => {
						Logger.error("[SdkAuthService] Error sending auth status update after refresh:", err)
					})
				})

				return this._clineAuthInfo.idToken
			} catch (error) {
				Logger.error("[SdkAuthService] Token refresh failed:", error)
				// If it's a permanent failure (invalid token), clear auth state
				if (error instanceof Error && (error.message.includes("401") || error.message.includes("400"))) {
					this._clineAuthInfo = null
					this._authenticated = false
					clearClineCredentials()
					setImmediate(() => {
						this.sendAuthStatusUpdate().catch(() => {})
					})
				}
				return undefined
			} finally {
				this._refreshPromise = null
			}
		})()

		const result = await this._refreshPromise
		return result !== undefined
	}

	/**
	 * Gets the active organization ID from the authenticated user's info.
	 */
	getActiveOrganizationId(): string | null {
		if (!this._clineAuthInfo?.userInfo?.organizations) return null
		const activeOrg = this._clineAuthInfo.userInfo.organizations.find((org) => org.active)
		return activeOrg?.organizationId ?? null
	}

	/**
	 * Gets all organizations from the authenticated user's info.
	 */
	getUserOrganizations(): ClineAccountOrganization[] | undefined {
		return this._clineAuthInfo?.userInfo?.organizations
	}

	/**
	 * Gets the provider name for the current authentication.
	 */
	getProviderName(): string | null {
		return this._clineAuthInfo?.provider ?? null
	}

	/**
	 * Returns the current auth state for the webview.
	 */
	getInfo(): AuthState {
		let user: InstanceType<typeof UserInfo> | null = null
		if (this._clineAuthInfo && this._authenticated) {
			const userInfo = this._clineAuthInfo.userInfo
			userInfo.appBaseUrl = ClineEnv.config().appBaseUrl

			user = UserInfo.create({
				uid: userInfo?.id,
				displayName: userInfo?.displayName,
				email: userInfo?.email,
				photoUrl: undefined,
				appBaseUrl: userInfo?.appBaseUrl,
			})
		}

		return AuthState.create({ user })
	}

	// ---- Login flows ----

	/**
	 * Initiate Cline OAuth login.
	 * Uses SDK's loginClineOAuth() which spawns a local callback server.
	 * Persists credentials to providers.json.
	 */
	async createAuthRequest(strict = false): Promise<String> {
		// In strict mode, don't open a new auth window if already authenticated
		if (strict && this._authenticated) {
			await this.sendAuthStatusUpdate()
			const { String: ProtoString } = await import("@shared/proto/cline/common")
			return ProtoString.create({ value: "Already authenticated" })
		}

		try {
			const apiBaseUrl = ClineEnv.config().apiBaseUrl

			const callbacks = createOAuthClientCallbacks({
				onPrompt: async (prompt) => prompt.defaultValue ?? "",
				openUrl: async (url: string) => {
					await openExternal(url)
				},
				onOpenUrlError: ({ url, error }) => {
					Logger.error(`[SdkAuthService] Failed to open browser for ${url}:`, error)
				},
			})

			const credentials = await loginClineOAuth({
				apiBaseUrl,
				callbacks,
			})

			// Convert and persist to providers.json
			const authInfo = await this.credentialsToAuthInfo(credentials, "cline")
			this._clineAuthInfo = authInfo
			this._authenticated = true

			writeClineCredentials({
				accessToken: credentials.access,
				refreshToken: credentials.refresh,
				expiresAt: credentials.expires,
				accountId: authInfo.userInfo.id || credentials.accountId,
			})

			// Push auth state update
			await this.sendAuthStatusUpdate()

			// Notify BannerService of auth change (mirrors classic AuthService)
			BannerService.onAuthUpdate(authInfo.userInfo?.id || null).catch((error) => {
				Logger.error("[SdkAuthService] Banner update failed after login", error)
			})

			const { String: ProtoString } = await import("@shared/proto/cline/common")
			return ProtoString.create({ value: "Authenticated" })
		} catch (error) {
			Logger.error("[SdkAuthService] Cline OAuth login failed:", error)
			throw error
		}
	}

	/**
	 * Initiate OCA OAuth login.
	 */
	async ocaLogin(): Promise<String> {
		try {
			const callbacks = createOAuthClientCallbacks({
				onPrompt: async (prompt) => prompt.defaultValue ?? "",
				openUrl: async (url: string) => {
					await openExternal(url)
				},
				onOpenUrlError: ({ url, error }) => {
					Logger.error(`[SdkAuthService] Failed to open browser for OCA: ${url}:`, error)
				},
			})

			const credentials = await loginOcaOAuth({ callbacks })

			const authInfo = await this.credentialsToAuthInfo(credentials, "oca")
			this._clineAuthInfo = authInfo
			this._authenticated = true

			writeClineCredentials({
				accessToken: credentials.access,
				refreshToken: credentials.refresh,
				expiresAt: credentials.expires,
				accountId: authInfo.userInfo.id || credentials.accountId,
			})

			await this.sendAuthStatusUpdate()

			const { String: ProtoString } = await import("@shared/proto/cline/common")
			return ProtoString.create({ value: "Authenticated" })
		} catch (error) {
			Logger.error("[SdkAuthService] OCA OAuth login failed:", error)
			throw error
		}
	}

	/**
	 * Initiate OpenAI Codex OAuth login.
	 */
	async openAiCodexLogin(): Promise<void> {
		try {
			const callbacks = createOAuthClientCallbacks({
				onPrompt: async (prompt) => prompt.defaultValue ?? "",
				openUrl: async (url: string) => {
					await openExternal(url)
				},
				onOpenUrlError: ({ url, error }) => {
					Logger.error(`[SdkAuthService] Failed to open browser for Codex: ${url}:`, error)
				},
			})

			const credentials = await loginOpenAICodex(callbacks)

			// Store Codex credentials in providers.json
			await this.saveCodexCredentials(credentials)

			// Notify webview of state change
			await this.sendAuthStatusUpdate()
		} catch (error) {
			Logger.error("[SdkAuthService] OpenAI Codex OAuth login failed:", error)
			throw error
		}
	}

	/**
	 * Save Codex OAuth credentials to provider settings.
	 */
	private async saveCodexCredentials(credentials: OAuthCredentials): Promise<void> {
		try {
			const manager = getProviderSettingsManager()
			const existing = manager.getProviderSettings("openai-codex")

			manager.saveProviderSettings(
				{
					...(existing ?? { provider: "openai-codex" }),
					provider: "openai-codex",
					auth: {
						accessToken: credentials.access,
						refreshToken: credentials.refresh,
						accountId: credentials.accountId,
					},
				},
				{ tokenSource: "oauth" },
			)
		} catch (error) {
			Logger.error("[SdkAuthService] Failed to save Codex credentials:", error)
		}
	}

	/**
	 * Clear Codex credentials from provider settings.
	 */
	async clearCodexCredentials(): Promise<void> {
		try {
			const manager = getProviderSettingsManager()
			const existing = manager.getProviderSettings("openai-codex")
			if (existing) {
				manager.saveProviderSettings(
					{
						...existing,
						provider: "openai-codex",
						auth: undefined,
					},
					{ tokenSource: "manual" },
				)
			}
		} catch (error) {
			Logger.error("[SdkAuthService] Failed to clear Codex credentials:", error)
		}
	}

	// ---- Logout ----

	/**
	 * Handle deauthentication — clear tokens from providers.json and push unauthenticated state.
	 */
	async handleDeauth(_reason: LogoutReason = LogoutReason.UNKNOWN): Promise<void> {
		try {
			this._clineAuthInfo = null
			this._authenticated = false
			clearClineCredentials()
			await this.sendAuthStatusUpdate()

			// Notify BannerService of auth change (mirrors classic AuthService)
			BannerService.onAuthUpdate(null).catch((error) => {
				Logger.error("[SdkAuthService] Banner update failed after logout", error)
			})
		} catch (error) {
			Logger.error("[SdkAuthService] Error signing out:", error)
			throw error
		}
	}

	/**
	 * Handle auth callback from URI handler.
	 * This is called when the browser redirects back to the extension after OAuth.
	 */
	async handleAuthCallback(authorizationCode: string, provider: string): Promise<void> {
		try {
			// Exchange the authorization code for tokens using the Cline API
			const apiBaseUrl = ClineEnv.config().apiBaseUrl
			const callbackUrl = await HostProvider.get().getCallbackUrl("/auth")

			const tokenUrl = new URL(CLINE_API_ENDPOINT.TOKEN_EXCHANGE, apiBaseUrl)
			const response = await fetch(tokenUrl.toString(), {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
					...(await buildBasicClineHeaders()),
				},
				body: JSON.stringify({
					grant_type: "authorization_code",
					code: authorizationCode,
					client_type: "extension",
					redirect_uri: callbackUrl,
					provider: provider,
				}),
			})

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}))
				throw new Error(errorData.error_description || "Failed to exchange authorization code for tokens")
			}

			const responseJSON = await response.json()
			const tokenData = responseJSON.data

			if (!tokenData.accessToken || !tokenData.refreshToken || !tokenData.userInfo) {
				throw new Error("Invalid token response from server")
			}

			// Fetch full user info
			const userInfo = await this.fetchUserInfoFromApi(tokenData.accessToken)

			const authInfo: ClineAuthInfo = {
				idToken: tokenData.accessToken,
				refreshToken: tokenData.refreshToken,
				userInfo: userInfo ?? {
					id: tokenData.userInfo.clineUserId || "",
					email: tokenData.userInfo.email || "",
					displayName: tokenData.userInfo.name || "",
					createdAt: new Date().toISOString(),
					organizations: [],
				},
				expiresAt: new Date(tokenData.expiresAt).getTime() / 1000,
				provider: "cline",
				startedAt: Date.now(),
			}

			this._clineAuthInfo = authInfo
			this._authenticated = true

			// Persist to providers.json
			writeClineCredentials({
				accessToken: tokenData.accessToken,
				refreshToken: tokenData.refreshToken,
				expiresAt: new Date(tokenData.expiresAt).getTime(),
				accountId: authInfo.userInfo.id,
			})

			await this.sendAuthStatusUpdate()
		} catch (error) {
			Logger.error("[SdkAuthService] Error handling auth callback:", error)
			throw error
		}
	}

	/**
	 * Handle OCA auth callback.
	 */
	async handleOcaAuthCallback(_code: string, _state: string): Promise<void> {
		// OCA uses SDK's local callback server, so this shouldn't normally be called.
		// Keeping it as a stub for interface compatibility.
		Logger.warn("[SdkAuthService] handleOcaAuthCallback called — OCA uses SDK callback server")
	}

	/**
	 * Handle MCP OAuth callback.
	 */
	async handleMcpOAuthCallback(_serverHash: string, _code: string, _state: string | null): Promise<void> {
		// Will be implemented in Step 7 (MCP Integration)
		Logger.warn("[SdkAuthService] handleMcpOAuthCallback not yet implemented (Step 7)")
	}

	// ---- Restore auth on startup ----

	/**
	 * Restore authentication from providers.json on startup.
	 *
	 * Reads tokens from providers.json, refreshes if needed, then fetches
	 * user profile from the API. This matches the CLI's pattern — credentials
	 * live in providers.json, user info is fetched fresh each session.
	 */
	async restoreRefreshTokenAndRetrieveAuthInfo(): Promise<void> {
		try {
			const creds = readClineCredentials()
			if (!creds) {
				this._authenticated = false
				this._clineAuthInfo = null
				return
			}

			// Build a minimal ClineAuthInfo from providers.json tokens
			this._clineAuthInfo = {
				idToken: creds.accessToken,
				refreshToken: creds.refreshToken,
				expiresAt: creds.expiresAt ? creds.expiresAt / 1000 : undefined, // providers.json uses ms, we use seconds
				userInfo: {
					id: creds.accountId ?? "",
					email: "",
					displayName: "",
					organizations: [],
				},
				provider: "cline",
			}
			this._authenticated = true

			// Try to refresh the token if it's expired
			const expiresAt = this._clineAuthInfo.expiresAt
			if (expiresAt) {
				const currentTime = Date.now() / 1000
				const bufferSeconds = 5 * 60
				if (currentTime + bufferSeconds >= expiresAt && creds.refreshToken) {
					await this.refreshAccessToken()
				}
			}

			// Fetch full user info from the API (the key step — fills in
			// email, displayName, organizations that providers.json doesn't store)
			if (this._authenticated && this._clineAuthInfo) {
				const userInfo = await this.fetchUserInfoFromApi(this._clineAuthInfo.idToken)
				if (userInfo) {
					this._clineAuthInfo.userInfo = userInfo
				} else {
					Logger.warn("[SdkAuthService] Could not fetch user info on restore — UI will show limited profile")
				}
			}

			await this.sendAuthStatusUpdate()

			// Notify BannerService of auth change (mirrors classic AuthService)
			BannerService.onAuthUpdate(this._clineAuthInfo?.userInfo?.id || null).catch((error) => {
				Logger.error("[SdkAuthService] Banner update failed after restore", error)
			})
		} catch (error) {
			Logger.error("[SdkAuthService] Error restoring auth token:", error)
			this._authenticated = false
			this._clineAuthInfo = null
		}
	}

	// ---- Streaming subscriptions ----

	/**
	 * Subscribe to authStatusUpdate events.
	 * Pushes initial auth state immediately on subscribe.
	 */
	async subscribeToAuthStatusUpdate(
		controller: Controller,
		_request: EmptyRequest,
		responseStream: StreamingResponseHandler<AuthState>,
		requestId?: string,
	): Promise<void> {
		this._activeAuthStatusUpdateHandlers.add(responseStream)
		this._handlerToController.set(responseStream, controller)

		const cleanup = () => {
			this._activeAuthStatusUpdateHandlers.delete(responseStream)
			this._handlerToController.delete(responseStream)
		}

		if (requestId) {
			getRequestRegistry().registerRequest(requestId, cleanup, { type: "authStatusUpdate_subscription" }, responseStream)
		}

		// Push initial auth state immediately (prevents race condition)
		try {
			await this.sendAuthStatusUpdate()
		} catch (error) {
			Logger.error("[SdkAuthService] Error sending initial auth status:", error)
			this._activeAuthStatusUpdateHandlers.delete(responseStream)
			this._handlerToController.delete(responseStream)
		}
	}

	/**
	 * Send an authStatusUpdate event to all active subscribers.
	 */
	async sendAuthStatusUpdate(): Promise<void> {
		const authInfo: AuthState = this.getInfo()
		const uniqueControllers = new Set<Controller>()

		const streamSends = Array.from(this._activeAuthStatusUpdateHandlers).map(async (responseStream) => {
			const controller = this._handlerToController.get(responseStream)
			if (controller) {
				uniqueControllers.add(controller)
			}
			try {
				await responseStream(authInfo, false)
			} catch (error) {
				Logger.error("[SdkAuthService] Error sending authStatusUpdate event:", error)
				this._activeAuthStatusUpdateHandlers.delete(responseStream)
				this._handlerToController.delete(responseStream)
			}
		})

		await Promise.all(streamSends)

		// Update state in webviews once per unique controller
		await Promise.all(Array.from(uniqueControllers).map((c) => c.postStateToWebview()))
	}

	// ---- Provider-specific auth stubs ----

	/**
	 * Handle OpenRouter OAuth callback.
	 */
	async handleOpenRouterCallback(_code: string): Promise<void> {
		// OpenRouter uses a different OAuth flow — will be implemented when needed
		Logger.warn("[SdkAuthService] handleOpenRouterCallback not yet implemented")
	}

	/**
	 * Handle Requesty OAuth callback.
	 */
	async handleRequestyCallback(_code: string): Promise<void> {
		Logger.warn("[SdkAuthService] handleRequestyCallback not yet implemented")
	}

	/**
	 * Handle Hicap OAuth callback.
	 */
	async handleHicapCallback(_code: string): Promise<void> {
		Logger.warn("[SdkAuthService] handleHicapCallback not yet implemented")
	}
}
