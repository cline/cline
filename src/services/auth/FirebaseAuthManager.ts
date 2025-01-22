import { initializeApp } from "firebase/app"
import { Auth, User, getAuth, onAuthStateChanged, signInWithCustomToken, signOut } from "firebase/auth"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { firebaseConfig } from "./config"

export interface UserInfo {
	displayName: string | null
	email: string | null
	photoURL: string | null
}

export class FirebaseAuthManager {
	private providerRef: WeakRef<ClineProvider>
	private auth: Auth
	private disposables: vscode.Disposable[] = []

	constructor(provider: ClineProvider) {
		console.log("Initializing FirebaseAuthManager", { provider })
		this.providerRef = new WeakRef(provider)
		const app = initializeApp(firebaseConfig)
		this.auth = getAuth(app)
		console.log("Firebase app initialized", { appConfig: firebaseConfig })

		// Auth state listener
		onAuthStateChanged(this.auth, this.handleAuthStateChange.bind(this))
		console.log("Auth state change listener added")

		// Try to restore session
		this.restoreSession()
	}

	private async restoreSession() {
		console.log("Attempting to restore session")
		const provider = this.providerRef.deref()
		if (!provider) {
			console.log("Provider reference lost during session restore")
			return
		}

		const storedToken = await provider.getSecret("authToken")
		if (storedToken) {
			console.log("Found stored auth token, attempting to restore session")
			try {
				await this.signInWithCustomToken(storedToken)
				console.log("Session restored successfully")
			} catch (error) {
				console.error("Failed to restore session, clearing token:", error)
				await provider.setAuthToken(undefined)
				await provider.setUserInfo(undefined)
			}
		} else {
			console.log("No stored auth token found")
		}
	}

	private async handleAuthStateChange(user: User | null) {
		console.log("Auth state changed", { user })
		const provider = this.providerRef.deref()
		if (!provider) {
			console.log("Provider reference lost")
			return
		}

		if (user) {
			console.log("User signed in", { userId: user.uid })
			const idToken = await user.getIdToken()
			await provider.setAuthToken(idToken)
			// Store public user info in state
			await provider.setUserInfo({
				displayName: user.displayName,
				email: user.email,
				photoURL: user.photoURL,
			})
			console.log("User info set in provider", { user })
		} else {
			console.log("User signed out")
			await provider.setAuthToken(undefined)
			await provider.setUserInfo(undefined)
		}
		await provider.postStateToWebview()
		console.log("Webview state updated")
	}

	async signInWithCustomToken(token: string) {
		console.log("Signing in with custom token", { token })
		await signInWithCustomToken(this.auth, token)
	}

	async signOut() {
		console.log("Signing out")
		await signOut(this.auth)
	}

	dispose() {
		this.disposables.forEach((d) => d.dispose())
		console.log("Disposables disposed", { count: this.disposables.length })
	}
}
