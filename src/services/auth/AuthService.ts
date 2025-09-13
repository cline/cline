import { featureFlagsService, telemetryService } from "@services/posthog/PostHogClientProvider"
import { AuthState, UserInfo } from "@shared/proto/cline/account"
import { type EmptyRequest, String } from "@shared/proto/cline/common"
import { clineEnvConfig } from "@/config"
import { Controller } from "@/core/controller"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { HostProvider } from "@/hosts/host-provider"
import { FEATURE_FLAGS } from "@/shared/services/feature-flags/feature-flags"
import { openExternal } from "@/utils/env"
import { FirebaseAuthProvider } from "./providers/FirebaseAuthProvider"

const DefaultClineAccountURI = `${clineEnvConfig.appBaseUrl}/auth`
let authProviders: any[] = []

export type ServiceConfig = {
	URI?: string
	[key: string]: any
}

const availableAuthProviders = {
	firebase: FirebaseAuthProvider,
	// Add other providers here as needed
}

export interface ClineAuthInfo {
	idToken: string
	userInfo: ClineAccountUserInfo
}

export interface ClineAccountUserInfo {
	createdAt: string
	displayName: string
	email: string
	id: string
	organizations: ClineAccountOrganization[]
	/**
	 * Cline app base URL, used for webview UI and other client-side operations
	 */
	appBaseUrl?: string
}

export interface ClineAccountOrganization {
	active: boolean
	memberId: string
	name: string
	organizationId: string
	roles: string[]
}

// TODO: Add logic to handle multiple webviews getting auth updates.

export class AuthService {
	protected static instance: AuthService | null = null
	protected _config: ServiceConfig
	protected _authenticated: boolean = false
	protected _clineAuthInfo: ClineAuthInfo | null = null
	protected _provider: { provider: FirebaseAuthProvider } | null = null
	protected _activeAuthStatusUpdateSubscriptions = new Set<[Controller, StreamingResponseHandler<AuthState>]>()
	protected _controller: Controller

	/**
	 * Creates an instance of AuthService.
	 * @param controller - Optional reference to the Controller instance.
	 */
	protected constructor(controller: Controller) {
		const providerName = "firebase"
		this._config = { URI: DefaultClineAccountURI }

		// Fetch AuthProviders
		// TODO:  Deliver this config from the backend securely
		// ex.  https://app.cline.bot/api/v1/auth/providers

		const authProvidersConfigs = [
			{
				name: "firebase",
				config: clineEnvConfig.firebase,
			},
		]

		// Merge authProviders with availableAuthProviders
		authProviders = authProvidersConfigs.map((provider) => {
			const providerName = provider.name
			const ProviderClass = availableAuthProviders[providerName as keyof typeof availableAuthProviders]
			if (!ProviderClass) {
				throw new Error(`Auth provider "${providerName}" is not available`)
			}
			return {
				name: providerName,
				config: provider.config,
				provider: new ProviderClass(provider.config),
			}
		})

		this._setProvider(authProviders.find((authProvider) => authProvider.name === providerName).name)

		this._controller = controller
	}

	/**
	 * Gets the singleton instance of AuthService.
	 * @param controller - Optional reference to the Controller instance.
	 * @returns The singleton instance of AuthService.
	 */
	public static getInstance(controller?: Controller): AuthService {
		if (!AuthService.instance) {
			if (!controller) {
				console.warn("Extension context was not provided to AuthService.getInstance, using default context")
				controller = {} as Controller
			}
			if (process.env.E2E_TEST) {
				// Use require instead of import to avoid circular dependency issues
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const { AuthServiceMock } = require("./AuthServiceMock")
				AuthService.instance = AuthServiceMock.getInstance(controller)
			} else {
				AuthService.instance = new AuthService(controller)
			}
		}
		if (controller !== undefined && AuthService.instance) {
			AuthService.instance.controller = controller
		}
		return AuthService.instance!
	}

	set controller(controller: Controller) {
		this._controller = controller
	}

	get authProvider(): any {
		return this._provider
	}

	set authProvider(providerName: string) {
		this._setProvider(providerName)
	}

	async getAuthToken(): Promise<string | null> {
		if (!this._clineAuthInfo) {
			return null
		}
		const idToken = this._clineAuthInfo.idToken
		const shouldRefreshIdToken = await this._provider?.provider.shouldRefreshIdToken(idToken)
		if (shouldRefreshIdToken) {
			// Retrieves the stored id token and refreshes it, then updates this._clineAuthInfo
			await this.restoreRefreshTokenAndRetrieveAuthInfo()
			if (!this._clineAuthInfo) {
				return null
			}
		}
		return this._clineAuthInfo.idToken
	}

	protected _setProvider(providerName: string): void {
		const providerConfig = authProviders.find((provider) => provider.name === providerName)
		if (!providerConfig) {
			throw new Error(`Auth provider "${providerName}" not found`)
		}

		this._provider = providerConfig
	}

	getInfo(): AuthState {
		// TODO: this logic should be cleaner, but this will determine the authentication state for the webview -- if a user object is returned then the webview assumes authenticated, otherwise it assumes logged out (we previously returned a UserInfo object with empty fields, and this represented a broken logged in state)
		let user: any = null
		if (this._clineAuthInfo && this._authenticated) {
			const userInfo = this._clineAuthInfo.userInfo
			this._clineAuthInfo.userInfo.appBaseUrl = clineEnvConfig?.appBaseUrl

			user = UserInfo.create({
				// TODO: create proto for new user info type
				uid: userInfo?.id,
				displayName: userInfo?.displayName,
				email: userInfo?.email,
				photoUrl: undefined,
				appBaseUrl: userInfo?.appBaseUrl,
			})
		}

		return AuthState.create({
			user,
		})
	}

	async createAuthRequest(): Promise<String> {
		if (this._authenticated) {
			this.sendAuthStatusUpdate()
			return String.create({ value: "Already authenticated" })
		}

		if (!this._config.URI) {
			throw new Error("Authentication URI is not configured")
		}

		const callbackHost = await HostProvider.get().getCallbackUri()
		const callbackUrl = `${callbackHost}/auth`

		// Use URL object for more graceful query construction
		const authUrl = new URL(this._config.URI)
		authUrl.searchParams.set("callback_url", callbackUrl)

		const authUrlString = authUrl.toString()

		await openExternal(authUrlString)
		return String.create({ value: authUrlString })
	}

	async handleDeauth(): Promise<void> {
		if (!this._provider) {
			throw new Error("Auth provider is not set")
		}

		try {
			this._clineAuthInfo = null
			this._authenticated = false
			this.sendAuthStatusUpdate()
		} catch (error) {
			console.error("Error signing out:", error)
			throw error
		}
	}

	async handleAuthCallback(token: string, provider: string): Promise<void> {
		if (!this._provider) {
			throw new Error("Auth provider is not set")
		}

		try {
			this._clineAuthInfo = await this._provider.provider.signIn(this._controller, token, provider)
			this._authenticated = true

			await this.sendAuthStatusUpdate()
		} catch (error) {
			console.error("Error signing in with custom token:", error)
			throw error
		}
	}

	/**
	 * Clear the authentication token from the extension's storage.
	 * This is typically called when the user logs out.
	 */
	async clearAuthToken(): Promise<void> {
		this._controller.stateManager.setSecret("clineAccountId", undefined)
	}

	/**
	 * Restores the authentication token from the extension's storage.
	 * This is typically called when the extension is activated.
	 */
	async restoreRefreshTokenAndRetrieveAuthInfo(): Promise<void> {
		if (!this._provider || !this._provider.provider) {
			throw new Error("Auth provider is not set")
		}

		try {
			this._clineAuthInfo = await this._provider.provider.retrieveClineAuthInfo(this._controller)
			if (this._clineAuthInfo) {
				this._authenticated = true
				await this.sendAuthStatusUpdate()
			} else {
				console.warn("No user found after restoring auth token")
				this._authenticated = false
				this._clineAuthInfo = null
			}
		} catch (error) {
			console.error("Error restoring auth token:", error)
			this._authenticated = false
			this._clineAuthInfo = null
			return
		}
	}

	/**
	 * Subscribe to authStatusUpdate events
	 * @param controller The controller instance
	 * @param request The empty request
	 * @param responseStream The streaming response handler
	 * @param requestId The ID of the request (passed by the gRPC handler)
	 */
	async subscribeToAuthStatusUpdate(
		controller: Controller,
		_request: EmptyRequest,
		responseStream: StreamingResponseHandler<AuthState>,
		requestId?: string,
	): Promise<void> {
		console.log("Subscribing to authStatusUpdate")

		// Add this subscription to the active subscriptions
		this._activeAuthStatusUpdateSubscriptions.add([controller, responseStream])
		// Register cleanup when the connection is closed
		const cleanup = () => {
			this._activeAuthStatusUpdateSubscriptions.delete([controller, responseStream])
		}
		// Register the cleanup function with the request registry if we have a requestId
		if (requestId) {
			getRequestRegistry().registerRequest(requestId, cleanup, { type: "authStatusUpdate_subscription" }, responseStream)
		}

		// Send the current authentication status immediately
		try {
			await this.sendAuthStatusUpdate()
		} catch (error) {
			console.error("Error sending initial auth status:", error)
			// Remove the subscription if there was an error
			this._activeAuthStatusUpdateSubscriptions.delete([controller, responseStream])
		}
	}

	/**
	 * Send an authStatusUpdate event to all active subscribers
	 */
	async sendAuthStatusUpdate(): Promise<void> {
		// Send the event to all active subscribers
		const promises = Array.from(this._activeAuthStatusUpdateSubscriptions).map(async ([controller, responseStream]) => {
			try {
				const authInfo: AuthState = this.getInfo()

				await responseStream(
					authInfo,
					false, // Not the last message
				)

				// Identify the user in telemetry if available
				// Fetch the feature flags for the user
				if (this._clineAuthInfo?.userInfo?.id) {
					telemetryService.identifyAccount(this._clineAuthInfo.userInfo)
					for (const flag of Object.values(FEATURE_FLAGS)) {
						await featureFlagsService?.isFeatureFlagEnabled(flag)
					}
				}

				// Update the state in the webview
				if (controller) {
					await controller.postStateToWebview()
				}
			} catch (error) {
				console.error("Error sending authStatusUpdate event:", error)
				// Remove the subscription if there was an error
				this._activeAuthStatusUpdateSubscriptions.delete([controller, responseStream])
			}
		})

		await Promise.all(promises)
	}
}
