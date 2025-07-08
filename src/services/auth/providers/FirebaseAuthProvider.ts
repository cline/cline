import { getSecret, storeSecret } from "@/core/storage/state"
import { ErrorService } from "@/services/error/ErrorService"
import { initializeApp } from "firebase/app"
import {
	AuthCredential,
	GoogleAuthProvider,
	GithubAuthProvider,
	OAuthCredential,
	User,
	UserCredential,
	getAuth,
	signInWithCredential,
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
	 * Gets the refresh token of the current user.
	 * @returns {Promise<string | null>} A promise that resolves to the refresh token of the current user, or null if no user is signed in.
	 */
	async getRefreshToken(): Promise<string | null> {
		const user = getAuth().currentUser
		const refreshToken = user ? user.refreshToken : null
		return refreshToken
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
	 * Stores the authentication token using a provided token.
	 * @param token - The authentication token to store.
	 * @returns {Promise<User>} A promise that resolves with the authenticated user.
	 * @throws {Error} Throws an error if the storage fails.
	 */
	private async _storeAuthCredential(context: ExtensionContext, credential: AuthCredential): Promise<void> {
		try {
			await storeSecret(context, "clineAccountId", JSON.stringify(credential.toJSON()))
		} catch (error) {
			ErrorService.logMessage("Firebase store token error", "error")
			ErrorService.logException(error)
			throw error
		}
	}

	/**
	 * Restores the authentication token using a provided token.
	 * @param token - The authentication token to restore.
	 * @returns {Promise<User>} A promise that resolves with the authenticated user.
	 * @throws {Error} Throws an error if the restoration fails.
	 */
	async restoreAuthCredential(context: ExtensionContext): Promise<User | null> {
		const credentialJSON = await getSecret(context, "clineAccountId")
		if (!credentialJSON) {
			console.error("No stored authentication credential found.")
			return null
		}
		try {
			const credentialData: AuthCredential = OAuthCredential.fromJSON(credentialJSON) as AuthCredential
			const userCredential = await this._signInWithCredential(credentialData)
			return userCredential.user
		} catch (error) {
			ErrorService.logMessage("Firebase restore token error", "error")
			ErrorService.logException(error)
			throw error
		}
	}

	async _signInWithCredential(credential: AuthCredential): Promise<UserCredential> {
		const firebaseConfig = Object.assign({}, this._config)
		const app = initializeApp(firebaseConfig)
		const auth = getAuth(app)
		try {
			return await signInWithCredential(auth, credential)
		} catch (error) {
			ErrorService.logMessage("Firebase sign-in with credential error", "error")
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
			let userCredential
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
			this._storeAuthCredential(context, credential)
			userCredential = await this._signInWithCredential(credential)
			return userCredential.user
		} catch (error) {
			ErrorService.logMessage("Firebase sign-in error", "error")
			ErrorService.logException(error)
			throw error
		}
	}
}
