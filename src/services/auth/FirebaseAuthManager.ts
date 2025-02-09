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
	AuthError as FirebaseAuthError,
} from "firebase/auth"
import * as vscode from "vscode"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { firebaseConfig } from "./config"

enum AuthErrorType {
	Network = "network",
	InvalidToken = "invalid_token",
	ExpiredToken = "expired_token",
	TokenMismatch = "token_mismatch",
	Other = "other",
}

interface AuthError {
	type: AuthErrorType
	message: string
	originalError?: any
}

interface RetryConfig {
	maxAttempts: number
	baseDelay: number // in ms
	maxDelay: number // in ms
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxAttempts: 3,
	baseDelay: 1000,
	maxDelay: 10000,
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
			vscode.window.showErrorMessage(
				"Warning: Failed to set authentication persistence. You may need to log in more frequently.",
			)
		}
	}

	private classifyError(error: any): AuthError {
		console.log("Classifying auth error:", error)

		if (error?.code === "auth/network-request-failed") {
			return {
				type: AuthErrorType.Network,
				message: "Network error during authentication",
				originalError: error,
			}
		}

		// Only consider a token invalid if it's explicitly invalid or malformed
		if (error?.code === "auth/invalid-custom-token" || error?.code === "auth/argument-error") {
			return {
				type: AuthErrorType.InvalidToken,
				message: "Invalid authentication token format",
				originalError: error,
			}
		}

		// Token mismatch indicates the token might be for a different project/environment
		if (error?.code === "auth/custom-token-mismatch") {
			return {
				type: AuthErrorType.TokenMismatch,
				message: "Token mismatch - may be for different environment",
				originalError: error,
			}
		}

		// Handle expired tokens separately
		if (error?.code === "auth/user-token-expired") {
			return {
				type: AuthErrorType.ExpiredToken,
				message: "Authentication token has expired",
				originalError: error,
			}
		}

		return {
			type: AuthErrorType.Other,
			message: error?.message || "Unknown authentication error",
			originalError: error,
		}
	}

	private async delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	private async retryWithBackoff<T>(operation: () => Promise<T>, config: RetryConfig = DEFAULT_RETRY_CONFIG): Promise<T> {
		let lastError: any

		for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
			try {
				console.log(`Attempting operation (attempt ${attempt}/${config.maxAttempts})`)
				return await operation()
			} catch (error) {
				lastError = error
				const authError = this.classifyError(error)

				// Don't retry for token-related errors
				if (
					authError.type === AuthErrorType.InvalidToken ||
					authError.type === AuthErrorType.TokenMismatch ||
					authError.type === AuthErrorType.ExpiredToken
				) {
					console.log("Token-related error - not retrying:", authError)
					throw error
				}

				if (attempt === config.maxAttempts) {
					console.error(`All ${config.maxAttempts} attempts failed:`, authError)
					throw error
				}

				// Calculate delay with exponential backoff
				const delay = Math.min(config.baseDelay * Math.pow(2, attempt - 1), config.maxDelay)

				console.log(`Attempt ${attempt} failed, retrying in ${delay}ms:`, authError)
				await this.delay(delay)
			}
		}

		throw lastError
	}

	private async cleanupFailedAuth(provider: ClineProvider, error: AuthError) {
		console.log("Cleaning up failed authentication state", { errorType: error.type })
		try {
			// Clear user info since it's no longer valid
			await provider.setUserInfo(undefined)
			console.log("User info cleared")

			// We no longer clear the auth token here - it will only be cleared on explicit user logout
			// Instead, we just sign out of Firebase if needed
			if (
				error.type === AuthErrorType.InvalidToken ||
				error.type === AuthErrorType.TokenMismatch ||
				error.type === AuthErrorType.ExpiredToken
			) {
				console.log("Auth error detected - signing out but preserving token")
				await this.signOut()
			}
		} catch (cleanupError) {
			console.error("Error during auth state cleanup:", cleanupError)
		}
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

				// Clean up Firebase auth state but preserve the token
				await this.cleanupFailedAuth(provider, authError)

				if (authError.type === AuthErrorType.Network) {
					// For network errors, throw to allow retry
					console.log("Network error during session restore - will retry later")
					throw error
				}
			}
		} else {
			console.log("No stored custom token found")
		}
	}

	getCurrentUser(): User | null {
		return this.auth.currentUser
	}

	private async handleAuthStateChange(user: User | null) {
		console.log("Auth state changed", {
			user: user
				? {
						uid: user.uid,
						email: user.email,
						emailVerified: user.emailVerified,
						isAnonymous: user.isAnonymous,
						metadata: user.metadata,
					}
				: null,
			isInitialState: this.isInitialAuthState,
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
					createdAt: user.metadata.creationTime,
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
				// Only clear user info if this isn't the initial null state
				console.log("User signed out (not initial state)")
				await provider.setUserInfo(undefined)
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
			const authError = this.classifyError(error)
			await this.cleanupFailedAuth(provider, authError)
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
