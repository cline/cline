import { ErrorService } from "@/services/error/ErrorService"
import { initializeApp } from "firebase/app"
import { GoogleAuthProvider, User, getAuth, signInWithCredential, signInWithCustomToken, signOut } from "firebase/auth"

// const DefaultFirebaseAuthDomain = "cline-bot.firebaseapp.com"
// const DefaultFirebaseConfig = {
// 	apiKey: "AIzaSyDcXAaanNgR2_T0dq2oOl5XyKPksYHppVo",
// 	authDomain: DefaultFirebaseAuthDomain,
// 	projectId: "cline-bot",
// 	storageBucket: "cline-bot.firebasestorage.app",
// 	messagingSenderId: "364369702101",
// 	appId: "1:364369702101:web:0013885dcf20b43799c65c",
// 	measurementId: "G-MDPRELSCD1",
// }

const DefaultFirebaseConfig = {
	apiKey: "AIzaSyASSwkwX1kSO8vddjZkE5N19QU9cVQ0CIk",
	authDomain: "cline-staging.firebaseapp.com",
	projectId: "cline-staging",
	storageBucket: "cline-staging.firebasestorage.app",
	messagingSenderId: "853479478430",
	appId: "1:853479478430:web:2de0dba1c63c3262d4578f",
}

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
		return user ? await user.getIdToken() : null
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
		signOut(getAuth(initializeApp(Object.assign({}, DefaultFirebaseConfig, this._config))))
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
	async signIn(token: string): Promise<User> {
		const firebaseConfig = Object.assign({}, DefaultFirebaseConfig, this._config)
		const app = initializeApp(firebaseConfig)
		const auth = getAuth(app)

		try {
			// Replace with your custom token logic
			const credential = GoogleAuthProvider.credential(token)
			console.log("Firebase sign-in with custom token:", token)
			console.log("Firebase credential:", credential)
			// Sign in with the credential
			const userCredential = await signInWithCredential(auth, credential)
			console.log("Firebase userCredential:", userCredential)
			return userCredential.user
		} catch (error) {
			ErrorService.logMessage("Firebase sign-in error", "error")
			ErrorService.logException(error)
			throw error
		}
	}
}
