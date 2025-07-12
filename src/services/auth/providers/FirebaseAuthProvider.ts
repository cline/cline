import { getSecret, storeSecret } from "@/core/storage/state"
import { ErrorService } from "@/services/error/ErrorService"
import axios from "axios"
import { initializeApp } from "firebase/app"
import { GithubAuthProvider, GoogleAuthProvider, User, getAuth, signInWithCredential } from "firebase/auth"
import { ExtensionContext } from "vscode"
import { ClineAccountUserInfo, ClineAuthInfo } from "../AuthService"
import { jwtDecode } from "jwt-decode"

export class FirebaseAuthProvider {
	private _config: any

	constructor(config: any) {
		this._config = config || {}
	}

	get config(): any {
		return this._config
	}

	set config(value: any) {
		this._config = value
	}

	async shouldRefreshIdToken(existingIdToken: string): Promise<boolean> {
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
	async retrieveClineAuthInfo(context: ExtensionContext): Promise<ClineAuthInfo | null> {
		const userRefreshToken = await getSecret(context, "clineAccountId")
		if (!userRefreshToken) {
			console.error("No stored authentication credential found.")
			return null
		}
		try {
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
			const idToken = googleAccessTokenResponse.data.id_token
			// const idTokenExpirationDate = new Date(Date.now() + googleAccessTokenResponse.data.expires_in * 1000)

			// Now retrieve the user info from the backend (this was an easy solution to keep providing user profile details like name and email, but we should move to using the fetchMe() function instead)
			// Fetch user info from Cline API
			// TODO: consolidate with fetchMe() instead of making the call directly here
			const userResponse = await axios.get("https://api.cline.bot/api/v1/users/me", {
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
			console.error("Firebase restore token error", error)
			ErrorService.logMessage("Firebase restore token error", "error")
			ErrorService.logException(error)
			throw error
		}
	}

	/**
	 * Signs in the user using Firebase authentication with a custom token.
	 * @returns {Promise<User>} A promise that resolves with the authenticated user.
	 * @throws {Error} Throws an error if the sign-in fails.
	 */
	async signIn(context: ExtensionContext, token: string, provider: string): Promise<ClineAuthInfo | null> {
		try {
			let credential
			switch (provider) {
				case "google":
					credential = GoogleAuthProvider.credential(token)
					break
				case "github":
					credential = GithubAuthProvider.credential(token)
					break
				default:
					throw new Error(`Unsupported provider: ${provider}`)
			}
			// we've received the short-lived tokens from google/github, now we need to sign in to firebase with them
			const firebaseConfig = Object.assign({}, this._config)
			const app = initializeApp(firebaseConfig)
			const auth = getAuth(app)
			// this signs the user into firebase sdk internally
			const userCredential = (await signInWithCredential(auth, credential)).user
			// const userRefreshToken = await userCredential.getIdToken()

			// store the long-lived refresh token in secret storage
			try {
				await storeSecret(context, "clineAccountId", userCredential.refreshToken)
			} catch (error) {
				ErrorService.logMessage("Firebase store token error", "error")
				ErrorService.logException(error)
				throw error
			}

			// userCredential = await this._signInWithCredential(context, credential)
			return await this.retrieveClineAuthInfo(context)
		} catch (error) {
			ErrorService.logMessage("Firebase sign-in error", "error")
			ErrorService.logException(error)
			throw error
		}
	}
}
