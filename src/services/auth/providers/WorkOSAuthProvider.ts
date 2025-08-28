import { errorService } from "@services/posthog/PostHogClientProvider"
import { WorkOS } from "@workos-inc/node"
import axios from "axios"
import { jwtDecode } from "jwt-decode"
import { clineEnvConfig } from "@/config"
import { Controller } from "@/core/controller"
import type { ClineAccountUserInfo, ClineAuthInfo } from "../AuthService"

export class WorkOSAuthProvider {
	private _config: any
	private _workos: WorkOS

	constructor(config: any) {
		this._config = config || {}
		this._workos = new WorkOS(this._config.apiKey, {
			https: true,
		})
	}

	get config(): any {
		return this._config
	}

	set config(value: any) {
		this._config = value
		this._workos = new WorkOS(this._config.apiKey, {
			https: true,
		})
	}

	async shouldRefreshIdToken(existingIdToken: string): Promise<boolean> {
		try {
			const decodedToken = jwtDecode(existingIdToken)
			const exp = decodedToken.exp || 0
			const expirationTime = exp * 1000
			const currentTime = Date.now()
			const fiveMinutesInMs = 5 * 60 * 1000
			if (currentTime > expirationTime - fiveMinutesInMs) {
				return true // id token is expired or about to be expired
			}
			return false
		} catch (error) {
			console.error("Error checking token expiration:", error)
			return true // If we can't decode the token, assume it needs refresh
		}
	}

	/**
	 * Restores the authentication token using a stored refresh token.
	 * @param controller - The controller instance for accessing stored secrets.
	 * @returns {Promise<ClineAuthInfo | null>} A promise that resolves with the authentication info or null.
	 */
	async retrieveClineAuthInfo(controller: Controller): Promise<ClineAuthInfo | null> {
		const refreshToken = controller.stateManager.getSecretKey("clineAccountId")
		if (!refreshToken) {
			console.error("No stored authentication credential found.")
			return null
		}

		try {
			// Use WorkOS to refresh the access token
			const { accessToken } = await this._workos.userManagement.authenticateWithRefreshToken({
				refreshToken,
				clientId: this._config.clientId,
			})

			// Fetch user info from Cline API using the access token
			const userResponse = await axios.get(`${clineEnvConfig.apiBaseUrl}/api/v1/users/me`, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			})

			const userInfo: ClineAccountUserInfo = userResponse.data.data

			return { idToken: accessToken, userInfo }
		} catch (error) {
			console.error("WorkOS restore token error", error)
			errorService.logMessage("WorkOS restore token error", "error")
			errorService.logException(error)
			throw error
		}
	}

	/**
	 * Signs in the user using WorkOS authentication with an authorization code.
	 * @param controller - The controller instance for storing secrets.
	 * @param code - The authorization code from WorkOS OAuth flow.
	 * @param provider - The provider name (should be 'workos').
	 * @returns {Promise<ClineAuthInfo | null>} A promise that resolves with the authentication info.
	 */
	async signIn(controller: Controller, code: string, provider: string): Promise<ClineAuthInfo | null> {
		if (provider !== "workos") {
			throw new Error(`Unsupported provider: ${provider}`)
		}

		try {
			// Exchange authorization code for tokens
			const { user, accessToken, refreshToken } = await this._workos.userManagement.authenticateWithCode({
				code,
				clientId: this._config.clientId,
			})

			// Store the refresh token in secret storage
			try {
				controller.stateManager.setSecret("clineAccountId", refreshToken)
			} catch (error) {
				errorService.logMessage("WorkOS store token error", "error")
				errorService.logException(error)
				throw error
			}

			// Map WorkOS user to ClineAccountUserInfo format
			const userInfo: ClineAccountUserInfo = {
				id: user.id,
				email: user.email,
				displayName: user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email,
				createdAt: user.createdAt,
				organizations: [], // WorkOS organizations would need to be fetched separately if needed
				appBaseUrl: clineEnvConfig?.appBaseUrl,
			}

			return { idToken: accessToken, userInfo }
		} catch (error) {
			errorService.logMessage("WorkOS sign-in error", "error")
			errorService.logException(error)
			throw error
		}
	}

	/**
	 * Generates the WorkOS authorization URL for OAuth flow.
	 * @param redirectUri - The redirect URI after authentication.
	 * @returns {string} The authorization URL.
	 */
	getAuthorizationUrl(redirectUri: string): string {
		return this._workos.userManagement.getAuthorizationUrl({
			provider: "authkit",
			clientId: this._config.clientId,
			redirectUri,
		})
	}
}
