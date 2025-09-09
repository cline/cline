import axios from "axios"
import { jwtDecode } from "jwt-decode"
import { clineEnvConfig } from "@/config"
import { Controller } from "@/core/controller"
import { ErrorService } from "@/services/error"
import type { ClineAccountUserInfo, ClineAuthInfo } from "../AuthService"

export class ClineAuthProvider {
	readonly name = "cline"
	private _config

	constructor() {
		this._config = clineEnvConfig
	}

	get config(): any {
		return this._config
	}

	set config(value: any) {
		this._config = value
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
	 * Retrieves Cline auth info using the stored refresh token.
	 * @param controller - The controller instance to access stored secrets.
	 * @returns {Promise<ClineAuthInfo | null>} A promise that resolves with the auth info or null.
	 */
	async retrieveClineAuthInfo(controller: Controller): Promise<ClineAuthInfo | null> {
		const userRefreshToken = controller.stateManager.getSecretKey("clineAccountId")
		if (!userRefreshToken) {
			console.error("No stored authentication credential found.")
			return null
		}

		try {
			// Call the Cline API refresh endpoint to get a new ID token
			const refreshResponse = await axios.post(
				`${this._config.apiBaseUrl}/auth/refresh`,
				{
					refreshToken: userRefreshToken,
				},
				{
					headers: {
						"Content-Type": "application/json",
					},
				},
			)

			const idToken = refreshResponse.data.idToken
			if (!idToken) {
				console.error("No ID token received from refresh endpoint")
				return null
			}

			// Fetch user info from Cline API using the new ID token
			const userResponse = await axios.get(`${clineEnvConfig.apiBaseUrl}/api/v1/users/me`, {
				headers: {
					Authorization: `Bearer ${idToken}`,
				},
			})

			// Store user data
			const userInfo: ClineAccountUserInfo = userResponse.data.data

			return { idToken, userInfo }
		} catch (error) {
			console.error("Cline auth refresh error", error)
			ErrorService.get().logMessage("Cline auth refresh error", "error")
			ErrorService.get().logException(error)
			throw error
		}
	}

	/**
	 * Signs in the user using the refresh token received from the auth callback.
	 * @param controller - The controller instance to store the refresh token.
	 * @param refreshToken - The refresh token received from the auth callback.
	 * @param provider - The provider name (not used in Cline auth but kept for interface compatibility).
	 * @returns {Promise<ClineAuthInfo | null>} A promise that resolves with the auth info.
	 */
	async signIn(controller: Controller, refreshToken: string, _provider: string): Promise<ClineAuthInfo | null> {
		try {
			// Store the refresh token in secret storage
			try {
				controller.stateManager.setSecret("clineAccountId", refreshToken)
			} catch (error) {
				ErrorService.get().logMessage("Cline store token error", "error")
				ErrorService.get().logException(error)
				throw error
			}

			// Use the refresh token to get the auth info
			return await this.retrieveClineAuthInfo(controller)
		} catch (error) {
			ErrorService.get().logMessage("Cline sign-in error", "error")
			ErrorService.get().logException(error)
			throw error
		}
	}
}
