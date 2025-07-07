import { ErrorService } from "@/services/error/ErrorService"
import { initializeApp } from "firebase/app"
import { GoogleAuthProvider, User, getAuth, signInWithCredential, signInWithCustomToken, signOut } from "firebase/auth"

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
	 * Signs in the user using Firebase authentication with a custom token.
	 * @returns {Promise<User>} A promise that resolves with the authenticated user.
	 * @throws {Error} Throws an error if the sign-in fails.
	 */
	async signIn(token: string, custom?: boolean): Promise<User> {
		const firebaseConfig = Object.assign({}, this._config)
		const app = initializeApp(firebaseConfig)
		const auth = getAuth(app)

		try {
			let credential
			let userCredential
			if (custom) {
				// TODO: Move ApiKey to a variable
				const url = `https://securetoken.googleapis.com/v1/token?key=${"AIzaSyASSwkwX1kSO8vddjZkE5N19QU9cVQ0CIk"}` // Replace with your actual API key;
				const params = new URLSearchParams()
				params.append("grant_type", "refresh_token")
				params.append("refresh_token", token)

				// use fetch to make a POST request to the URL
				const response = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: params.toString(),
				})
				if (!response.ok) {
					throw new Error(`Failed to sign in with custom token: ${response.statusText}`)
				}
				const data = await response.json()
				const rehydratedToken = data.id_token // Use the id_token from the response
				userCredential = await signInWithCustomToken(auth, rehydratedToken)
			} else {
				credential = GoogleAuthProvider.credential(token)
				userCredential = await signInWithCredential(auth, credential)
			}
			return userCredential.user
		} catch (error) {
			ErrorService.logMessage("Firebase sign-in error", "error")
			ErrorService.logException(error)
			throw error
		}
	}
}
