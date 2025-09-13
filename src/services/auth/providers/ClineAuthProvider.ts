import { jwtDecode } from "jwt-decode"
import { EnvironmentConfig } from "@/config"
import { Controller } from "@/core/controller"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/services/logging/Logger"
import { CLINE_API_ENDPOINT } from "@/shared/cline/api"
import type { ClineAccountUserInfo, ClineAuthInfo } from "../AuthService"

interface ClineAuthApiUser {
	Subject: string | null
	Email: string
	Name: string
	ClineUserID: string | null
}

export interface ClineAuthApiTokenExchangeResponse {
	success: boolean
	data: {
		// Auth token to be used for authenticated requests
		access_token: string
		// Bearer
		token_type: string
		// Token expiration time in seconds
		expires_at: number
		user_info: ClineAuthApiUser
	}
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
	async shouldRefreshIdToken(existingAccessToken: string): Promise<boolean> {
		try {
			const decodedToken = jwtDecode(existingAccessToken)
			const exp = decodedToken.exp || 0
			const expirationTime = exp * 1000
			const currentTime = Date.now()
			const fiveMinutesInMs = 5 * 60 * 1000

			// Check if token is expired or will expire in the next 5 minutes
			if (currentTime > expirationTime - fiveMinutesInMs) {
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

			// Check if we have a valid token
			if (!storedAuthData?.idToken) {
				console.error("No access token found in stored authentication data")
				controller.stateManager.setSecret("clineAccountId", undefined)
				return null
			}

			// Check if token is expired
			const now = Date.now()
			if (storedAuthData.expiresAt && storedAuthData.expiresAt < now) {
				console.log(`Token expired at ${new Date(storedAuthData.expiresAt).toISOString()}`)
				controller.stateManager.setSecret("clineAccountId", undefined)
				return null
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
			} catch (e) {
				console.error("Invalid token format or content:", e)
				controller.stateManager.setSecret("clineAccountId", undefined)
				return null
			}

			console.log("Successfully retrieved and validated stored auth token")
			return {
				expiresAt: storedAuthData.expiresAt,
				subject: storedAuthData.subject || storedAuthData.userInfo?.id || "",
				idToken: storedAuthData.idToken,
				userInfo: storedAuthData.userInfo || {
					id: storedAuthData.subject || "",
					email: "",
					displayName: "",
					createdAt: new Date().toISOString(),
					organizations: [],
				},
			}
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
	private async exchangeCodeForToken(authorizationCode: string): Promise<ClineAuthInfo> {
		try {
			// Get the callback URL that was used during the initial auth request
			const callbackHost = await HostProvider.get().getCallbackUri()
			const callbackUrl = `${callbackHost}/auth`
			const endpoint = new URL(CLINE_API_ENDPOINT.TOKEN_EXCHANGE, this._config.apiBaseUrl)
			const response = await fetch(endpoint.toString(), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					code: authorizationCode, // short_lived_auth_code
					grant_type: "authorization_code", // must be "authorization_code"
					client_type: "extension",
					redirect_uri: callbackUrl,
					provider: "cline",
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

			if (!data.success || !data.data.access_token) {
				throw new Error("Failed to exchange authorization code for access token")
			}

			return {
				idToken: data.data.access_token,
				expiresAt: Date.now() + data.data.expires_at * 1000,
				userInfo: {
					createdAt: new Date().toISOString(),
					email: data.data.user_info.Email,
					id: data.data.user_info.Subject || "",
					displayName: data.data.user_info.Name,
					organizations: [],
					appBaseUrl: this._config.appBaseUrl,
				},
				subject: data.data.user_info.Subject || "",
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
			// Exchange the authorization code for an access token
			const { idToken, expiresAt } = await this.exchangeCodeForToken(authorizationCode)
			// 5 mins
			const expiresIn = expiresAt || 5 * 60

			// Fetch detailed user information
			const detailedUserInfo = await this.fetchUserInfo(idToken)

			// Calculate token expiration time
			const expiration = Date.now() + expiresIn * 1000

			// Store the access token and user info in secret storage
			const authData: ClineAuthInfo = {
				idToken,
				expiresAt: expiration,
				userInfo: detailedUserInfo,
			}

			try {
				controller.stateManager.setSecret("clineAccountId", JSON.stringify(authData))
			} catch (error) {
				throw error
			}

			// Return the auth info
			return {
				idToken, // Using idToken field for backward compatibility
				userInfo: detailedUserInfo,
			}
		} catch (error) {
			throw error
		}
	}
}
