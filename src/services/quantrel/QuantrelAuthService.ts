import type { StateManager } from "../../core/storage/StateManager"

/**
 * Quantrel Authentication Response from /api/auth/login
 */
export interface QuantrelAuthResponse {
	accessToken: string
	refreshToken: string
	tokenType: string
	expiresIn: number // 7 days in seconds (604800)
	refreshExpiresIn: number // 14 days in seconds (1209600)
}

/**
 * User info from /api/auth/me
 */
export interface QuantrelUserInfo {
	exp: string // Expiration timestamp
	iat: string // Issued at timestamp
	issuer: string
	email: string
	sub: string // "user:{userId}"
	serverTime: string
	scope: string // Space-separated roles (e.g., "ROLE_ADMIN ROLE_USER")
}

/**
 * Quantrel Authentication Service
 * Handles JWT token management, login, logout, and auto-refresh
 */
export class QuantrelAuthService {
	private stateManager: StateManager
	private baseUrl: string
	private refreshTimerId: NodeJS.Timeout | undefined

	constructor(stateManager: StateManager, baseUrl?: string) {
		this.stateManager = stateManager
		this.baseUrl = baseUrl || "http://localhost:8080"
	}

	/**
	 * Initialize authentication on extension startup
	 * Validates stored token and starts refresh timer
	 */
	async initialize(): Promise<boolean> {
		const accessToken = this.stateManager.getSecretKey("quantrelAccessToken")

		if (!accessToken) {
			return false
		}

		// Validate token
		const isValid = await this.validateToken()
		if (!isValid) {
			await this.logout()
			return false
		}

		// Start auto-refresh timer
		this.startRefreshTimer()

		return true
	}

	/**
	 * Login with email and password
	 */
	async login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
		try {
			const response = await fetch(`${this.baseUrl}/api/auth/login`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ email, password }),
			})

			if (!response.ok) {
				const error = await response.text()
				return { success: false, error: `Login failed: ${error}` }
			}

			const data: QuantrelAuthResponse = await response.json()

			// Store tokens securely
			await this.storeTokens(data.accessToken, data.refreshToken, email)

			// Start auto-refresh timer
			this.startRefreshTimer()

			return { success: true }
		} catch (error) {
			return { success: false, error: `Network error: ${error instanceof Error ? error.message : String(error)}` }
		}
	}

	/**
	 * Logout and clear all stored tokens
	 */
	async logout(): Promise<void> {
		// Stop refresh timer
		if (this.refreshTimerId) {
			clearTimeout(this.refreshTimerId)
			this.refreshTimerId = undefined
		}

		// Call backend logout endpoint (optional - tokens are stateless JWT)
		const accessToken = this.stateManager.getSecretKey("quantrelAccessToken")
		if (accessToken) {
			try {
				await fetch(`${this.baseUrl}/api/auth/logout`, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${accessToken}`,
					},
				})
			} catch (error) {
				// Ignore errors - clear local tokens anyway
				console.error("Logout request failed:", error)
			}
		}

		// Clear stored tokens
		this.stateManager.setSecret("quantrelAccessToken", undefined)
		this.stateManager.setSecret("quantrelRefreshToken", undefined)
		this.stateManager.setState("quantrelUserEmail", undefined)
	}

	/**
	 * Validate current access token
	 */
	async validateToken(): Promise<boolean> {
		const accessToken = this.stateManager.getSecretKey("quantrelAccessToken")

		if (!accessToken) {
			return false
		}

		try {
			const response = await fetch(`${this.baseUrl}/api/auth/me`, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			})

			return response.ok
		} catch (error) {
			console.error("Token validation failed:", error)
			return false
		}
	}

	/**
	 * Get current user info
	 */
	async getUserInfo(): Promise<QuantrelUserInfo | null> {
		const accessToken = this.stateManager.getSecretKey("quantrelAccessToken")

		if (!accessToken) {
			return null
		}

		try {
			const response = await fetch(`${this.baseUrl}/api/auth/me`, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			})

			if (!response.ok) {
				return null
			}

			return await response.json()
		} catch (error) {
			console.error("Failed to get user info:", error)
			return null
		}
	}

	/**
	 * Refresh access token using refresh token
	 */
	async refreshToken(): Promise<{ success: boolean; error?: string }> {
		const refreshToken = this.stateManager.getSecretKey("quantrelRefreshToken")

		if (!refreshToken) {
			return { success: false, error: "No refresh token available" }
		}

		try {
			const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ refreshToken }),
			})

			if (!response.ok) {
				const error = await response.text()
				return { success: false, error: `Token refresh failed: ${error}` }
			}

			const data: QuantrelAuthResponse = await response.json()

			// Store new tokens (backend rotates refresh token)
			const email = this.stateManager.getState("quantrelUserEmail")
			await this.storeTokens(data.accessToken, data.refreshToken, email)

			return { success: true }
		} catch (error) {
			return { success: false, error: `Network error: ${error instanceof Error ? error.message : String(error)}` }
		}
	}

	/**
	 * Get current access token
	 */
	getAccessToken(): string | undefined {
		return this.stateManager.getSecretKey("quantrelAccessToken")
	}

	/**
	 * Check if user is authenticated
	 */
	isAuthenticated(): boolean {
		return !!this.stateManager.getSecretKey("quantrelAccessToken")
	}

	/**
	 * Get stored user email
	 */
	getUserEmail(): string | undefined {
		return this.stateManager.getState("quantrelUserEmail")
	}

	/**
	 * Store tokens securely in VS Code SecretStorage
	 */
	private async storeTokens(accessToken: string, refreshToken: string, email: string | undefined): Promise<void> {
		this.stateManager.setSecret("quantrelAccessToken", accessToken)
		this.stateManager.setSecret("quantrelRefreshToken", refreshToken)
		if (email) {
			this.stateManager.setState("quantrelUserEmail", email)
		}
	}

	/**
	 * Start auto-refresh timer
	 * Refreshes token 1 day before expiration (access token expires in 7 days)
	 */
	private startRefreshTimer(): void {
		// Stop existing timer
		if (this.refreshTimerId) {
			clearTimeout(this.refreshTimerId)
		}

		// Access token expires in 7 days (604800 seconds)
		// Refresh 1 day before expiration = 6 days = 518400 seconds
		const refreshInterval = 6 * 24 * 60 * 60 * 1000 // 6 days in milliseconds

		this.refreshTimerId = setTimeout(async () => {
			const result = await this.refreshToken()
			if (result.success) {
				// Restart timer after successful refresh
				this.startRefreshTimer()
			} else {
				console.error("Auto-refresh failed:", result.error)
				// Token expired, user needs to re-login
			}
		}, refreshInterval)
	}

	/**
	 * Cleanup on extension deactivation
	 */
	dispose(): void {
		if (this.refreshTimerId) {
			clearTimeout(this.refreshTimerId)
			this.refreshTimerId = undefined
		}
	}
}
