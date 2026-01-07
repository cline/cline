import { AuthState, UserInfo } from "@shared/proto/cline/account"
import { type EmptyRequest, String } from "@shared/proto/cline/common"
import { ClineEnv } from "@/config"
import { Controller } from "@/core/controller"
import { getRequestRegistry, type StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { setWelcomeViewCompleted } from "@/core/controller/state/setWelcomeViewCompleted"
import { HostProvider } from "@/hosts/host-provider"
import { telemetryService } from "@/services/telemetry"
import { openExternal } from "@/utils/env"
import { AuthInvalidTokenError, AuthNetworkError } from "../error/ClineError"
import { featureFlagsService } from "../feature-flags"
import { Logger } from "../logging/Logger"
import { ClineAuthProvider } from "./providers/ClineAuthProvider"
import { IAuthProvider } from "./providers/IAuthProvider"
import { LogoutReason } from "./types"

export type ServiceConfig = {
	URI?: string
	[key: string]: any
}

export interface ClineAuthInfo {
	/**
	 * accessToken
	 */
	idToken: string
	/**
	 * Short-lived refresh token
	 */
	refreshToken?: string
	/**
	 * Access token expiration time
	 * When expired, the access token needs to be refreshed using the refresh token.
	 */
	expiresAt?: number
	userInfo: ClineAccountUserInfo
	provider: string
	startedAt?: number
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
	/**
	 * WorkOS IDP ID if user logged in via SSO
	 */
	subject?: string
}

export interface ClineAccountOrganization {
	active: boolean
	memberId: string
	name: string
	organizationId: string
	roles: string[]
}

export class AuthService {
	protected static instance: AuthService | null = null
	protected _authenticated: boolean = false
	protected _clineAuthInfo: ClineAuthInfo | null = null
	protected _provider: IAuthProvider | null = null
	protected _activeAuthStatusUpdateHandlers = new Set<StreamingResponseHandler<AuthState>>()
	protected _handlerToController = new Map<StreamingResponseHandler<AuthState>, Controller>()
	protected _controller: Controller
	protected _refreshPromise: Promise<string | undefined> | null = null

	/**
	 * Creates an instance of AuthService.
	 * @param controller - Optional reference to the Controller instance.
	 */
	protected constructor(controller: Controller) {
		this._initProvider()
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

	/**
	 * Returns the current authentication token with the appropriate prefix.
	 * Refreshing it if necessary.
	 */
	async getAuthToken(): Promise<string | null> {
		if (!this._provider) {
			throw new Error("Auth provider is not set")
		}

		return this.internalGetAuthToken(this._provider)
	}

	/**
	 * Gets the active organization ID from the authenticated user's info
	 * @returns The active organization ID, or null if no active organization exists
	 */
	getActiveOrganizationId(): string | null {
		if (!this._clineAuthInfo?.userInfo?.organizations) {
			return null
		}
		const activeOrg = this._clineAuthInfo.userInfo.organizations.find((org) => org.active)
		return activeOrg?.organizationId ?? null
	}

	/**
	 * Gets all organizations from the authenticated user's info
	 * @returns Array of organizations, or undefined if not available
	 */
	getUserOrganizations(): ClineAccountOrganization[] | undefined {
		return this._clineAuthInfo?.userInfo?.organizations
	}

	private async internalGetAuthToken(provider: IAuthProvider): Promise<string | null> {
		try {
			let clineAccountAuthToken = this._clineAuthInfo?.idToken
			if (!this._clineAuthInfo || !clineAccountAuthToken || this._clineAuthInfo.provider !== provider.name) {
				// Not authenticated
				return null
			}

			// Check if token has expired
			if (await provider.shouldRefreshIdToken(clineAccountAuthToken, this._clineAuthInfo.expiresAt)) {
				// If a refresh is already in progress, wait for it to complete
				if (this._refreshPromise) {
					Logger.info("Token refresh already in progress, waiting for completion")
					const updatedToken = await this._refreshPromise
					return updatedToken ? `workos:${updatedToken}` : null
				}

				// Start a new refresh operation
				this._refreshPromise = (async () => {
					let authStatusChanged = false

					try {
						const updatedAuthInfo = await provider.retrieveClineAuthInfo(this._controller)
						if (updatedAuthInfo) {
							// retrieveClineAuthInfo may return stale data on network errors
							// Verify the token is not expired after refresh
							// This prevents 401 errors from using expired tokens
							const nowInSeconds = Date.now() / 1000
							if ((updatedAuthInfo.expiresAt ?? nowInSeconds) < nowInSeconds) {
								clineAccountAuthToken = undefined
								return undefined
							}

							this._clineAuthInfo = updatedAuthInfo
							this._authenticated = true
							clineAccountAuthToken = updatedAuthInfo.idToken
							authStatusChanged = true
						}
					} catch (error) {
						// Only log out for permanent auth failures, not network issues
						if (error instanceof AuthInvalidTokenError) {
							Logger.error("Token is invalid or expired:", error)
							this._clineAuthInfo = null
							this._authenticated = false
							telemetryService.captureAuthLoggedOut(this._provider?.name, LogoutReason.ERROR_RECOVERY)
							authStatusChanged = true
						} else if (error instanceof AuthNetworkError) {
							Logger.error("Network error refreshing token", error)
							// Keep existing auth info, will retry on next getAuthToken() call
						} else {
							throw error // Re-throw unexpected errors
						}
					} finally {
						this._refreshPromise = null
					}

					// Defer auth status update to avoid infinite loop
					if (authStatusChanged) {
						setImmediate(() => {
							this.sendAuthStatusUpdate().catch((error) => {
								Logger.error("Error sending auth status update after token refresh:", error)
							})
						})
					}

					return clineAccountAuthToken
				})()

				await this._refreshPromise
			}

			return clineAccountAuthToken ? `workos:${clineAccountAuthToken}` : null
		} catch (error) {
			Logger.error("Error getting auth token:", error)
			return null
		}
	}

	protected _initProvider(): void {
		// Only ClineAuthProvider is supported going forward
		this._provider = new ClineAuthProvider()
	}

	/**
	 * Gets the provider name for the current authentication
	 * @returns The provider name (e.g., "cline", "firebase"), or null if not authenticated
	 */
	getProviderName(): string | null {
		return this._clineAuthInfo?.provider ?? null
	}

	getInfo(): AuthState {
		// TODO: this logic should be cleaner, but this will determine the authentication state for the webview -- if a user object is returned then the webview assumes authenticated, otherwise it assumes logged out (we previously returned a UserInfo object with empty fields, and this represented a broken logged in state)
		let user: any = null
		if (this._clineAuthInfo && this._authenticated) {
			const userInfo = this._clineAuthInfo.userInfo
			this._clineAuthInfo.userInfo.appBaseUrl = ClineEnv.config()?.appBaseUrl

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

	async createAuthRequest(strict = false): Promise<String> {
		// In strict mode, we do not open a new auth window if already authenticated
		if (strict && this._authenticated) {
			this.sendAuthStatusUpdate()
			return String.create({ value: "Already authenticated" })
		}

		if (!this._provider) {
			return String.create({
				value: "Authentication provider is not configured",
			})
		}

		const callbackHost = await HostProvider.get().getCallbackUrl()
		const callbackUrl = `${callbackHost}/auth`

		const authUrl = await this._provider.getAuthRequest(callbackUrl)
		const authUrlString = authUrl.toString()

		await openExternal(authUrlString)
		telemetryService.captureAuthStarted(this._provider.name)
		return String.create({ value: authUrlString })
	}

	async handleDeauth(reason: LogoutReason = LogoutReason.UNKNOWN): Promise<void> {
		if (!this._provider) {
			throw new Error("Auth provider is not set")
		}

		try {
			telemetryService.captureAuthLoggedOut(this._provider.name, reason)
			this._clineAuthInfo = null
			this._authenticated = false
			this.destroyTokens()
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
			this._clineAuthInfo = await this._provider.signIn(this._controller, authorizationCode, provider)
			this._authenticated = this._clineAuthInfo?.idToken !== undefined

			telemetryService.captureAuthSucceeded(this._provider.name)
			await setWelcomeViewCompleted(this._controller, { value: true })
		} catch (error) {
			console.error("Error signing in with custom token:", error)
			telemetryService.captureAuthFailed(this._provider.name)
			throw error
		} finally {
			await this.sendAuthStatusUpdate()
		}
	}

	/**
	 * @deprecated Use handleDeauth() instead. Storage clearing is now handled consistently within the auth domain.
	 * Clear the authentication token from the extension's storage.
	 * This is typically called when the user logs out.
	 */
	async clearAuthToken(): Promise<void> {
		this.destroyTokens()
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
			this._clineAuthInfo = await this.retrieveAuthInfo()
			if (this._clineAuthInfo) {
				this._authenticated = true
				await this.sendAuthStatusUpdate()
			} else {
				console.warn("No user found after restoring auth token")
				this._authenticated = false
				this._clineAuthInfo = null
				telemetryService.captureAuthLoggedOut(this._provider?.name, LogoutReason.ERROR_RECOVERY)
			}
		} catch (error) {
			console.error("Error restoring auth token:", error)
			this._authenticated = false
			this._clineAuthInfo = null
			telemetryService.captureAuthLoggedOut(this._provider?.name, LogoutReason.ERROR_RECOVERY)
			return
		}
	}

	private async retrieveAuthInfo(): Promise<ClineAuthInfo | null> {
		if (!this._provider) {
			throw new Error("Auth provider is not set")
		}

		// If a refresh is already in progress, wait for it to complete
		if (this._refreshPromise) {
			Logger.info("Token refresh already in progress, waiting for completion")
			await this._refreshPromise
		}

		return this._provider.retrieveClineAuthInfo(this._controller)
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
		// Add this subscription to the active subscriptions
		this._activeAuthStatusUpdateHandlers.add(responseStream)
		this._handlerToController.set(responseStream, controller)
		// Register cleanup when the connection is closed
		const cleanup = () => {
			this._activeAuthStatusUpdateHandlers.delete(responseStream)
			this._handlerToController.delete(responseStream)
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
			this._activeAuthStatusUpdateHandlers.delete(responseStream)
			this._handlerToController.delete(responseStream)
		}
	}

	/**
	 * Send an authStatusUpdate event to all active subscribers
	 */
	async sendAuthStatusUpdate(): Promise<void> {
		// Compute once per broadcast
		const authInfo: AuthState = this.getInfo()
		const uniqueControllers = new Set<Controller>()

		// Send the event to all active subscribers
		const streamSends = Array.from(this._activeAuthStatusUpdateHandlers).map(async (responseStream) => {
			const controller = this._handlerToController.get(responseStream)
			if (controller) {
				uniqueControllers.add(controller)
			}
			try {
				await responseStream(
					authInfo,
					false, // Not the last message
				)
			} catch (error) {
				console.error("Error sending authStatusUpdate event:", error)
				// Remove the subscription if there was an error
				this._activeAuthStatusUpdateHandlers.delete(responseStream)
				this._handlerToController.delete(responseStream)
			}
		})

		await Promise.all(streamSends)
		// Identify the user in telemetry if available
		if (this._clineAuthInfo?.userInfo?.id) {
			telemetryService.identifyAccount(this._clineAuthInfo.userInfo)
			// Poll feature flags immediately for authenticated users to ensure cache is populated
			await featureFlagsService.poll(this._clineAuthInfo?.userInfo?.id)
		} else {
			// Poll feature flags for unauthenticated state
			await featureFlagsService.poll(undefined)
		}

		// Update state in webviews once per unique controller
		await Promise.all(Array.from(uniqueControllers).map((c) => c.postStateToWebview()))
	}

	private destroyTokens() {
		this._controller.stateManager.setSecret("clineAccountId", undefined)
		this._controller.stateManager.setSecret("cline:clineAccountId", undefined)
	}
}
