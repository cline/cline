import { EnvironmentConfig } from "@/config"
import { Controller } from "@/core/controller"
import { Logger } from "@/services/logging/Logger"
import { CLINE_API_ENDPOINT } from "@/shared/cline/api"
import type { ClineAccountUserInfo, ClineAuthInfo } from "../AuthService"

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
			if (expirationTime < next5Min) {
				return true // Access token is expired or about to expire
			}
			return false
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

			// Check if token is expired
			const now = Date.now()
			// Stored auth data expiresAt example: 1758083043.166
			if (await this.shouldRefreshIdToken(storedAuthData.refreshToken, storedAuthData.expiresAt)) {
				console.log(`Token expired at ${new Date(storedAuthData.expiresAt || 0).toISOString()}`)
				// Try to refresh the token using the refresh token
				const authInfo = await this.exchangeCodeForToken(storedAuthData.refreshToken)
				if (authInfo) {
					controller.stateManager.setSecret("clineAccountId", JSON.stringify(authInfo))
					return authInfo
				}
				return null
			}

			if (storedAuthData.idToken && storedAuthData.refreshToken && storedAuthData.userInfo.id) {
				controller.stateManager.setSecret("clineAccountId", JSON.stringify(storedAuthData))
				return storedAuthData
			}

			// Verify the token structure
			try {
				const tokenParts = storedAuthData.idToken.split(".")
				if (tokenParts.length !== 3) {
					throw new Error("Invalid token format")
				}

				// Decode the token to verify it's a valid JWT
				const payload = JSON.parse(Buffer.from(tokenParts[1], "base64").toString("utf-8"))

				// Check if token has expired
				if (payload.exp && payload.exp * 1000 < now) {
					console.log("Token has expired according to JWT payload")
					controller.stateManager.setSecret("clineAccountId", undefined)
					return null
				}
				if (payload.external_id) {
					storedAuthData.userInfo.id = payload.external_id
				}
			} catch (e) {
				console.error("Invalid token format or content:", e)
				controller.stateManager.setSecret("clineAccountId", undefined)
				return null
			}

			console.log("Successfully retrieved and validated stored auth token")
			return storedAuthData
		} catch (error) {
			console.error("Error retrieving stored authentication credential:", error)
			// Clear invalid stored data
			try {
				controller.stateManager.setSecret("clineAccountId", undefined)
			} catch (e) {
				console.error("Failed to clear invalid auth data:", e)
			}
			return null
		}
	}

	/**
	 * Exchanges an authorization code for an access token and user info.
	 * @param authorizationCode - The authorization code from callback.
	 * @returns {Promise<{ accessToken: string, expiresIn: number, userInfo: any }>} Token and user info.
	 */
	private async exchangeCodeForToken(refreshToken: string): Promise<ClineAuthInfo> {
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

	/**
	 * Fetches detailed user information from the API using the access token.
	 * @param accessToken - The access token.
	 * @returns {Promise<ClineAccountUserInfo>} The user information.
	 */
	private async fetchUserInfo(accessToken: string): Promise<ClineAccountUserInfo> {
		try {
			const endpoint = new URL(CLINE_API_ENDPOINT.USER_INFO, this._config.apiBaseUrl)
			const userResponse = await fetch(endpoint.toString(), {
				method: "GET",
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			})

			if (!userResponse.ok) {
				if (userResponse.status === 401) {
					throw new Error("Access token is invalid or expired")
				}
				throw new Error(`HTTP error! status: ${userResponse.status}`)
			}

			const userData = await userResponse.json()

			if (!userData?.data) {
				throw new Error("Failed to fetch user information")
			}

			return userData.data
		} catch (error: any) {
			throw error
		}
	}

	/**
	 * Signs in the user using the authorization code received from the auth callback.
	 * @param controller - The controller instance to store the access token.
	 * @param authorizationCode - The authorization code received from the auth callback.
	 * @param provider - The provider name (not used in Cline auth but kept for interface compatibility).
	 * @returns {Promise<ClineAuthInfo | null>} A promise that resolves with the auth info.
	 */
	async signIn(controller: Controller, authorizationCode: string, _provider: string): Promise<ClineAuthInfo | null> {
		try {
			console.log(authorizationCode, "auth provider:", _provider)
			// Exchange the authorization code for an access token and user info
			const exchanged = await this.exchangeCodeForToken(authorizationCode)
			// Store the access token and user info in secret storage (expiresAt already in seconds)
			const authData: ClineAuthInfo = exchanged

			try {
				controller.stateManager.setSecret("clineAccountId", JSON.stringify(authData))
			} catch (error) {
				throw error
			}

			// Return the auth info
			return authData
		} catch (error) {
			throw error
		}
	}
}
