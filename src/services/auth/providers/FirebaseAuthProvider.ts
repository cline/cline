import axios from "axios"
import { User } from "firebase/auth"
import { jwtDecode } from "jwt-decode"
import { clineEnvConfig, EnvironmentConfig } from "@/config"
import { Controller } from "@/core/controller"
import { ErrorService } from "@/services/error"
import type { ClineAccountUserInfo, ClineAuthInfo } from "../AuthService"

export class FirebaseAuthProvider {
	readonly name = "firebase"
	readonly callbackEndpoint = "/auth"

	private _config: EnvironmentConfig["firebase"]

	constructor(config: EnvironmentConfig["firebase"]) {
		this._config = config || {}
	}

	get config(): any {
		return this._config
	}

	set config(value: any) {
		this._config = value
	}

	async shouldRefreshIdToken(existingIdToken: string, _expiresAt?: number): Promise<boolean> {
		const decodedToken = jwtDecode(existingIdToken)
		const exp = decodedToken.exp || 0 // 1752297633
		const expirationTime = exp * 1000
		const currentTime = Date.now()
		const fiveMinutesInMs = 5 * 60 * 1000
		if (currentTime > expirationTime - fiveMinutesInMs) {
			return true // id token is expired or about to be expired
		}
		return false
	}

	/**
	 * Restores the authentication token using a provided token.
	 * @param token - The authentication token to restore.
	 * @returns {Promise<User>} A promise that resolves with the authenticated user.
	 * @throws {Error} Throws an error if the restoration fails.
	 */
	async retrieveClineAuthInfo(controller: Controller): Promise<ClineAuthInfo | null> {
		const userRefreshToken = controller.stateManager.getSecretKey("clineAccountId")
		if (!userRefreshToken) {
			console.error("No stored authentication credential found.")
			return null
		}
		try {
			// Exchange refresh token for new access token using Firebase's secure token endpoint
			const idToken = await this.refreshToken(userRefreshToken)

			// Now retrieve the user info from the backend (this was an easy solution to keep providing user profile details like name and email, but we should move to using the fetchMe() function instead)
			// Fetch user info from Cline API
			// TODO: consolidate with fetchMe() instead of making the call directly here
			const userResponse = await axios.get(`${clineEnvConfig.apiBaseUrl}/api/v1/users/me`, {
				headers: {
					Authorization: `Bearer ${idToken}`,
				},
			})

			// Store user data
			const userInfo: ClineAccountUserInfo = userResponse.data.data

			return { idToken, userInfo }

			// let userObject = JSON.parse(credentialJSON)
			// let user = User.
			// userObject = User.constructor._fromJSON(auth, user2);
			// const credentialData: AuthCredential = OAuthCredential.fromJSON(credentialJSON) as AuthCredential
			// const userCredential = await this._signInWithCredential(context, credentialData)
			// return userCredential.user
		} catch (error) {
			ErrorService.get().logException(error)
			throw error
		}
	}

	async refreshToken(userRefreshToken: string): Promise<string> {
		// Exchange refresh token for new access token using Firebase's secure token endpoint
		// https://stackoverflow.com/questions/38233687/how-to-use-the-firebase-refreshtoken-to-reauthenticate/57119131#57119131
		const firebaseApiKey = this._config.apiKey
		const googleAccessTokenResponse = await axios.post(
			`https://securetoken.googleapis.com/v1/token?key=${firebaseApiKey}`,
			`grant_type=refresh_token&refresh_token=${encodeURIComponent(userRefreshToken)}`,
			{
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
				},
			},
		)

		// console.log("googleAccessTokenResponse", googleAccessTokenResponse)

		// This returns an object with access_token, expires_in (3600), id_token (can be used as bearer token to authenticate requests, we'll use this in the future instead of firebase but need to be aware of how we use firebase sdk for e.g. user info like the profile image), project_id, refresh_token, token_type (always Bearer), and user_id
		return googleAccessTokenResponse.data.id_token
	}
}
