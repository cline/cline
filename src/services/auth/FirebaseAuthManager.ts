import { initializeApp } from "firebase/app"
import {
	Auth,
	User,
	browserLocalPersistence,
	getAuth,
	onAuthStateChanged,
	setPersistence,
	signInWithCustomToken,
	signOut,
	AuthError as FirebaseAuthError
} from "firebase/auth"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { firebaseConfig } from "./config"

enum AuthErrorType {
	Network = 'network',
	InvalidToken = 'invalid_token',
	Other = 'other'
}

interface AuthError {
	type: AuthErrorType
	message: string
	originalError?: any
}

interface RetryConfig {
	maxAttempts: number
	baseDelay: number  // in ms
	maxDelay: number   // in ms
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxAttempts: 3,
	baseDelay: 1000,
	maxDelay: 10000
}

export interface UserInfo {
	displayName: string | null
	email: string | null
	photoURL: string | null
}

export class FirebaseAuthManager {
	private providerRef: WeakRef<ClineProvider>
	private auth: Auth
	private disposables: vscode.Disposable[] = []
	private isInitialAuthState = true

	constructor(provider: ClineProvider) {
		console.log("Initializing FirebaseAuthManager", { provider })
		this.providerRef = new WeakRef(provider)
		
		try {
			const app = initializeApp(firebaseConfig)
			this.auth = getAuth(app)
			console.log("Firebase app initialized", { appConfig: firebaseConfig })

			// Set persistence to LOCAL to maintain auth state across sessions
			this.setupPersistence()

			// Auth state listener
			const unsubscribe = onAuthStateChanged(this.auth, this.handleAuthStateChange.bind(this))
			this.disposables.push({ dispose: () => unsubscribe() })
			console.log("Auth state change listener added")
		} catch (error) {
			console.error("Error initializing FirebaseAuthManager:", error)
			throw error
		}
	}

	private async setupPersistence() {
		try {
			await this.retryWithBackoff(async () => {
				await setPersistence(this.auth, browserLocalPersistence)
				console.log("Firebase persistence set to LOCAL")
			})
		} catch (error) {
			const authError = this.classifyError(error)
			console.error("Failed to set persistence after retries:", authError)
			// Don't throw - persistence failure shouldn't prevent auth initialization
			// But we should log it clearly for debugging
			vscode.window.showErrorMessage("Warning: Failed to set authentication persistence. You may need to log in more frequently.")
		}
	}

	private classifyError(error: any): AuthError {
		console.log("Classifying auth error:", error)
		
		if (error?.code === "auth/network-request-failed") {
			return {
				type: AuthErrorType.Network,
				message: "Network error during authentication",
				originalError: error
			}
		}
		
		if (error?.code === "auth/invalid-custom-token" || 
			error?.code === "auth/custom-token-mismatch" ||
			error?.code === "auth/argument-error") {
			return {
				type: AuthErrorType.InvalidToken,
				message: "Invalid authentication token",
				originalError: error
			}
		}
		
		return {
			type: AuthErrorType.Other,
			message: error?.message || "Unknown authentication error",
			originalError: error
		}
	}

	private async delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms))
	}

	private async retryWithBackoff<T>(
		operation: () => Promise<T>,
		config: RetryConfig = DEFAULT_RETRY_CONFIG
	): Promise<T> {
		let lastError: any
		
		for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
			try {
				console.log(`Attempting operation (attempt ${attempt}/${config.maxAttempts})`)
				return await operation()
			} catch (error) {
				lastError = error
				const authError = this.classifyError(error)
				
				// Don't retry for invalid token errors
				if (authError.type === AuthErrorType.InvalidToken) {
					console.log("Invalid token error - not retrying:", authError)
					throw error
				}
				
				if (attempt === config.maxAttempts) {
					console.error(`All ${config.maxAttempts} attempts failed:`, authError)
					throw error
				}
				
				// Calculate delay with exponential backoff
				const delay = Math.min(
					config.baseDelay * Math.pow(2, attempt - 1),
					config.maxDelay
				)
				
				console.log(`Attempt ${attempt} failed, retrying in ${delay}ms:`, authError)
				await this.delay(delay)
			}
		}
		
		throw lastError
	}

	private async restoreSession() {
		console.log("Attempting to restore session")
		const provider = this.providerRef.deref()
		if (!provider) {
			console.log("Provider reference lost during session restore")
			return
		}

		// If no active session, try to sign in with stored custom token
		const storedToken = await provider.getSecret("authToken")
		if (storedToken) {
			console.log("Found stored custom token, attempting to restore session")
			try {
				await this.retryWithBackoff(async () => {
					await this.signInWithCustomToken(storedToken)
					console.log("Session restored successfully with custom token")
				})
			} catch (error) {
				const authError = this.classifyError(error)
				console.error("Failed to restore session with custom token:", authError)
				
				if (authError.type === AuthErrorType.InvalidToken) {
					// Only clean up state for invalid token errors
					console.log("Invalid token detected - cleaning up auth state")
					await this.cleanupFailedAuth(provider)
				} else if (authError.type === AuthErrorType.Network) {
					// For network errors, preserve the token and throw to allow retry
					console.log("Network error during session restore - will retry later")
					throw error
				} else {
					// For other errors, log but preserve the token
					console.log("Non-critical error during session restore - preserving token for retry")
					console.error("Error details:", authError)
				}
			}
		} else {
			console.log("No stored custom token found")
		}
	}

	private async cleanupFailedAuth(provider: ClineProvider) {
		console.log("Cleaning up failed authentication state")
		try {
			// First clear user info since it's less critical
			await provider.setUserInfo(undefined)
			console.log("User info cleared")
			
			// Then clear auth token and sign out
			await provider.setAuthToken(undefined)
			console.log("Auth token cleared")
			
			await this.signOut()
			console.log("Authentication state cleaned up successfully")
		} catch (error) {
			console.error("Error during auth state cleanup:", error)
			// Even if cleanup fails, we want to ensure the token is cleared for security
			try {
				await provider.setAuthToken(undefined)
				console.log("Auth token cleared after cleanup error")
			} catch (tokenError) {
				console.error("Critical: Failed to clear auth token:", tokenError)
				// At this point, we've tried our best to clean up
			}
		}
	}

	getCurrentUser(): User | null {
		return this.auth.currentUser
	}

	private async handleAuthStateChange(user: User | null) {
		console.log("Auth state changed", { 
			user: user ? { 
				uid: user.uid,
				email: user.email,
				emailVerified: user.emailVerified,
				isAnonymous: user.isAnonymous,
				metadata: user.metadata
			} : null,
			isInitialState: this.isInitialAuthState
		})

		const provider = this.providerRef.deref()
		if (!provider) {
			console.error("Provider reference lost during auth state change")
			return
		}

		try {
			if (user) {
				console.log("User signed in", {
					userId: user.uid,
					lastLoginAt: user.metadata.lastSignInTime,
					createdAt: user.metadata.creationTime
				})

				// Store public user info in state
				const userInfo = {
					displayName: user.displayName,
					email: user.email,
					photoURL: user.photoURL,
				}
				await provider.setUserInfo(userInfo)
				console.log("User info set in provider", { userInfo })

			} else if (!this.isInitialAuthState) {
				// Only clear auth state if this isn't the initial null state
				console.log("User signed out (not initial state)")
				await this.retryWithBackoff(async () => {
					await provider.setAuthToken(undefined)
					await provider.setUserInfo(undefined)
				})
			} else {
				console.log("Initial auth state is null, attempting session restore")
				this.isInitialAuthState = false
				try {
					await this.restoreSession()
				} catch (error) {
					const authError = this.classifyError(error)
					if (authError.type === AuthErrorType.Network) {
						console.log("Session restore failed due to network error - will retry on next auth state change")
						// Keep isInitialAuthState true so we retry on next change
						this.isInitialAuthState = true
					} else {
						console.error("Session restore failed with non-network error:", authError)
					}
				}
			}

			await provider.postStateToWebview()
			console.log("Webview state updated after auth state change")
		} catch (error) {
			console.error("Error handling auth state change:", error)
			// Attempt to clean up state if something went wrong
			try {
				await this.cleanupFailedAuth(provider)
			} catch (cleanupError) {
				console.error("Failed to cleanup after auth state change error:", cleanupError)
			}
		}
	}

	async signInWithCustomToken(token: string) {
		console.log("Signing in with custom token")
		try {
			await this.retryWithBackoff(async () => {
				await signInWithCustomToken(this.auth, token)
				console.log("Successfully signed in with custom token")
			})
		} catch (error) {
			const authError = this.classifyError(error)
			console.error("Failed to sign in with custom token:", authError)
			throw error
		}
	}

	async signOut() {
		console.log("Signing out")
		this.isInitialAuthState = false // Ensure we treat the next null state as a real sign out
		await signOut(this.auth)
	}

	dispose() {
		this.disposables.forEach((d) => d.dispose())
		console.log("Disposables disposed", { count: this.disposables.length })
	}
}
