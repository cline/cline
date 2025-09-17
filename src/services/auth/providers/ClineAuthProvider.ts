import { EnvironmentConfig } from "@/config"
import { Controller } from "@/core/controller"
import { Logger } from "@/services/logging/Logger"
import { CLINE_API_ENDPOINT } from "@/shared/cline/api"
import type { ClineAuthInfo } from "../AuthService"

interface ClineAuthApiUser {
	subject: string | null
	email: string
	name: string
	clineUserId: string | null
	accounts: string[] | null
}

// Unified API response data shape for token exchange/refresh
interface ClineAuthResponseData {
	/**
	 * Auth token to be used for authenticated requests
	 */
	accessToken: string
	/**
	 * Refresh token to be used for refreshing the access token
	 */
	refreshToken?: string
	/**
	 * Token type
	 * E.g. "Bearer"
	 */
	tokenType: string
	/**
	 * Access token expiration time in ISO 8601 format
	 * E.g. "2025-09-17T04:32:24.842636548Z"
	 */
	expiresAt: string
	/**
	 * User information associated with the token
	 */
	userInfo: ClineAuthApiUser
}

export interface ClineAuthApiTokenExchangeResponse {
	success: boolean
	data: ClineAuthResponseData
}

export interface ClineAuthApiTokenRefreshResponse {
	success: boolean
	data: ClineAuthResponseData
}

export class ClineAuthProvider {
	readonly name = "cline"
	private _config

	constructor(config: EnvironmentConfig) {
		this._config = config
	}

	get config(): any {
		return this._config
	}

	set config(value: any) {
		this._config = value
	}

	/**
	 * Checks if the access token needs to be refreshed (expired or about to expire).
	 * Since the new flow doesn't support refresh tokens, this will return true if token is expired.
	 * @param existingAccessToken - The existing access token to check.
	 * @returns {Promise<boolean>} True if the token is expired or about to expire.
	 */
	async shouldRefreshIdToken(_refreshToken: string, expiresAt?: number): Promise<boolean> {
		try {
			// expiresAt is in seconds
			const expirationTime = expiresAt || 0
			const currentTime = Date.now() / 1000
			const next5Min = currentTime + 5 * 60

			// Check if token is expired or will expire in the next 5 minutes
			return expirationTime < next5Min // Access token is expired or about to expire
		} catch (error) {
			Logger.error("Error checking token expiration:", error)
			return true // If we can't decode the token, assume it needs refresh
		}
	}

	/**
	 * Retrieves Cline auth info using the stored access token.
	 * @param controller - The controller instance to access stored secrets.
	 * @returns {Promise<ClineAuthInfo | null>} A promise that resolves with the auth info or null.
	 */
	async retrieveClineAuthInfo(controller: Controller): Promise<ClineAuthInfo | null> {
		try {
			// Get the stored auth data from secure storage
			const storedAuthDataString = controller.stateManager.getSecretKey("clineAccountId")

			if (!storedAuthDataString) {
				Logger.debug("No stored authentication data found")
				return null
			}

			// Parse the stored auth data
			let storedAuthData: ClineAuthInfo
			try {
				storedAuthData = JSON.parse(storedAuthDataString)
			} catch (e) {
				console.error("Failed to parse stored auth data:", e)
				controller.stateManager.setSecret("clineAccountId", undefined)
				return null
			}

			if (!storedAuthData.refreshToken || !storedAuthData?.idToken) {
				console.error("No valid token found in stored authentication data")
				controller.stateManager.setSecret("clineAccountId", undefined)
				return null
			}

			if (await this.shouldRefreshIdToken(storedAuthData.refreshToken, storedAuthData.expiresAt)) {
				// Try to refresh the token using the refresh token
				const authInfo = await this.refreshToken(storedAuthData.refreshToken)
				return authInfo || null
			}

			// Is the token valid?
			if (storedAuthData.idToken && storedAuthData.refreshToken && storedAuthData.userInfo.id) {
				return storedAuthData
			}

			// Verify the token structure
			const tokenParts = storedAuthData.idToken.split(".")
			if (tokenParts.length !== 3) {
				throw new Error("Invalid token format")
			}

			// Decode the token to verify it's a valid JWT
			const payload = JSON.parse(Buffer.from(tokenParts[1], "base64").toString("utf-8"))
			if (payload.external_id) {
				storedAuthData.userInfo.id = payload.external_id
			}

			console.log("Successfully retrieved and validated stored auth token")
			return storedAuthData
		} catch (error) {
			console.error("Error retrieving stored authentication credential:", error)
			return null
		}
	}

	/**
	 * Refreshes an access token using a refresh token.
	 * @param refreshToken - The refresh token.
	 * @returns {Promise<ClineAuthInfo>} The new access token and user info.
	 */
	private async refreshToken(refreshToken: string): Promise<ClineAuthInfo> {
		try {
			// Get the callback URL that was used during the initial auth request
			const endpoint = new URL(CLINE_API_ENDPOINT.REFRESH_TOKEN, this._config.apiBaseUrl)
			const response = await fetch(endpoint.toString(), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					refreshToken, // short_lived_auth_code
					grantType: "refresh_token", // must be "authorization_code"
				}),
			})

			if (!response.ok) {
				if (response.status === 400) {
					const errorData = await response.json().catch(() => ({}))
					const errorMessage = errorData?.error || "Invalid or expired authorization code"
					throw new Error(errorMessage)
				}
				throw new Error(`HTTP error! status: ${response.status}`)
			}

			const data: ClineAuthApiTokenExchangeResponse = await response.json()

			if (!data.success || !data.data.refreshToken || !data.data.accessToken) {
				throw new Error("Failed to exchange authorization code for access token")
			}

			return {
				idToken: data.data.accessToken,
				// data.data.expiresAt example: "2025-09-17T03:43:57Z"; store in seconds
				expiresAt: new Date(data.data.expiresAt).getTime() / 1000,
				refreshToken: data.data.refreshToken || refreshToken,
				userInfo: {
					createdAt: new Date().toISOString(),
					email: data.data.userInfo.email || "",
					id: data.data.userInfo.clineUserId || "",
					displayName: data.data.userInfo.name || "",
					organizations: [],
					appBaseUrl: this._config.appBaseUrl,
					subject: data.data.userInfo.subject || "",
				},
			}
		} catch (error: any) {
			throw error
		}
	}
}
