import { OpenAIAuthState, OpenAIUserInfo } from "@shared/proto/index.cline"
import axios from "axios"
import { jwtDecode } from "jwt-decode"
import { Controller } from "@/core/controller"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { generateCodeVerifier, generateRandomString, pkceChallengeFromVerifier } from "./pkce-utils"

// TODO: consolidate with OcaAuthProvider.PkceState
type PkceState = {
	code_verifier: string
	nonce: string
	createdAt: number
	redirect_uri: string
}

// TODO: consolidate with OcaAuthProvider.PkceState
export class OpenAIRefreshError extends Error {
	status?: number
	code?: string
	invalidGrant?: boolean
	data?: unknown
	constructor(message: string, status?: number, code?: string, invalidGrant?: boolean, data?: unknown) {
		super(message)
		this.name = "OpenAIRefreshError"
		this.status = status
		this.code = code
		this.invalidGrant = invalidGrant
		this.data = data
	}
}

// TODO: consolidate with OcaAuthProvider.PkceState (add base class)
export class OpenAIAuthProvider {
	// Map state -> { code_verifier, nonce, createdAt }
	private static pkceStateMap: Map<string, PkceState> = new Map()

	constructor() {}

	/**
	 * Determines if the access token should be refreshed.
	 */
	async shouldRefreshAccessToken(existingAccessToken: string): Promise<boolean> {
		try {
			const decodedToken = this.decodeJwt(existingAccessToken)
			const exp = decodedToken.exp || 0
			const expirationTime = exp * 1000
			const currentTime = Date.now()
			const fiveMinutesInMs = 5 * 60 * 1000
			return currentTime > expirationTime - fiveMinutesInMs
		} catch (error) {
			// If token can't be decoded, assume it needs refresh
			Logger.error("Error decoding access token for refresh check:", error)
			return true
		}
	}

	/**
	 * Decodes a JWT token.
	 */
	protected decodeJwt(token: string): any {
		return jwtDecode(token)
	}

	private async getUserAccountInfo(token: string): Promise<OpenAIUserInfo> {
		try {
			const decodedToken = this.decodeJwt(token)
			return {
				displayName: decodedToken.name || "Unknown",
				uid: decodedToken.sub || "",
				email: decodedToken.email || "",
			}
		} catch (error) {
			Logger.error("Error decoding token:", error)
			return {
				displayName: "Unknown",
				uid: "",
				email: "",
			}
		}
	}

	public async getExistingAuthState(controller: Controller): Promise<OpenAIAuthState | null> {
		const accessToken = controller.stateManager.getSecretKey("openAiOAuthAccessToken")
		if (accessToken && !(await this.shouldRefreshAccessToken(accessToken))) {
			return { user: await this.getUserAccountInfo(accessToken), apiKey: accessToken }
		}
		return null
	}

	async retrieveOpenAIAuthState(controller: Controller): Promise<OpenAIAuthState | null> {
		// First check the existing access token
		const existingAuthState = await this.getExistingAuthState(controller)
		if (existingAuthState) {
			Logger.debug("[OpenAI OAuth] Using cached access token (not yet expired)")
			return existingAuthState
		}
		// Otherwise, try to refresh using the refresh token
		const userRefreshToken = controller.stateManager.getSecretKey("openAiOAuthRefreshToken")
		if (!userRefreshToken) {
			Logger.warn("[OpenAI OAuth] No stored refresh token found. User must authenticate first.")
			return null
		}
		try {
			Logger.debug("[OpenAI OAuth] Token expired or not found. Attempting refresh with refresh_token grant...")
			const tokenUrl = controller.stateManager.getGlobalSettingsKey("openAiOAuthTokenUrl")
			const clientId = controller.stateManager.getGlobalSettingsKey("openAiOAuthClientId")
			const clientSecret = controller.stateManager.getSecretKey("openAiOAuthClientSecret")
			if (!tokenUrl || !clientId) {
				throw new Error("OpenAI OAuth token URL or Client ID are not configured")
			}

			const params: any = {
				grant_type: "refresh_token",
				refresh_token: userRefreshToken,
				client_id: clientId,
			}

			// Add client_secret if available (confidential clients)
			if (clientSecret) {
				params.client_secret = clientSecret
			}

			const tokenResponse = await axios.post(tokenUrl as string, new URLSearchParams(params), {
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				...getAxiosSettings(),
			})

			const accessToken = tokenResponse.data.access_token
			const refreshToken = tokenResponse.data.refresh_token

			if (refreshToken) {
				Logger.debug("[OpenAI OAuth] Token refresh successful, storing new tokens")
				controller.stateManager.setSecret("openAiOAuthRefreshToken", refreshToken)
				controller.stateManager.setSecret("openAiOAuthAccessToken", accessToken)
			} else {
				Logger.warn(
					"[OpenAI OAuth] No refresh token received during token refresh - server may not support refresh token rotation",
				)
				throw new OpenAIRefreshError("No refresh token received during OpenAI token refresh.")
			}

			const userInfo: OpenAIUserInfo = await this.getUserAccountInfo(accessToken)
			return { user: userInfo, apiKey: accessToken }
		} catch (err: unknown) {
			const isAxios = (axios as any)?.isAxiosError?.(err)
			const status = isAxios ? (err as any).response?.status : undefined
			const data: any = isAxios ? (err as any).response?.data : undefined
			const code = data?.error || (isAxios ? (err as any).code : undefined)
			const desc = data?.error_description || (isAxios ? (err as any).message : undefined)
			const invalidGrant = (status === 400 && code === "invalid_grant") || status === 401

			const errMsg = `[OpenAI OAuth] Token refresh failed (status: ${status}, code: ${code}, ${desc || ""}, data: ${data})`
			Logger.error(errMsg, err as Error)

			throw new OpenAIRefreshError(desc || "OpenAI OAuth refresh failed", status, code, invalidGrant, data)
		}
	}

	// Launch authentication flow: returns URL
	getAuthUrl(controller: Controller, callbackUrl: string): URL {
		const authUrl = controller.stateManager.getGlobalSettingsKey("openAiOAuthAuthUrl")
		const clientId = controller.stateManager.getGlobalSettingsKey("openAiOAuthClientId")
		const scopes = controller.stateManager.getGlobalSettingsKey("openAiOAuthScopes")
		if (!authUrl || !clientId || !scopes) {
			throw new Error("OpenAI OAuth authorization URL, Client ID, or Scopes are not configured")
		}

		const codeVerifier = generateCodeVerifier()
		const codeChallenge = pkceChallengeFromVerifier(codeVerifier)
		const state = generateRandomString(32)
		const nonce = generateRandomString(32)

		// Clean up expired PKCE entries (older than 10min)
		const cutoff = Date.now() - 600_000
		for (const [key, entry] of OpenAIAuthProvider.pkceStateMap.entries()) {
			if (entry.createdAt < cutoff) {
				OpenAIAuthProvider.pkceStateMap.delete(key)
			}
		}

		OpenAIAuthProvider.pkceStateMap.set(state, {
			code_verifier: codeVerifier,
			nonce,
			createdAt: Date.now(),
			redirect_uri: callbackUrl,
		})

		const url = new URL(authUrl as string)
		url.searchParams.set("client_id", clientId)
		url.searchParams.set("response_type", "code")
		url.searchParams.set("scope", scopes as string)
		url.searchParams.set("code_challenge", codeChallenge)
		url.searchParams.set("code_challenge_method", "S256")
		url.searchParams.set("redirect_uri", callbackUrl)
		url.searchParams.set("state", state)
		url.searchParams.set("nonce", nonce)

		return url
	}

	// signIn expects code and state from the callback
	async signIn(controller: Controller, code: string, state: string): Promise<OpenAIAuthState | null> {
		try {
			const tokenUrl = controller.stateManager.getGlobalSettingsKey("openAiOAuthTokenUrl")
			const clientId = controller.stateManager.getGlobalSettingsKey("openAiOAuthClientId")
			const clientSecret = controller.stateManager.getSecretKey("openAiOAuthClientSecret")
			if (!tokenUrl || !clientId) {
				throw new Error("OpenAI OAuth token URL or Client ID are not configured")
			}

			const entry = OpenAIAuthProvider.pkceStateMap.get(state)
			if (!entry) {
				throw new Error("No PKCE verifier found for this state (possibly expired or flow not initiated)")
			}

			const { code_verifier, nonce, redirect_uri } = entry
			OpenAIAuthProvider.pkceStateMap.delete(state)

			const params: any = {
				grant_type: "authorization_code",
				code,
				redirect_uri,
				client_id: clientId,
				code_verifier,
			}

			// Add client_secret if available (confidential clients)
			if (clientSecret) {
				params.client_secret = clientSecret
			}

			const tokenResponse = await axios.post(tokenUrl as string, new URLSearchParams(params), {
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				...getAxiosSettings(),
			})

			// Step 1: Get tokens
			const accessToken = tokenResponse.data.access_token
			const refreshToken = tokenResponse.data.refresh_token
			const idToken = tokenResponse.data.id_token

			if (!accessToken) {
				throw new Error("No access token received from OpenAI OAuth")
			}

			// Step 2: Nonce validation (if id_token is provided)
			if (idToken) {
				const decodedIdToken = this.decodeJwt(idToken)
				if (decodedIdToken.nonce !== nonce) {
					throw new Error("Nonce validation failed")
				}
			}

			// Step 3: Store tokens securely
			if (refreshToken) {
				controller.stateManager.setSecret("openAiOAuthRefreshToken", refreshToken)
			}
			controller.stateManager.setSecret("openAiOAuthAccessToken", accessToken)

			// Step 4: Return authentication state
			const userInfo = await this.getUserAccountInfo(accessToken)
			return { user: userInfo, apiKey: accessToken }
		} catch (error) {
			Logger.error("Error during OpenAI OAuth sign-in:", error)
			throw error
		}
	}

	clearAuth(controller: Controller): void {
		controller.stateManager.setSecret("openAiOAuthAccessToken", undefined)
		controller.stateManager.setSecret("openAiOAuthRefreshToken", undefined)
	}
}
