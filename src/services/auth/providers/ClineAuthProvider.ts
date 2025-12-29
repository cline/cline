import axios from "axios"
import { type JwtPayload } from "jwt-decode"
import { ClineEnv, EnvironmentConfig } from "@/config"
import { Controller } from "@/core/controller"
import { HostProvider } from "@/hosts/host-provider"
import { AuthInvalidTokenError, AuthNetworkError } from "@/services/error/ClineError"
import { Logger } from "@/services/logging/Logger"
import { telemetryService } from "@/services/telemetry"
import { CLINE_API_ENDPOINT } from "@/shared/cline/api"
import { fetch, getAxiosSettings } from "@/shared/net"
import { type ClineAccountUserInfo, type ClineAuthInfo } from "../AuthService"
import { parseJwtPayload } from "../oca/utils/utils"
import { IAuthProvider } from "./IAuthProvider"

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

type TokenData = JwtPayload & {
	sid?: string
	external_id?: string
}

export interface ClineAuthApiTokenExchangeResponse {
	success: boolean
	data: ClineAuthResponseData
}

export interface ClineAuthApiTokenRefreshResponse {
	success: boolean
	data: ClineAuthResponseData
}

export class ClineAuthProvider implements IAuthProvider {
	readonly name = "cline"
	private refreshRetryCount = 0
	private lastRefreshAttempt = 0
	private readonly MAX_REFRESH_RETRIES = 3
	private readonly RETRY_DELAY_MS = 30000 // 30 seconds

	get config(): EnvironmentConfig {
		return ClineEnv.config()
	}

	/**
	 * Checks if the access token needs to be refreshed (expired or about to expire).
	 * Since the new flow doesn't support refresh tokens, this will return true if token is expired.
	 * @param _refreshToken - The existing refresh token to check.
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
	 * Returns the time in seconds until token expiry
	 */
	private timeUntilExpiry(_refreshToken: string, expiresAt?: number): number {
		const currentTime = Date.now() / 1000
		const expirationTime = expiresAt || 0

		return expirationTime - currentTime
	}

	private clearSession(controller: Controller, reason: string, storedAuthData?: ClineAuthInfo) {
		Logger.error(reason)

		const startedAt = storedAuthData?.startedAt
		const timeSinceStarted = Date.now() - (startedAt || 0)

		const tokenData = this.extractTokenData(storedAuthData)
		telemetryService.capture({
			event: "extension_logging_user_out",
			properties: {
				reason,
				time_since_started: timeSinceStarted,
				session_id: tokenData.sid,
				user_id: tokenData.external_id,
			},
		})

		controller.stateManager.setSecret("cline:clineAccountId", undefined)
		this.refreshRetryCount = 0
		this.lastRefreshAttempt = 0
		return null
	}

	private logFailedRefreshAttempt(response: Response, storedAuthData?: ClineAuthInfo) {
		const startedAt = storedAuthData?.startedAt
		const timeSinceStarted = Date.now() - (startedAt || 0)

		const tokenData = this.extractTokenData(storedAuthData)
		telemetryService.capture({
			event: "extension_refresh_attempt_failed",
			properties: {
				status_code: response.status,
				request_id: response.headers.get("x-request-id"),
				session_id: tokenData.sid,
				user_id: tokenData.external_id,
				time_since_started: timeSinceStarted,
			},
		})
	}

	private extractTokenData(authInfo?: ClineAuthInfo): Partial<TokenData> {
		if (!authInfo || !authInfo.idToken) {
			return {}
		}

		const idToken = authInfo.idToken

		return parseJwtPayload<TokenData>(idToken) || {}
	}

	/**
	 * Retrieves Cline auth info using the stored access token.
	 * @param controller - The controller instance to access stored secrets.
	 * @returns {Promise<ClineAuthInfo | null>} A promise that resolves with the auth info or null.
	 */
	async retrieveClineAuthInfo(controller: Controller): Promise<ClineAuthInfo | null> {
		try {
			// Get the stored auth data from secure storage
			const storedAuthDataString = controller.stateManager.getSecretKey("cline:clineAccountId")

			if (!storedAuthDataString) {
				Logger.debug("No stored authentication data found")
				// Reset retry count when there's no stored auth
				this.refreshRetryCount = 0
				this.lastRefreshAttempt = 0
				return null
			}

			// Parse the stored auth data
			let storedAuthData: ClineAuthInfo
			try {
				storedAuthData = JSON.parse(storedAuthDataString)
			} catch (e) {
				Logger.error("Failed to parse stored auth data:", e)
				return this.clearSession(controller, "Failed to parse stored auth data")
			}

			if (!storedAuthData.refreshToken || !storedAuthData?.idToken) {
				return this.clearSession(controller, "No refresh token or ID token found in store", storedAuthData)
			}

			if (await this.shouldRefreshIdToken(storedAuthData.refreshToken, storedAuthData.expiresAt)) {
				// If the token hasn't expired yet,
				// and it failed the first refresh attempt
				// with something other than invalid token
				// continue with the request
				if (
					this.refreshRetryCount > 0 &&
					this.timeUntilExpiry(storedAuthData.refreshToken, storedAuthData.expiresAt) > 30
				) {
					this.refreshRetryCount = 0
					this.lastRefreshAttempt = 0
					return storedAuthData
				}

				// Check if we need to wait before retrying
				const now = Date.now()
				const timeSinceLastAttempt = now - this.lastRefreshAttempt
				if (timeSinceLastAttempt < this.RETRY_DELAY_MS && this.refreshRetryCount > 0) {
					Logger.debug(
						`Waiting ${Math.ceil((this.RETRY_DELAY_MS - timeSinceLastAttempt) / 1000)}s before retry attempt ${this.refreshRetryCount + 1}/${this.MAX_REFRESH_RETRIES}`,
					)
					return null
				}

				// Check if we've exceeded max retries
				if (this.refreshRetryCount >= this.MAX_REFRESH_RETRIES) {
					Logger.error(`Max refresh retries (${this.MAX_REFRESH_RETRIES}) exceeded.`)
					// Don't clear session - return stored data and let API request fail later
					return storedAuthData
				}

				// Try to refresh the token using the refresh token
				this.refreshRetryCount++
				this.lastRefreshAttempt = now
				Logger.debug(
					`Token expired or expiring soon, attempting refresh (attempt ${this.refreshRetryCount}/${this.MAX_REFRESH_RETRIES}). API Base URL: ${this.config.apiBaseUrl}`,
				)

				try {
					const authInfo = await this.refreshToken(storedAuthData.refreshToken, storedAuthData)
					const newAuthInfoString = JSON.stringify(authInfo)
					if (newAuthInfoString !== storedAuthDataString) {
						controller.stateManager.setSecret("clineAccountId", undefined) // cleanup old key
						controller.stateManager.setSecret("cline:clineAccountId", newAuthInfoString)
					}
					// Reset retry count on success
					this.refreshRetryCount = 0
					this.lastRefreshAttempt = 0
					Logger.debug("Token refresh successful")
					return authInfo || null
				} catch (refreshError) {
					Logger.error(
						`Token refresh failed (attempt ${this.refreshRetryCount}/${this.MAX_REFRESH_RETRIES}):`,
						refreshError,
					)

					// If it's an invalid token error, clear immediately and don't retry
					if (refreshError instanceof AuthInvalidTokenError) {
						this.clearSession(controller, "Invalid or expired refresh token. Clearing auth state.", storedAuthData)

						throw refreshError
					}

					// For network errors, return stored data - let the API request fail later
					// when the user actually tries to use Cline, not at startup
					return storedAuthData
				}
			}

			// Token is still valid and not expired, reset retry count
			this.refreshRetryCount = 0
			this.lastRefreshAttempt = 0

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
			return storedAuthData
		} catch (error) {
			Logger.error("Authentication failed with stored credential:", error)
			// Reset retry count on unexpected errors
			if (!(error instanceof AuthInvalidTokenError)) {
				this.refreshRetryCount = 0
				this.lastRefreshAttempt = 0
			}
			return null
		}
	}

	/**
	 * Refreshes an access token using a refresh token.
	 * @param refreshToken - The refresh token.
	 * @returns {Promise<ClineAuthInfo>} The new access token and user info.
	 */
	async refreshToken(refreshToken: string, storedData: ClineAuthInfo): Promise<ClineAuthInfo> {
		try {
			const endpoint = new URL(CLINE_API_ENDPOINT.REFRESH_TOKEN, this.config.apiBaseUrl)
			const response = await fetch(endpoint.toString(), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					refreshToken: storedData.refreshToken,
					grantType: "refresh_token",
				}),
			})

			if (!response.ok) {
				this.logFailedRefreshAttempt(response, storedData)

				// 400/401 = Invalid/expired token (permanent failure)
				if (response.status === 400 || response.status === 401) {
					const errorData = await response.json().catch(() => ({}))
					const errorMessage = errorData?.error || "Invalid or expired token"
					throw new AuthInvalidTokenError(errorMessage)
				}
				// 5xx, 429, network errors = transient failures
				const errorData = await response.json().catch(() => ({}))
				throw new AuthNetworkError(`status: ${response.status}`, errorData)
			}

			const data: ClineAuthApiTokenExchangeResponse = await response.json()

			if (!data.success || !data.data.refreshToken || !data.data.accessToken) {
				throw new Error("Failed to exchange authorization code for access token")
			}

			const userInfo = await this.fetchRemoteUserInfo(data.data)

			return {
				idToken: data.data.accessToken,
				// data.data.expiresAt example: "2025-09-17T03:43:57Z"; store in seconds
				expiresAt: new Date(data.data.expiresAt).getTime() / 1000,
				refreshToken: data.data.refreshToken || refreshToken,
				userInfo,
				provider: this.name,
				startedAt: storedData.startedAt || Date.now(),
			}
		} catch (error: any) {
			// Network errors (ECONNREFUSED, timeout, etc)
			if (error.name === "TypeError" || error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT") {
				throw new AuthNetworkError("Network error during token refresh", error)
			}
			throw error
		}
	}

	async getAuthRequest(callbackUrl: string): Promise<string> {
		const authUrl = new URL(CLINE_API_ENDPOINT.AUTH, this.config.apiBaseUrl)
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

				return redirectUrl
			}

			// If we didn't get a redirect, try to parse the response as JSON
			const responseData = await response.json()
			if (responseData.redirect_url) {
				return responseData.redirect_url
			}

			throw new Error("Unexpected response from auth server")
		} catch (error) {
			Logger.error("Error during authentication request:", error)
			throw new Error(`Authentication failed: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async signIn(controller: Controller, authorizationCode: string, provider: string): Promise<ClineAuthInfo | null> {
		try {
			// Get the callback URL that was used during the initial auth request
			const callbackHost = await HostProvider.get().getCallbackUrl()
			const callbackUrl = `${callbackHost}/auth`

			// Exchange the authorization code for tokens
			const tokenUrl = new URL(CLINE_API_ENDPOINT.TOKEN_EXCHANGE, this.config.apiBaseUrl)

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
			const responseType: ClineAuthApiTokenExchangeResponse = responseJSON
			const tokenData = responseType.data

			if (!tokenData.accessToken || !tokenData.refreshToken || !tokenData.userInfo) {
				throw new Error("Invalid token response from server")
			}

			const userInfo = await this.fetchRemoteUserInfo(tokenData)

			// Store the tokens and user info
			const clineAuthInfo = {
				idToken: tokenData.accessToken,
				refreshToken: tokenData.refreshToken,
				userInfo,
				expiresAt: new Date(tokenData.expiresAt).getTime() / 1000, // "2025-09-17T04:32:24.842636548Z"
				provider: this.name,
				startedAt: Date.now(),
			}

			controller.stateManager.setSecret("cline:clineAccountId", JSON.stringify(clineAuthInfo))

			return clineAuthInfo
		} catch (error) {
			Logger.error("Error handling auth callback:", error)
			throw error
		}
	}

	private async fetchRemoteUserInfo(tokenData: ClineAuthApiTokenExchangeResponse["data"]): Promise<ClineAccountUserInfo> {
		try {
			const userResponse = await axios.get(`${ClineEnv.config().apiBaseUrl}/api/v1/users/me`, {
				headers: {
					Authorization: `Bearer workos:${tokenData.accessToken}`,
				},
				...getAxiosSettings(),
			})

			return userResponse.data.data
		} catch (error) {
			Logger.error("Error fetching user info:", error)

			// If fetching user info fail for whatever reason, fallback to the token data and refetch on token expiry (10 minutes)
			return {
				id: tokenData.userInfo.clineUserId || "",
				email: tokenData.userInfo.email || "",
				displayName: tokenData.userInfo.name || "",
				createdAt: new Date().toISOString(),
				organizations: [],
			}
		}
	}
}
