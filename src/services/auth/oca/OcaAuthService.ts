import { type EmptyRequest, String as ProtoString } from "@shared/proto/cline/common"
import { OcaAuthState, OcaUserInfo } from "@shared/proto/cline/ocaAccount"
import type { Controller } from "@/core/controller"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { HostProvider } from "@/hosts/host-provider"
import { openExternal } from "@/utils/env"
import { OcaAuthProvider } from "./providers/OcaAuthProvider"
import type { OcaConfig } from "./utils/types"
import { getOcaConfig } from "./utils/utils"
// import { AuthHandler } from "@/hosts/external/AuthHandler"

export class OcaAuthService {
	protected static instance: OcaAuthService | null = null
	protected readonly _config: OcaConfig
	protected _authenticated: boolean = false
	protected _ocaAuthState: OcaAuthState | null = null
	protected _provider: OcaAuthProvider | null = null
	protected _refreshInFlight: Promise<void> | null = null
	protected _activeAuthStatusUpdateSubscriptions = new Set<{
		controller: Controller
		responseStream: StreamingResponseHandler<OcaAuthState>
	}>()

	protected constructor() {
		this._config = getOcaConfig()
		this._provider = new OcaAuthProvider(this._config)
	}

	private requireProvider(): OcaAuthProvider {
		if (!this._provider) {
			throw new Error("Auth provider is not set")
		}
		return this._provider
	}

	/**
	 * Gets the singleton instance of OcaAuthService.
	 */
	public static getInstance(): OcaAuthService {
		if (!OcaAuthService.instance) {
			OcaAuthService.instance = new OcaAuthService()
		}
		return OcaAuthService.instance
	}

	/**
	 * Returns a current OCA authentication state.
	 */
	getInfo(): OcaAuthState {
		let user: OcaUserInfo | undefined
		if (this._ocaAuthState && this._authenticated) {
			const userInfo = this._ocaAuthState.user
			user = OcaUserInfo.create({
				uid: userInfo?.uid,
				displayName: userInfo?.displayName,
				email: userInfo?.email,
			})
		}
		return OcaAuthState.create({ user })
	}

	public get isAuthenticated(): boolean {
		return this._authenticated
	}

	private async refreshAuthState(controller: Controller): Promise<void> {
		// Single-flight to avoid concurrent refresh storms
		if (this._refreshInFlight) {
			await this._refreshInFlight
			return
		}
		this._refreshInFlight = (async () => {
			try {
				await this.restoreRefreshTokenAndRetrieveAuthInfo(controller)
			} finally {
				this._refreshInFlight = null
			}
		})()
		await this._refreshInFlight
	}

	async getAuthToken(controller: Controller): Promise<string | null> {
		// Ensure we have a state with a token
		if (!this._ocaAuthState || !this._ocaAuthState.apiKey) {
			await this.refreshAuthState(controller)
			return this._ocaAuthState?.apiKey ?? null
		}

		const apiKey = this._ocaAuthState.apiKey

		// Check if the token should be refreshed
		let shouldRefresh = false
		try {
			shouldRefresh = await this.requireProvider().shouldRefreshAccessToken(apiKey)
		} catch {
			// If the provider check fails, err on the side of refreshing
			shouldRefresh = true
		}

		if (shouldRefresh) {
			await this.refreshAuthState(controller)
		}

		return this._ocaAuthState?.apiKey ?? null
	}

	async createAuthRequest(controller: Controller): Promise<ProtoString> {
		if (this._authenticated) {
			this.sendAuthStatusUpdate(controller)
			return ProtoString.create({ value: "Already authenticated" })
		}
		if (!this._config.idcs_url) {
			throw new Error("IDCS URI is not configured")
		}
		// let callbackHost = await AuthHandler.getInstance().getCallbackUri()
		const callbackHost = await HostProvider.get().getCallbackUri()
		const callbackUrl = "http://localhost:8669/callback" // `${callbackHost}/auth/oca`
		// const callbackUrl = `${callbackHost}/auth/oca`
		const authUrl = this.requireProvider().getAuthUrl(callbackUrl)
		const authUrlString = authUrl?.toString() || ""
		if (!authUrlString) {
			throw new Error("Failed to generate authentication URL")
		}
		await openExternal(authUrlString)
		return ProtoString.create({ value: authUrlString })
	}

	async handleDeauth(controller: Controller): Promise<void> {
		try {
			this.clearAuth(controller)
			this._ocaAuthState = null
			this._authenticated = false
			await this.sendAuthStatusUpdate(controller)
		} catch (error) {
			console.error("Error signing out:", error)
			throw error
		}
	}

	private clearAuth(controller: Controller): void {
		this.requireProvider().clearAuth(controller)
	}

	async handleAuthCallback(controller: Controller, code: string, state: string): Promise<void> {
		const provider = this.requireProvider()
		try {
			this._ocaAuthState = await provider.signIn(controller, code, state)
			this._authenticated = true
			await this.sendAuthStatusUpdate(controller)
		} catch (error) {
			console.error("Error signing in with custom token:", error)
			throw error
		}
	}

	async restoreRefreshTokenAndRetrieveAuthInfo(controller: Controller): Promise<void> {
		const provider = this.requireProvider()
		try {
			this._ocaAuthState = await provider.retrieveOcaAuthState(controller)
			if (this._ocaAuthState) {
				this._authenticated = true
				await this.sendAuthStatusUpdate(controller)
			} else {
				console.warn("No user found after restoring auth token")
				this._authenticated = false
				this._ocaAuthState = null
			}
		} catch (error) {
			console.error("Error restoring auth token:", error)
			this._authenticated = false
			this._ocaAuthState = null
		}
	}

	async subscribeToAuthStatusUpdate(
		controller: Controller,
		_request: EmptyRequest,
		responseStream: StreamingResponseHandler<OcaAuthState>,
		requestId?: string,
	): Promise<void> {
		console.log("Subscribing to authStatusUpdate")
		if (!this._ocaAuthState) {
			this._ocaAuthState = await this.requireProvider().getExistingAuthState(controller)
			this._authenticated = !!this._ocaAuthState
		}
		const entry = { controller, responseStream }
		this._activeAuthStatusUpdateSubscriptions.add(entry)
		const cleanup = () => {
			this._activeAuthStatusUpdateSubscriptions.delete(entry)
		}
		if (requestId) {
			getRequestRegistry().registerRequest(requestId, cleanup, { type: "authStatusUpdate_subscription" }, responseStream)
		}
		try {
			await this.sendAuthStatusUpdate(controller)
		} catch (error) {
			console.error("Error sending initial auth status:", error)
			this._activeAuthStatusUpdateSubscriptions.delete(entry)
		}
	}

	async sendAuthStatusUpdate(_controller: Controller): Promise<void> {
		if (this._activeAuthStatusUpdateSubscriptions.size === 0) {
			return
		}
		const postedControllers = new Set<Controller>()
		const promises = Array.from(this._activeAuthStatusUpdateSubscriptions).map(async (entry) => {
			const { controller: ctrl, responseStream } = entry
			try {
				const authInfo: OcaAuthState = this.getInfo()
				await responseStream(authInfo, false)
				if (ctrl && !postedControllers.has(ctrl)) {
					postedControllers.add(ctrl)
					await ctrl.postStateToWebview()
				}
			} catch (error) {
				console.error("Error sending authStatusUpdate event:", error)
				this._activeAuthStatusUpdateSubscriptions.delete(entry)
			}
		})
		await Promise.all(promises)
	}
}
