import { type EmptyRequest, OpenAIAuthState, OpenAIUserInfo, String as ProtoString } from "@shared/proto/index.cline"
import type { Controller } from "@/core/controller"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { AuthHandler } from "@/hosts/external/AuthHandler"
import { Logger } from "@/shared/services/Logger"
import { openExternal } from "@/utils/env"
import { LogoutReason } from "../types"
import { OpenAIAuthProvider } from "./providers/OpenAIAuthProvider"

export class OpenAIAuthService {
	protected static instance: OpenAIAuthService | null = null
	protected _authenticated: boolean = false
	protected _openAIAuthState: OpenAIAuthState | null = null
	protected _provider: OpenAIAuthProvider | null = null
	protected _controller: Controller | null = null
	protected _refreshInFlight: Promise<void> | null = null
	protected _interactiveLoginPending: boolean = false
	protected _activeAuthStatusUpdateSubscriptions = new Set<{
		controller: Controller
		responseStream: StreamingResponseHandler<OpenAIAuthState>
	}>()

	protected constructor() {
		this._provider = new OpenAIAuthProvider()
	}

	private requireController(): Controller {
		if (this._controller) {
			return this._controller
		}
		throw new Error("Controller has not been initialized")
	}

	private requireProvider(): OpenAIAuthProvider {
		if (!this._provider) {
			throw new Error("Auth provider is not set")
		}
		return this._provider
	}

	/**
	 * Initializes the singleton with a Controller.
	 * Safe to call multiple times; updates controller on existing instance.
	 */
	public static initialize(controller: Controller): OpenAIAuthService {
		if (!OpenAIAuthService.instance) {
			OpenAIAuthService.instance = new OpenAIAuthService()
		}
		OpenAIAuthService.instance._controller = controller
		return OpenAIAuthService.instance
	}

	/**
	 * Gets the singleton instance of OpenAIAuthService.
	 * Throws if not initialized. Call initialize(controller) first.
	 */
	public static getInstance(): OpenAIAuthService {
		if (!OpenAIAuthService.instance || !OpenAIAuthService.instance._controller) {
			throw new Error("OpenAIAuthService not initialized. Call OpenAIAuthService.initialize(controller) first.")
		}
		return OpenAIAuthService.instance
	}

	/**
	 * Returns current OpenAI authentication state.
	 */
	getInfo(): OpenAIAuthState {
		let user: OpenAIUserInfo | undefined
		if (this._openAIAuthState && this._authenticated) {
			const userInfo = this._openAIAuthState.user
			user = OpenAIUserInfo.create({
				uid: userInfo?.uid,
				displayName: userInfo?.displayName,
				email: userInfo?.email,
			})
		}
		return OpenAIAuthState.create({ user })
	}

	public get isAuthenticated(): boolean {
		return this._authenticated
	}

	private async refreshAuthState(): Promise<void> {
		// Single-flight to avoid concurrent refresh storms
		if (this._refreshInFlight) {
			await this._refreshInFlight
			return
		}
		this._refreshInFlight = (async () => {
			try {
				await this.restoreRefreshTokenAndRetrieveAuthInfo()
			} finally {
				this._refreshInFlight = null
			}
		})()
		await this._refreshInFlight
	}

	/**
	 * Returns the current valid access token or throws.
	 * Automatically refreshes if needed.
	 * Triggers re-login if token cannot be obtained.
	 */
	public async getAuthToken(): Promise<string | null> {
		await this.refreshAuthState()
		const token = this._openAIAuthState?.apiKey || null
		if (!token) {
			Logger.warn("[OpenAI OAuth] No valid access token available after refresh attempt")
		}
		return token
	}

	async createAuthRequest(): Promise<ProtoString> {
		const authUrl = await this.triggerAuth()
		return ProtoString.create({ value: authUrl })
	}

	async triggerAuth(): Promise<string> {
		const ctrl = this.requireController()
		const provider = this.requireProvider()
		const authHandler = AuthHandler.getInstance()
		authHandler.setEnabled(true)
		const baseCallbackUrl = await authHandler.getCallbackUrl()
		const callbackUrl = `${baseCallbackUrl}/auth/openai`
		const authUrl = provider.getAuthUrl(ctrl, callbackUrl)
		const authUrlString = authUrl.toString()
		if (!authUrlString) {
			throw new Error("Failed to generate OpenAI authentication URL")
		}
		await openExternal(authUrlString)
		return authUrlString
	}

	async handleDeauth(_: LogoutReason = LogoutReason.UNKNOWN): Promise<void> {
		try {
			this.clearAuth()
			this._openAIAuthState = null
			this._authenticated = false
			await this.sendAuthStatusUpdate()
		} catch (error) {
			Logger.error("Error signing out:", error)
			throw error
		}
	}

	private clearAuth(): void {
		const ctrl = this.requireController()
		this.requireProvider().clearAuth(ctrl)
	}

	async handleAuthCallback(code: string, state: string): Promise<void> {
		const provider = this.requireProvider()
		const ctrl = this.requireController()
		try {
			this._openAIAuthState = await provider.signIn(ctrl, code, state)
			this._authenticated = true
			await this.sendAuthStatusUpdate()
		} catch (error) {
			Logger.error("Error signing in with authorization code:", error)
			throw error
		} finally {
			const authHandler = AuthHandler.getInstance()
			authHandler.setEnabled(false)
		}
	}

	async restoreRefreshTokenAndRetrieveAuthInfo(): Promise<void> {
		const provider = this.requireProvider()
		const ctrl = this.requireController()
		try {
			Logger.debug("[OpenAI OAuth] Attempting to restore auth state...")
			this._openAIAuthState = await provider.retrieveOpenAIAuthState(ctrl)
			if (this._openAIAuthState) {
				Logger.debug("[OpenAI OAuth] Successfully restored auth state")
				this._authenticated = true
				await this.sendAuthStatusUpdate()
				return
			}
			Logger.debug("[OpenAI OAuth] No user found after restoring auth token")
			await this.kickstartInteractiveLoginAsFallback()
		} catch (error: unknown) {
			Logger.error("[OpenAI OAuth] Error restoring auth token:", error as Error | undefined)
			await this.kickstartInteractiveLoginAsFallback(error)
		}
	}

	private async kickstartInteractiveLoginAsFallback(_err?: unknown): Promise<void> {
		// Clear any stale secrets and broadcast unauthenticated state
		Logger.debug("[OpenAI OAuth] Clearing stale auth and initiating re-login flow...")
		this.clearAuth()
		this._authenticated = false
		this._openAIAuthState = null
		await this.sendAuthStatusUpdate()

		// Avoid repeated/looping login attempts
		if (this._interactiveLoginPending) {
			Logger.warn("[OpenAI OAuth] Interactive login already pending, skipping duplicate attempt")
			return
		}
		this._interactiveLoginPending = true
		try {
			// Kickstart interactive login (opens browser)
			Logger.debug("[OpenAI OAuth] Opening browser for user authentication...")
			await this.createAuthRequest()
			// Wait up to 60 seconds for user to complete login
			const timeoutMs = 60_000
			const pollMs = 250
			const start = Date.now()
			while (!this._authenticated && Date.now() - start < timeoutMs) {
				await new Promise((r) => setTimeout(r, pollMs))
			}
			if (!this._authenticated) {
				Logger.warn("[OpenAI OAuth] Interactive login timed out after 60 seconds - user may not have completed auth")
			} else {
				Logger.debug("[OpenAI OAuth] User successfully authenticated")
			}
		} catch (e: unknown) {
			Logger.error("[OpenAI OAuth] Failed to initiate interactive login:", e as Error | undefined)
		} finally {
			this._interactiveLoginPending = false
		}
	}

	async subscribeToAuthStatusUpdate(
		_request: EmptyRequest,
		responseStream: StreamingResponseHandler<OpenAIAuthState>,
		requestId?: string,
	): Promise<void> {
		Logger.log("Subscribing to OpenAI authStatusUpdate")
		const ctrl = this.requireController()
		if (!this._openAIAuthState) {
			this._openAIAuthState = await this.requireProvider().getExistingAuthState(ctrl)
			this._authenticated = !!this._openAIAuthState
		}
		const entry = { controller: ctrl, responseStream }
		this._activeAuthStatusUpdateSubscriptions.add(entry)
		const cleanup = () => {
			this._activeAuthStatusUpdateSubscriptions.delete(entry)
		}
		if (requestId) {
			getRequestRegistry().registerRequest(
				requestId,
				cleanup,
				{ type: "openai_authStatusUpdate_subscription" },
				responseStream,
			)
		}
		try {
			await this.sendAuthStatusUpdate()
		} catch (error) {
			Logger.error("Error sending initial auth status:", error)
			this._activeAuthStatusUpdateSubscriptions.delete(entry)
		}
	}

	async sendAuthStatusUpdate(): Promise<void> {
		if (this._activeAuthStatusUpdateSubscriptions.size === 0) {
			return
		}
		const postedControllers = new Set<Controller>()
		const promises = Array.from(this._activeAuthStatusUpdateSubscriptions).map(async (entry) => {
			const { controller: ctrl, responseStream } = entry
			try {
				const authInfo: OpenAIAuthState = this.getInfo()
				await responseStream(authInfo, false)
				if (ctrl && !postedControllers.has(ctrl)) {
					postedControllers.add(ctrl)
					await ctrl.postStateToWebview()
				}
			} catch (error) {
				Logger.error("Error sending OpenAI authStatusUpdate event:", error)
				this._activeAuthStatusUpdateSubscriptions.delete(entry)
			}
		})
		await Promise.all(promises)
	}
}
