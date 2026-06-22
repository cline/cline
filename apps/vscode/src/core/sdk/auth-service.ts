// SDK-backed Cline account authentication for the lean Controller.
//
// Distilled from the deleted apps/vscode/src/sdk/auth-service.ts. Adapted to the current
// src/core/sdk modules: it uses the shared ProviderSettingsManager (provider-settings.ts) as the
// single source of truth for the Cline access token, so the token written at sign-in is exactly
// the token session-config reads when starting an LLM call, which is the same providers.json the
// SDK runtime reads.
//
// Responsibilities:
//   - Restore persisted cline credentials on startup.
//   - createAuthRequest(): start sign-in. In E2E/local it does a browserless MOCK exchange against
//     the local mock server; in prod it runs the SDK Cline OAuth flow.
//   - subscribeToAuthStatusUpdate(): register a webview stream and push the current AuthState,
//     keep it open, and push on login/logout.
//   - signOut(): clear cline credentials and push an empty AuthState.
//   - Hold the in-memory user/token so the webview gating + session-config can read it.

import {
	createOAuthClientCallbacks,
	getValidClineCredentials,
	loginAndSaveProviderOAuthCredentials,
	type OAuthCredentials,
	resolveProviderApiKeyFromSettings,
} from "@cline/core"
import { AuthState, UserInfo } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import { String as ProtoString } from "@shared/proto/cline/common"
import { Logger } from "@shared/services/Logger"
import { ClineEnv } from "@/config"
import type { Controller } from "@/core/controller"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { CLINE_API_ENDPOINT } from "@/shared/cline/api"
import { fetch } from "@/shared/net"
import { openExternal } from "@/utils/env"
import { getProviderSettingsManager } from "./provider-settings"

const WORKOS_TOKEN_PREFIX = "workos:"
const CLINE_PROVIDER_ID = "cline"
/** Well-known authorization code the e2e mock server (fixtures/server) exchanges for tokens. */
const E2E_TEST_CODE = "test-personal-token"

/** Cached profile + token for the signed-in Cline user (NOT persisted here — providers.json owns the token). */
export interface ClineAuthInfo {
	accessToken: string // workos-prefixed (as stored in providers.json)
	refreshToken?: string
	expiresAt?: number // ms since epoch
	userInfo: ClineAccountUserInfo
}

export interface ClineAccountUserInfo {
	id: string
	email: string
	displayName: string
	appBaseUrl?: string
	organizations?: unknown[]
}

/**
 * Singleton auth service. One instance owns the in-memory auth state and the set of active
 * authStatusUpdate webview streams. Sign-in/out persist to providers.json via the shared
 * ProviderSettingsManager.
 */
export class AuthService {
	private static _instance: AuthService | null = null

	private _authInfo: ClineAuthInfo | null = null
	private _handlers = new Set<StreamingResponseHandler<AuthState>>()
	private _handlerToController = new Map<StreamingResponseHandler<AuthState>, Controller>()

	private constructor() {}

	static getInstance(): AuthService {
		if (!AuthService._instance) {
			AuthService._instance = new AuthService()
		}
		return AuthService._instance
	}

	// ---- public accessors used by session-config / the Controller ----

	isAuthenticated(): boolean {
		return this._authInfo !== null
	}

	/** Workos-prefixed access token for the signed-in user, or undefined. */
	getAccessToken(): string | undefined {
		return this._authInfo?.accessToken
	}

	getUserInfo(): ClineAccountUserInfo | null {
		return this._authInfo?.userInfo ?? null
	}

	/** Current auth state for the webview (user when signed in, empty otherwise). */
	getInfo(): AuthState {
		if (this._authInfo) {
			const u = this._authInfo.userInfo
			return AuthState.create({
				user: UserInfo.create({
					uid: u.id,
					displayName: u.displayName,
					email: u.email,
					appBaseUrl: u.appBaseUrl ?? ClineEnv.config().appBaseUrl,
				}),
			})
		}
		return AuthState.create({})
	}

	// ---- sign-in ----

	/**
	 * Start sign-in. E2E/local performs a browserless mock exchange; prod runs the SDK OAuth flow.
	 * Returns a String the webview can show (a URL or status message).
	 */
	async createAuthRequest(): Promise<ProtoString> {
		const isMock = process.env.E2E_TEST === "true" || ClineEnv.config().environment === "local"
		if (isMock) {
			return this.createMockAuthRequest()
		}
		return this.createOAuthRequest()
	}

	/**
	 * E2E/local sign-in: POST {apiBaseUrl}/api/v1/auth/token with the well-known test code, persist
	 * the returned tokens to providers.json, fetch /api/v1/users/me, and push an auth-status update.
	 * No browser. Mirrors the deleted AuthServiceMock path.
	 */
	private async createMockAuthRequest(): Promise<ProtoString> {
		const apiBaseUrl = ClineEnv.config().apiBaseUrl
		const tokenUrl = new URL(CLINE_API_ENDPOINT.TOKEN_EXCHANGE, apiBaseUrl)
		const response = await fetch(tokenUrl.toString(), {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ code: E2E_TEST_CODE, grantType: "authorization_code" }),
		})
		if (!response.ok) {
			throw new Error(`Mock server authentication failed: ${response.status} ${response.statusText}`)
		}
		const json = (await response.json()) as { success?: boolean; data?: MockTokenResponse }
		const tokenData = json?.data
		if (!json?.success || !tokenData?.accessToken) {
			throw new Error("Invalid response from mock server")
		}

		const expiresAt = tokenData.expiresAt ? new Date(tokenData.expiresAt).getTime() : undefined
		this.writeClineCredentials(tokenData.accessToken, tokenData.refreshToken, expiresAt, tokenData.userInfo?.clineUserId)
		this._authInfo = {
			accessToken: this.formatToken(tokenData.accessToken),
			refreshToken: tokenData.refreshToken,
			expiresAt,
			userInfo: {
				id: tokenData.userInfo?.clineUserId || tokenData.userInfo?.subject || "",
				email: tokenData.userInfo?.email || "",
				displayName: tokenData.userInfo?.name || "",
				appBaseUrl: ClineEnv.config().appBaseUrl,
				organizations: tokenData.userInfo?.organizations ?? [],
			},
		}

		await this.sendAuthStatusUpdate()
		Logger.log(`[AuthService] E2E mock login completed as ${this._authInfo.userInfo.email}`)
		return ProtoString.create({ value: apiBaseUrl })
	}

	/**
	 * Production sign-in via the SDK Cline OAuth handler. The handler opens the browser, exchanges
	 * the device/auth code, and saves credentials to providers.json. We then refresh in-memory
	 * state and push an auth-status update.
	 */
	private async createOAuthRequest(): Promise<ProtoString> {
		let resolveUrl!: (value: string) => void
		let rejectUrl!: (reason: unknown) => void
		const urlPromise = new Promise<string>((resolve, reject) => {
			resolveUrl = resolve
			rejectUrl = reject
		})

		void (async () => {
			try {
				const manager = getProviderSettingsManager()
				await loginAndSaveProviderOAuthCredentials(manager, CLINE_PROVIDER_ID, {
					callbacks: createOAuthClientCallbacks({
						onOutput: (message: string) => resolveUrl(message),
						onPrompt: async (prompt: { defaultValue?: string }) => prompt.defaultValue ?? "",
						openUrl: async (url: string) => {
							resolveUrl(url)
							await openExternal(url)
						},
						onOpenUrlError: ({ url, error }: { url: string; error: unknown }) => {
							Logger.error(`[AuthService] Failed to open browser for ${url}:`, error)
						},
					}),
				})

				// Credentials are now in providers.json; load profile + push state.
				await this.restoreAuth()
			} catch (error) {
				rejectUrl(error)
				Logger.error("[AuthService] Cline OAuth login failed:", error)
			}
		})()

		return ProtoString.create({ value: await urlPromise })
	}

	// ---- sign-out ----

	/** Clear cline credentials from providers.json + memory and push an empty AuthState. */
	async signOut(): Promise<void> {
		try {
			this._authInfo = null
			this.clearClineCredentials()
			await this.sendAuthStatusUpdate()
		} catch (error) {
			Logger.error("[AuthService] signOut failed:", error)
		}
	}

	// ---- restore on startup ----

	/**
	 * Restore auth from providers.json. Reads the stored cline token, validates/refreshes it via the
	 * SDK, fetches the user profile from the API, and pushes an auth-status update.
	 */
	async restoreAuth(): Promise<void> {
		try {
			const stored = this.readClineCredentials()
			if (!stored) {
				this._authInfo = null
				return
			}

			// Validate / refresh the token via the SDK. On refresh, persist the new credentials.
			const validated = await this.validateCredentials(stored)
			if (!validated) {
				this._authInfo = null
				this.clearClineCredentials()
				await this.sendAuthStatusUpdate()
				return
			}

			const userInfo = await this.fetchUserInfo(validated.access)
			this._authInfo = {
				accessToken: this.formatToken(validated.access),
				refreshToken: validated.refresh,
				expiresAt: validated.expires || undefined,
				userInfo: userInfo ?? {
					id: validated.accountId ?? stored.accountId ?? "",
					email: validated.email ?? "",
					displayName: "",
					appBaseUrl: ClineEnv.config().appBaseUrl,
				},
			}
			await this.sendAuthStatusUpdate()
		} catch (error) {
			Logger.error("[AuthService] restoreAuth failed:", error)
			this._authInfo = null
		}
	}

	private async validateCredentials(stored: {
		accessToken: string
		refreshToken?: string
		expiresAt?: number
		accountId?: string
	}): Promise<OAuthCredentials | null> {
		try {
			const current: OAuthCredentials = {
				access: stored.accessToken,
				refresh: stored.refreshToken ?? "",
				expires: stored.expiresAt ?? 0,
				accountId: stored.accountId,
			}
			const valid = await getValidClineCredentials(current, { apiBaseUrl: ClineEnv.config().apiBaseUrl })
			if (!valid) {
				return null
			}
			// Persist if the token changed (refresh).
			if (valid.access !== current.access || valid.refresh !== current.refresh) {
				this.writeClineCredentials(valid.access, valid.refresh, valid.expires || undefined, valid.accountId)
			}
			return valid
		} catch (error) {
			Logger.error("[AuthService] validateCredentials failed:", error)
			// Keep the stored token if validation hit a transient error.
			return {
				access: stored.accessToken,
				refresh: stored.refreshToken ?? "",
				expires: stored.expiresAt ?? 0,
				accountId: stored.accountId,
			}
		}
	}

	// ---- API ----

	private async fetchUserInfo(accessToken: string): Promise<ClineAccountUserInfo | null> {
		try {
			const apiBaseUrl = ClineEnv.config().apiBaseUrl
			const response = await fetch(`${apiBaseUrl}/api/v1/users/me`, {
				headers: {
					Authorization: `Bearer ${this.formatToken(accessToken)}`,
					"Content-Type": "application/json",
					Accept: "application/json",
				},
			})
			if (!response.ok) {
				return null
			}
			const json = (await response.json()) as { data?: RawUserInfo }
			const data = json?.data
			if (!data) {
				return null
			}
			return {
				id: data.id ?? data.clineUserId ?? "",
				email: data.email ?? "",
				displayName: data.displayName ?? data.name ?? "",
				appBaseUrl: ClineEnv.config().appBaseUrl,
				organizations: data.organizations ?? [],
			}
		} catch (error) {
			Logger.error("[AuthService] fetchUserInfo failed:", error)
			return null
		}
	}

	// ---- streaming subscriptions ----

	/** Register a webview stream, push the current AuthState immediately, and keep it open. */
	async subscribeToAuthStatusUpdate(
		controller: Controller,
		_request: EmptyRequest,
		responseStream: StreamingResponseHandler<AuthState>,
		requestId?: string,
	): Promise<void> {
		this._handlers.add(responseStream)
		this._handlerToController.set(responseStream, controller)

		const cleanup = () => {
			this._handlers.delete(responseStream)
			this._handlerToController.delete(responseStream)
		}
		if (requestId) {
			getRequestRegistry().registerRequest(requestId, cleanup, { type: "authStatusUpdate_subscription" }, responseStream)
		}

		try {
			await responseStream(this.getInfo(), false)
		} catch (error) {
			Logger.error("[AuthService] Error sending initial auth status:", error)
			cleanup()
		}
	}

	/** Push the current AuthState to all subscribers and refresh webview state once per controller. */
	async sendAuthStatusUpdate(): Promise<void> {
		const authState = this.getInfo()
		const controllers = new Set<Controller>()
		await Promise.all(
			Array.from(this._handlers).map(async (stream) => {
				const controller = this._handlerToController.get(stream)
				if (controller) {
					controllers.add(controller)
				}
				try {
					await stream(authState, false)
				} catch (error) {
					Logger.error("[AuthService] Error sending authStatusUpdate:", error)
					this._handlers.delete(stream)
					this._handlerToController.delete(stream)
				}
			}),
		)
		// Refresh ExtensionState so welcome-view gating reflects the new auth state.
		await Promise.all(Array.from(controllers).map((c) => c.postStateToWebview().catch(() => {})))
	}

	// ---- providers.json helpers ----

	private formatToken(token: string): string {
		const t = token.trim()
		return t.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX) ? t : `${WORKOS_TOKEN_PREFIX}${t}`
	}

	private stripToken(token: string): string {
		const t = token.trim()
		return t.toLowerCase().startsWith(WORKOS_TOKEN_PREFIX) ? t.slice(WORKOS_TOKEN_PREFIX.length) : t
	}

	private readClineCredentials(): {
		accessToken: string
		refreshToken?: string
		expiresAt?: number
		accountId?: string
	} | null {
		try {
			const manager = getProviderSettingsManager()
			const settings = manager.getProviderSettings(CLINE_PROVIDER_ID)
			const accessToken = settings?.auth?.accessToken
			if (!accessToken) {
				return null
			}
			return {
				accessToken: this.stripToken(accessToken),
				refreshToken: settings?.auth?.refreshToken,
				expiresAt: (settings?.auth as { expiresAt?: number } | undefined)?.expiresAt,
				accountId: settings?.auth?.accountId,
			}
		} catch (error) {
			Logger.error("[AuthService] readClineCredentials failed:", error)
			return null
		}
	}

	private writeClineCredentials(accessToken: string, refreshToken?: string, expiresAt?: number, accountId?: string): void {
		try {
			const manager = getProviderSettingsManager()
			const existing = manager.getProviderSettings(CLINE_PROVIDER_ID)
			const auth: Record<string, unknown> = {
				...(existing?.auth ?? {}),
				accessToken: this.formatToken(accessToken),
				refreshToken,
				accountId,
			}
			if (expiresAt !== undefined) {
				auth.expiresAt = expiresAt
			}
			manager.saveProviderSettings(
				{
					...(existing ?? { provider: CLINE_PROVIDER_ID }),
					provider: CLINE_PROVIDER_ID,
					auth,
				},
				{ tokenSource: "oauth", setLastUsed: true },
			)
		} catch (error) {
			Logger.error("[AuthService] writeClineCredentials failed:", error)
		}
	}

	private clearClineCredentials(): void {
		try {
			const manager = getProviderSettingsManager()
			const existing = manager.getProviderSettings(CLINE_PROVIDER_ID)
			if (existing) {
				manager.saveProviderSettings(
					{ ...existing, provider: CLINE_PROVIDER_ID, auth: undefined },
					{ tokenSource: "manual" },
				)
			}
		} catch (error) {
			Logger.error("[AuthService] clearClineCredentials failed:", error)
		}
	}
}

/** Resolve the stored, workos-prefixed cline access token from providers.json (used by session-config). */
export function resolveClineApiKey(): string | undefined {
	try {
		return resolveProviderApiKeyFromSettings(getProviderSettingsManager(), CLINE_PROVIDER_ID)
	} catch {
		return undefined
	}
}

interface MockTokenResponse {
	accessToken: string
	refreshToken?: string
	expiresAt?: string
	userInfo?: {
		subject?: string
		clineUserId?: string
		email?: string
		name?: string
		organizations?: unknown[]
	}
}

interface RawUserInfo {
	id?: string
	clineUserId?: string
	email?: string
	displayName?: string
	name?: string
	organizations?: unknown[]
}
