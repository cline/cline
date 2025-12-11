import { String } from "@shared/proto/cline/common"
import { ClineEnv } from "@/config"
import { Controller } from "@/core/controller"
import { setWelcomeViewCompleted } from "@/core/controller/state/setWelcomeViewCompleted"
import { WebviewProvider } from "@/core/webview"
import { CLINE_API_ENDPOINT } from "@/shared/cline/api"
import { fetch } from "@/shared/net"
import { AuthService } from "./AuthService"

// TODO: Consider adding a mock auth provider implementing IAuthProvider for more realistic testing
export class AuthServiceMock extends AuthService {
	protected constructor(controller: Controller) {
		super(controller)

		if (process?.env?.CLINE_ENVIRONMENT !== "local") {
			throw new Error("AuthServiceMock should only be used in local environment for testing purposes.")
		}

		this._initProvider()
		this._controller = controller
	}

	/**
	 * Gets the singleton instance of AuthServiceMock.
	 */
	public static override getInstance(controller?: Controller): AuthServiceMock {
		if (!AuthServiceMock.instance) {
			if (!controller) {
				console.error("Extension controller was not provided to AuthServiceMock.getInstance")
				throw new Error("Extension controller was not provided to AuthServiceMock.getInstance")
			}
			AuthServiceMock.instance = new AuthServiceMock(controller)
		}
		if (controller !== undefined) {
			AuthServiceMock.instance.controller = controller
		}
		return AuthServiceMock.instance
	}

	override async getAuthToken(): Promise<string | null> {
		if (!this.authState.authInfo) {
			return null
		}
		return this.authState.authInfo.idToken
	}

	override async createAuthRequest(): Promise<String> {
		// Use URL object for more graceful query construction
		const authUrl = new URL(ClineEnv.config().apiBaseUrl)
		const authUrlString = authUrl.toString()
		// Call the parent implementation
		if (this.authState.authenticated && this.authState.authInfo) {
			console.log("Already authenticated with mock server")
			return String.create({ value: authUrlString })
		}

		this.authState.pending = false

		try {
			// Use token exchange endpoint like ClineAuthProvider
			const tokenExchangeUri = new URL(CLINE_API_ENDPOINT.TOKEN_EXCHANGE, ClineEnv.config().apiBaseUrl)
			const tokenType = "personal"
			const testCode = `test-${tokenType}-token`

			const response = await fetch(tokenExchangeUri, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					code: testCode,
					grantType: "authorization_code",
				}),
			})

			if (!response.ok) {
				throw new Error(`Mock server authentication failed: ${response.status} ${response.statusText}`)
			}

			const responseData = await response.json()

			if (!responseData.success || !responseData.data) {
				throw new Error("Invalid response from mock server")
			}

			const authData = responseData.data

			// Convert to ClineAuthInfo format matching ClineAuthProvider
			this.authState.authInfo = {
				idToken: authData.accessToken,
				refreshToken: authData.refreshToken,
				expiresAt: new Date(authData.expiresAt).getTime() / 1000,
				userInfo: {
					id: authData.userInfo.clineUserId || authData.userInfo.subject,
					email: authData.userInfo.email,
					displayName: authData.userInfo.name,
					createdAt: new Date().toISOString(),
					organizations: authData.organizations,
					appBaseUrl: ClineEnv.config().appBaseUrl,
					subject: authData.userInfo.subject,
				},
				provider: this.provider?.name || "mock",
			}
			this.authState.pending = false

			console.log(`Successfully authenticated with mock server as ${authData.userInfo.name} (${authData.userInfo.email})`)

			const visibleWebview = WebviewProvider.getVisibleInstance()

			// Use appropriate provider name for callback
			const providerName = this.provider?.name || "mock"
			// Simulate handling the auth callback as if from a real provider
			await visibleWebview?.controller.handleAuthCallback(authData.accessToken, providerName)
		} catch (error) {
			console.error("Error signing in with mock server:", error)
			this.authState.authenticated = false
			this.authState.authInfo = undefined
			throw error
		}

		return String.create({ value: authUrlString })
	}

	override async handleAuthCallback(_token: string, _provider: string): Promise<void> {
		try {
			this.authState.authenticated = true
			this.authState.pending = false
			await setWelcomeViewCompleted(this._controller, { value: true })
			await this.sendAuthStatusUpdate()
		} catch (error) {
			console.error("Error signing in with custom token:", error)
			throw error
		}
	}

	override async restoreRefreshTokenAndRetrieveAuthInfo(): Promise<void> {
		try {
			this.authState.pending = false

			if (this.authState.authInfo) {
				this.authState.authenticated = true
				await this.sendAuthStatusUpdate()
			} else {
				console.warn("No user found after restoring auth token")
				this.authState.authenticated = false
				this.authState.authInfo = undefined
			}
		} catch (error) {
			console.error("Error restoring auth token:", error)
			this.authState.authenticated = false
			this.authState.authInfo = undefined
			return
		}
	}
}
