import vscode from "vscode"
import crypto from "crypto"
import { EmptyRequest, String } from "../../shared/proto/common"
import { AuthState } from "../../shared/proto/account"
import { StreamingResponseHandler, getRequestRegistry } from "@/core/controller/grpc-handler"
import { FirebaseAuthProvider } from "./providers/FirebaseAuthProvider"
import { Controller } from "@/core/controller"
import { storeSecret } from "@/core/storage/state"

const DefaultClineAccountURI = "https://app.cline.bot/auth"
// const DefaultClineAccountURI = "https://staging-app.cline.bot/auth"
// const DefaultClineAccountURI = "http://localhost:3000/auth"
let authProviders: any[] = []

type ServiceConfig = {
	URI?: string
	[key: string]: any
}

const availableAuthProviders = {
	firebase: FirebaseAuthProvider,
	// Add other providers here as needed
}

// TODO: Add logic to handle multiple webviews getting auth updates.

export class AuthService {
	private static instance: AuthService | null = null
	private _config: ServiceConfig
	private _authenticated: boolean = false
	private _user: any = null
	private _provider: any = null
	private readonly _authNonce = crypto.randomBytes(32).toString("hex")
	private _activeAuthStatusUpdateSubscriptions = new Set<[Controller, StreamingResponseHandler]>()
	private _context: vscode.ExtensionContext
	private _refreshTimer: NodeJS.Timeout | null = null

	/**
	 * Creates an instance of AuthService.
	 * @param config - Configuration for the service, including the URI for authentication.
	 * @param authProvider - Optional authentication provider to use.
	 * @param controller - Optional reference to the Controller instance.
	 */
	private constructor(context: vscode.ExtensionContext, config: ServiceConfig, authProvider?: any) {
		const providerName = authProvider || "firebase"
		this._config = Object.assign({ URI: DefaultClineAccountURI }, config)

		// Fetch AuthProviders
		// TODO:  Deliver this config from the backend securely
		// ex.  https://app.cline.bot/api/v1/auth/providers

		const authProvidersConfigs = [
			{
				name: "firebase",
				config: {
					apiKey: "AIzaSyC5rx59Xt8UgwdU3PCfzUF7vCwmp9-K2vk",
					authDomain: "cline-prod.firebaseapp.com",
					projectId: "cline-prod",
					storageBucket: "cline-prod.firebasestorage.app",
					messagingSenderId: "941048379330",
					appId: "1:941048379330:web:45058eedeefc5cdfcc485b",
				},
				// Uncomment for staging environment
				// config: {
				// 	apiKey: "AIzaSyASSwkwX1kSO8vddjZkE5N19QU9cVQ0CIk",
				// 	authDomain: "cline-staging.firebaseapp.com",
				// 	projectId: "cline-staging",
				// 	storageBucket: "cline-staging.firebasestorage.app",
				// 	messagingSenderId: "853479478430",
				// 	appId: "1:853479478430:web:2de0dba1c63c3262d4578f",
				// },
				// Uncomment for local development environment
				// config: {
				// 	apiKey: "AIzaSyASSwkwX1kSO8vddjZkE5N19QU9cVQ0CIk",
				// 	authDomain: "cline-staging.firebaseapp.com",
				// 	projectId: "cline-staging",
				// 	storageBucket: "cline-staging.firebasestorage.app",
				// 	messagingSenderId: "853479478430",
				// 	appId: "1:853479478430:web:2de0dba1c63c3262d4578f",
				// },
				// config: {
				// 	apiKey: "AIzaSyD8wtkd1I-EICuAg6xgAQpRdwYTvwxZG2w",
				// 	authDomain: "cline-preview.firebaseapp.com",
				// 	projectId: "cline-preview",
				// }
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
		this._context = context
	}

	/**
	 * Gets the singleton instance of AuthService.
	 * @param config - Configuration for the service, including the URI for authentication.
	 * @param authProvider - Optional authentication provider to use.
	 * @param controller - Optional reference to the Controller instance.
	 * @returns The singleton instance of AuthService.
	 */
	public static getInstance(context?: vscode.ExtensionContext, config?: ServiceConfig, authProvider?: any): AuthService {
		if (!AuthService.instance) {
			if (!context) {
				console.warn("Extension context was not provided to AuthService.getInstance, using default context")
				context = {} as vscode.ExtensionContext
			}
			AuthService.instance = new AuthService(context, config || {}, authProvider)
		}
		if (context) {
			AuthService.instance.context = context
		}
		return AuthService.instance
	}

	set context(context: vscode.ExtensionContext) {
		this._context = context
	}

	get authProvider(): any {
		return this._provider
	}

	set authProvider(providerName: string) {
		this._setProvider(providerName)
	}

	get authNonce(): string {
		return this._authNonce
	}

	async getAuthToken(): Promise<string | null> {
		if (!this._user) {
			return null
		}

		// TODO: This may need to be dependant on the auth provider
		// Return the ID token from the user object
		return this._provider.provider.getAuthToken(this._user)
	}

	private _setProvider(providerName: string): void {
		const providerConfig = authProviders.find((provider) => provider.name === providerName)
		if (!providerConfig) {
			throw new Error(`Auth provider "${providerName}" not found`)
		}

		this._provider = providerConfig
	}

	getInfo(): AuthState {
		let user = null
		if (this._user && this._authenticated) {
			user = this._provider.provider.convertUserData(this._user)
		}

		return AuthState.create({
			user: user,
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

		const callbackUrl = `${vscode.env.uriScheme || "vscode"}://saoudrizwan.claude-dev/auth`

		// Use URL object for more graceful query construction
		const authUrl = new URL(this._config.URI)
		authUrl.searchParams.set("state", this._authNonce)
		authUrl.searchParams.set("callback_url", callbackUrl)

		const authUrlString = authUrl.toString()

		await vscode.env.openExternal(vscode.Uri.parse(authUrlString))
		return String.create({ value: authUrlString })
	}

	async handleDeauth(): Promise<void> {
		if (!this._provider) {
			throw new Error("Auth provider is not set")
		}

		try {
			// Clear any active refresh timer
			if (this._refreshTimer) {
				clearTimeout(this._refreshTimer)
				this._refreshTimer = null
			}

			await this._provider.provider.signOut()
			this._user = null
			this._authenticated = false
			this.sendAuthStatusUpdate()
		} catch (error) {
			console.error("Error signing out:", error)
			throw error
		}
	}

	/**
	 * Dispose of the AuthService and clean up resources
	 */
	dispose(): void {
		if (this._refreshTimer) {
			clearTimeout(this._refreshTimer)
			this._refreshTimer = null
		}
		this._activeAuthStatusUpdateSubscriptions.clear()
	}

	async handleAuthCallback(token: string, provider: string): Promise<void> {
		if (!this._provider) {
			throw new Error("Auth provider is not set")
		}

		try {
			this._user = await this._provider.provider.signIn(this._context, token, provider)
			this._authenticated = true

			await this.sendAuthStatusUpdate()
			this.setupAutoRefreshAuth()
			return this._user
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
		await storeSecret(this._context, "clineAccountId", undefined)
	}

	/**
	 * Restores the authentication token from the extension's storage.
	 * This is typically called when the extension is activated.
	 */
	async restoreAuthToken(): Promise<void> {
		if (!this._provider || !this._provider.provider) {
			throw new Error("Auth provider is not set")
		}

		try {
			this._user = await this._provider.provider.restoreAuthCredential(this._context)
			if (this._user) {
				this._authenticated = true
				await this.sendAuthStatusUpdate()
				this.setupAutoRefreshAuth()
				// Setup auto-refresh for the auth token
			} else {
				console.warn("No user found after restoring auth token")
				this._authenticated = false
				this._user = null
			}
		} catch (error) {
			console.error("Error restoring auth token:", error)
			this._authenticated = false
			this._user = null
			return
		}
	}

	/**
	 * Refreshes the authentication status and sends an update to all subscribers.
	 */
	async refreshAuth(): Promise<void> {
		if (!this._user) {
			console.warn("No user is authenticated, skipping auth refresh")
			return
		}

		try {
			await this._provider.provider.refreshAuthToken()
			this.sendAuthStatusUpdate()
		} catch (error) {
			console.error("Token refresh failed:", error)
			throw error // Let caller handle the error
		}
	}

	private setupAutoRefreshAuth(): void {
		// Clear any existing timer first
		if (this._refreshTimer) {
			clearTimeout(this._refreshTimer)
			this._refreshTimer = null
		}

		// Validate user and token manager
		if (!this._user?.stsTokenManager?.expirationTime) {
			console.warn("No valid expiration time found, skipping auto-refresh setup")
			return
		}

		const expirationTime = this._user.stsTokenManager.expirationTime
		const now = Date.now()
		const timeUntilExpiry = expirationTime - now

		// Set refresh time to 10 minutes before expiry (increased buffer from 5 minutes)
		// But ensure minimum of 1 minute delay
		const refreshTime = Math.max(timeUntilExpiry - 10 * 60 * 1000, 60000)

		// Only set timer if refresh time is reasonable (between 1 minute and 2 hours)
		if (refreshTime > 0 && refreshTime < 2 * 60 * 60 * 1000) {
			this._refreshTimer = setTimeout(() => this._autoRefreshAuth(), refreshTime)
			console.log(`Auth refresh scheduled in ${Math.round(refreshTime / 60000)} minutes`)
		} else {
			console.warn(`Invalid refresh time: ${Math.round(refreshTime / 60000)} minutes, skipping auto-refresh setup`)
		}
	}

	private async _autoRefreshAuth(): Promise<void> {
		if (!this._user) {
			console.warn("No user is authenticated, skipping auth refresh")
			return
		}

		let retries = 3
		let lastError: Error | null = null

		while (retries > 0) {
			try {
				await this.refreshAuth()
				console.log("Auth token refreshed successfully")
				// Only reschedule if refresh was successful
				this.setupAutoRefreshAuth()
				return
			} catch (error) {
				lastError = error as Error
				retries--
				console.warn(`Auth refresh attempt failed (${3 - retries}/3): ${lastError.message}`)

				if (retries > 0) {
					// Wait 5 seconds before retrying
					await new Promise((resolve) => setTimeout(resolve, 5000))
				}
			}
		}

		// All retries failed
		console.error(`Auth refresh failed after 3 attempts. Last error: ${lastError?.message}`)
		// Don't reschedule on complete failure - user will need to re-authenticate
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
		request: EmptyRequest,
		responseStream: StreamingResponseHandler,
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
