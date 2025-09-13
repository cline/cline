import { AuthState, UserInfo } from "@shared/proto/cline/account"
import { type EmptyRequest, String } from "@shared/proto/cline/common"
import { clineEnvConfig } from "@/config"
import { Controller } from "@/core/controller"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { openExternal } from "@/utils/env"
import { featureFlagsService } from "../feature-flags"
import { ClineAuthApiTokenExchangeResponse, ClineAuthProvider } from "./providers/ClineAuthProvider"
import { FirebaseAuthProvider } from "./providers/FirebaseAuthProvider"

type AvailableAuthProviders = FirebaseAuthProvider | ClineAuthProvider

export interface ClineAuthInfo {
	idToken: string
	userInfo: ClineAccountUserInfo
	/**
	 * WorkOS IDP ID if user logged in via SSO
	 */
	subject?: string
	// accessToken: string
	expiresAt?: number
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
	protected _authenticated: boolean = false
	protected _clineAuthInfo: ClineAuthInfo | null = null
	protected _provider: AvailableAuthProviders | null = null
	protected _activeAuthStatusUpdateSubscriptions = new Set<[Controller, StreamingResponseHandler<AuthState>]>()
	protected _controller: Controller

	/**
	 * Creates an instance of AuthService.
	 * @param controller - Optional reference to the Controller instance.
	 */
	protected constructor(controller: Controller) {
		const providerName = "cline"

		this._setProvider(providerName)

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
		try {
			if (!this._clineAuthInfo) {
				console.log("No auth info available")
				return null
			}

			const now = Date.now()
			const expiresAt = this._clineAuthInfo.expiresAt

			// Check if token is expired
			if (expiresAt && expiresAt < now) {
				console.log("Token expired at:", new Date(expiresAt).toISOString())
				this._clineAuthInfo = null
				this._authenticated = false
				await this.sendAuthStatusUpdate()
				return null
			}

			// Additional check with provider if needed
			if (this._provider?.shouldRefreshIdToken) {
				const shouldRefresh = await this._provider.shouldRefreshIdToken(this._clineAuthInfo.idToken)
				if (shouldRefresh) {
					console.log("Provider indicates token needs refresh")
					this._clineAuthInfo = null
					this._authenticated = false
					await this.sendAuthStatusUpdate()
					return null
				}
			}

			return this._clineAuthInfo.idToken
		} catch (error) {
			console.error("Error getting auth token:", error)
			return null
		}
	}

	protected _setProvider(providerName: string): void {
		// Fetch AuthProviders
		// TODO:  Deliver this config from the backend securely
		// ex.  https://app.cline.bot/api/v1/auth/providers
		function findProviderConfig(name: string) {
			switch (name) {
				case "firebase":
					return new FirebaseAuthProvider(clineEnvConfig.firebase)
				default:
					return new ClineAuthProvider(clineEnvConfig)
			}
		}

		this._provider = findProviderConfig(providerName)
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

		const callbackHost = await HostProvider.get().getCallbackUri()
		const callbackUrl = `${callbackHost}/auth`

		// GET /api/v1/auth/authorize
		// Query Parameters:
		//   - client_type: "extension" (required)
		//   - callback_url: Extension callback URL (required)
		const authUrl = new URL(`${clineEnvConfig.apiBaseUrl}/api/v1/auth/authorize`)
		authUrl.searchParams.set("client_type", "extension")
		authUrl.searchParams.set("callback_url", callbackUrl)
		// Ensure the redirect_uri is properly encoded and included
		authUrl.searchParams.set("redirect_uri", callbackUrl)

		// The server will respond with a 302 redirect to the OAuth provider
		// We need to follow the redirect and get the final URL
		let response: Response
		try {
			// Set redirect: 'manual' to handle the redirect manually
			response = await fetch(authUrl.toString(), {
				method: "GET",
				redirect: "manual",
				credentials: "include", // Important for cookies if needed
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
				},
			})

			// If we get a redirect status (3xx), get the Location header
			if (response.status >= 300 && response.status < 400) {
				const redirectUrl = response.headers.get("Location")
				if (!redirectUrl) {
					throw new Error("No redirect URL found in the response")
				}

				// Open the OAuth provider's URL in the default browser
				await openExternal(redirectUrl)
				return String.create({ value: redirectUrl })
			}

			// If we didn't get a redirect, try to parse the response as JSON
			const responseData = await response.json()
			if (responseData.redirect_url) {
				await openExternal(responseData.redirect_url)
				return String.create({ value: responseData.redirect_url })
			}

			throw new Error("Unexpected response from auth server")
		} catch (error) {
			console.error("Error during authentication request:", error)
			throw new Error(`Authentication failed: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
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

	async handleAuthCallback(authorizationCode: string, provider: string): Promise<void> {
		if (!this._provider) {
			throw new Error("Auth provider is not set")
		}

		try {
			// Get the callback URL that was used during the initial auth request
			const callbackHost = await HostProvider.get().getCallbackUri()
			const callbackUrl = `${callbackHost}/auth`

			// Exchange the authorization code for tokens
			const tokenUrl = new URL(`${clineEnvConfig.apiBaseUrl}/api/v1/auth/token`)

			const response = await fetch(tokenUrl.toString(), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
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
			console.log("Token data received:", responseJSON)

			const responseType: ClineAuthApiTokenExchangeResponse = responseJSON
			const tokenData = responseType.data

			if (!tokenData.access_token || !tokenData.user_info) {
				throw new Error("Invalid token response from server")
			}

			// Convert expires_at to milliseconds if it's in seconds
			const expiresAt = tokenData.expires_at
				? tokenData.expires_at > 1e12
					? tokenData.expires_at
					: tokenData.expires_at * 1000
				: Date.now() + 3600000 // Default to 1 hour from now

			// Store the tokens and user info
			this._clineAuthInfo = {
				idToken: tokenData.access_token,
				userInfo: {
					id: tokenData.user_info.Subject || tokenData.user_info.ClineUserID || "",
					email: tokenData.user_info.Email || "",
					displayName: tokenData.user_info.Name || "",
					createdAt: new Date().toISOString(),
					organizations: [],
				},
				expiresAt: expiresAt,
			}

			this._authenticated = true

			// Notify all subscribers about the auth state change
			await this.sendAuthStatusUpdate()

			// Store the auth info in the extension's secure storage
			if (tokenData.access_token) {
				const authInfo: ClineAuthInfo = {
					idToken: tokenData.access_token,
					userInfo: {
						email: tokenData.user_info.Email || "",
						displayName: tokenData.user_info.Name || "",
						id: tokenData.user_info.ClineUserID || tokenData.user_info.Subject || "",
						createdAt: new Date().toISOString(),
						organizations: [],
					},
					expiresAt: tokenData.expires_at
						? tokenData.expires_at > 1e12
							? tokenData.expires_at
							: tokenData.expires_at * 1000
						: Date.now() + 3600000, // Default to 1 hour from now
				}
				this._controller.stateManager.setSecret("clineAccountId", JSON.stringify(authInfo))
			}
		} catch (error) {
			console.error("Error handling auth callback:", error)
			// this._authenticated = false
			// this._clineAuthInfo = null
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
	 * Restores the authentication data from the extension's storage.
	 * This is typically called when the extension is activated.
	 */
	async restoreRefreshTokenAndRetrieveAuthInfo(): Promise<void> {
		if (!this._provider) {
			throw new Error("Auth provider is not set")
		}

		try {
			this._clineAuthInfo = await this._provider.retrieveClineAuthInfo(this._controller)
			if (this._clineAuthInfo) {
				this._authenticated = true
				await this.sendAuthStatusUpdate()
			} else {
				console.warn("No valid authentication data found or token expired")
				this._authenticated = false
				this._clineAuthInfo = null
			}
		} catch (error) {
			console.error("Error restoring authentication data:", error)
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
					await featureFlagsService.cacheFeatureFlags()
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
