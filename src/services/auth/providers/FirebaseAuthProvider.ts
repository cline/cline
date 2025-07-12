import { getSecret, storeSecret } from "@/core/storage/state"
import { ErrorService } from "@/services/error/ErrorService"
import axios from "axios"
import { initializeApp } from "firebase/app"
import {
	GithubAuthProvider,
	GoogleAuthProvider,
	User,
	getAuth,
	signInWithCredential,
	signInWithCustomToken,
	signOut,
} from "firebase/auth"
import { ExtensionContext } from "vscode"

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

	/**
	 * Gets the authentication token of the current user.
	 * @returns {Promise<string | null>} A promise that resolves to the authentication token of the current user, or null if no user is signed in.
	 */
	async getAuthToken(): Promise<string | null> {
		const user = getAuth().currentUser
		const idToken = user ? await user.getIdToken() : null
		return idToken
	}

	/**
	 * Refreshes the authentication token of the current user.
	 * @returns {Promise<string | null>} A promise that resolves to the refreshed authentication token of the current user, or null if no user is signed in.
	 */
	async refreshAuthToken(): Promise<string | null> {
		const user = getAuth().currentUser
		const idToken = user ? await user.getIdToken(true) : null
		return idToken
	}

	/**
	 * Converts Firebase User object to a generic user object.
	 * @param user - The Firebase User object.
	 * @returns {User} A generic user object.
	 */
	convertUserData(user: User) {
		return {
			uid: user.uid,
			email: user.email,
			displayName: user.displayName,
			photoUrl: user.photoURL,
		}
	}

	/**
	 * Signs out the current user from Firebase.
	 * @returns {Promise<void>} A promise that resolves when the user is signed out.
	 */
	async signOut(): Promise<void> {
		signOut(getAuth(initializeApp(Object.assign({}, this._config))))
			.then(() => {
				console.log("User signed out successfully.")
			})
			.catch((error) => {
				ErrorService.logMessage("Firebase sign-out error", "error")
				ErrorService.logException(error)
				throw error
			})
	}

	/**
	 * Restores the authentication token using a provided token.
	 * @param token - The authentication token to restore.
	 * @returns {Promise<User>} A promise that resolves with the authenticated user.
	 * @throws {Error} Throws an error if the restoration fails.
	 */
	async restoreAuthCredential(context: ExtensionContext): Promise<User | null> {
		const userRefreshToken = await getSecret(context, "clineAccountId")
		if (!userRefreshToken) {
			console.error("No stored authentication credential found.")
			return null
		}
		try {
			// Step 1: Exchange refresh token for new access token using Firebase's secure token endpoint
			// https://stackoverflow.com/questions/38233687/how-to-use-the-firebase-refreshtoken-to-reauthenticate/57119131#57119131
			const firebaseApiKey = this._config.apiKey
			const googleAccessTokenResponse = await axios.post(
				`https://securetoken.googleapis.com/v1/token?key=${firebaseApiKey}`,
				`grant_type=refresh_token&refresh_token=${userRefreshToken}`, // NOTE: we need to make sure to pass in the refreshToken and not the idToken JWT
				{
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
					},
				},
			)

			// console.log("googleAccessTokenResponse", googleAccessTokenResponse)

			// This returns an object with access_token, expires_in (3600), id_token (can be used as bearer token to authenticate requests, we'll use this in the future instead of firebase but need to be aware of how we use firebase sdk for e.g. user info like the profile image), project_id, refresh_token, token_type (always Bearer), and user_id
			const googleAccessIdToken = googleAccessTokenResponse.data.id_token

			// Step 2: Exchange access token for custom token from our backend (backend has the admin key, which firebase requires to create a custom token)
			const customTokenResponse = await axios.post(
				"https://api.cline.bot/api/v1/users/getauthtoken",
				{
					user_id: "",
					id_token: googleAccessIdToken,
				},
				{
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${googleAccessIdToken}`,
					},
				},
			)

			const customToken = customTokenResponse.data.token

			// Step 3: Use the custom token to sign in with Firebase and create a user object (we then use user.getIdToken() to refresh the access token periodically)
			const firebaseConfig = Object.assign({}, this._config)
			const app = initializeApp(firebaseConfig)
			const auth = getAuth(app)
			// signs user into firebase sdk internally
			const user = (await signInWithCustomToken(auth, customToken)).user
			return user

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
	async signIn(context: ExtensionContext, token: string, provider: string): Promise<User> {
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
			const user = (await signInWithCredential(auth, credential)).user
			// store the long-lived refresh token in secret storage. this will be used in the future to re-signin the user using restoreAuthCredential above.
			try {
				await storeSecret(context, "clineAccountId", user.refreshToken)
			} catch (error) {
				ErrorService.logMessage("Firebase store token error", "error")
				ErrorService.logException(error)
				throw error
			}
			return user
		} catch (error) {
			ErrorService.logMessage("Firebase sign-in error", "error")
			ErrorService.logException(error)
			throw error
		}
	}
}
