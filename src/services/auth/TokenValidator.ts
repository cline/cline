/**
 * Utility class for validating authentication tokens
 */
export class TokenValidator {
	private static readonly MIN_TOKEN_LIFETIME = 60000 // 1 minute
	private static readonly TOKEN_REFRESH_BUFFER = 300000 // 5 minutes

	/**
	 * Validates if a token is still valid and not expired
	 */
	static isTokenValid(user: any): boolean {
		if (!user) {
			return false
		}

		// Check if user has required token manager
		if (!user.stsTokenManager) {
			console.warn("User object missing stsTokenManager")
			return false
		}

		const { expirationTime, accessToken } = user.stsTokenManager

		// Check if token exists
		if (!accessToken) {
			console.warn("User missing access token")
			return false
		}

		// Check if expiration time is valid
		if (!expirationTime || typeof expirationTime !== "number") {
			console.warn("Invalid or missing token expiration time")
			return false
		}

		// Check if token is expired
		const now = Date.now()
		if (expirationTime <= now) {
			console.warn("Token has expired")
			return false
		}

		// Check if token has sufficient remaining lifetime
		const remainingTime = expirationTime - now
		if (remainingTime < TokenValidator.MIN_TOKEN_LIFETIME) {
			console.warn(`Token expires too soon (${remainingTime}ms remaining)`)
			return false
		}

		return true
	}

	/**
	 * Checks if a token needs to be refreshed soon
	 */
	static shouldRefreshToken(user: any): boolean {
		if (!user || !user.stsTokenManager) {
			return false
		}

		const { expirationTime } = user.stsTokenManager
		if (!expirationTime || typeof expirationTime !== "number") {
			return false
		}

		const now = Date.now()
		const timeUntilExpiration = expirationTime - now

		// Refresh if token expires within the buffer time
		return timeUntilExpiration <= TokenValidator.TOKEN_REFRESH_BUFFER
	}

	/**
	 * Calculates a safe timeout duration for token refresh scheduling
	 */
	static calculateRefreshTimeout(user: any): number {
		if (!user || !user.stsTokenManager) {
			return 0
		}

		const { expirationTime } = user.stsTokenManager
		if (!expirationTime || typeof expirationTime !== "number") {
			return 0
		}

		const now = Date.now()
		const timeUntilExpiration = expirationTime - now

		// If token is already expired or expires very soon, refresh immediately
		if (timeUntilExpiration <= TokenValidator.MIN_TOKEN_LIFETIME) {
			return 0
		}

		// Schedule refresh 5 minutes before expiration, but ensure minimum delay
		const refreshTime = timeUntilExpiration - TokenValidator.TOKEN_REFRESH_BUFFER
		const minDelay = 30000 // 30 seconds minimum delay
		const maxDelay = 3600000 // 1 hour maximum delay

		return Math.max(minDelay, Math.min(refreshTime, maxDelay))
	}

	/**
	 * Validates token structure and format
	 */
	static validateTokenStructure(user: any): { isValid: boolean; errors: string[] } {
		const errors: string[] = []

		if (!user) {
			errors.push("User object is null or undefined")
			return { isValid: false, errors }
		}

		if (!user.uid) {
			errors.push("User missing uid")
		}

		if (!user.stsTokenManager) {
			errors.push("User missing stsTokenManager")
			return { isValid: false, errors }
		}

		const { accessToken, refreshToken, expirationTime } = user.stsTokenManager

		if (!accessToken) {
			errors.push("Missing access token")
		}

		if (!refreshToken) {
			errors.push("Missing refresh token")
		}

		if (!expirationTime) {
			errors.push("Missing expiration time")
		} else if (typeof expirationTime !== "number") {
			errors.push("Invalid expiration time format")
		} else if (expirationTime <= 0) {
			errors.push("Invalid expiration time value")
		}

		return {
			isValid: errors.length === 0,
			errors,
		}
	}

	/**
	 * Gets human-readable time until token expiration
	 */
	static getTimeUntilExpiration(user: any): string {
		if (!user || !user.stsTokenManager || !user.stsTokenManager.expirationTime) {
			return "Unknown"
		}

		const now = Date.now()
		const expirationTime = user.stsTokenManager.expirationTime
		const timeRemaining = expirationTime - now

		if (timeRemaining <= 0) {
			return "Expired"
		}

		const minutes = Math.floor(timeRemaining / 60000)
		const seconds = Math.floor((timeRemaining % 60000) / 1000)

		if (minutes > 0) {
			return `${minutes}m ${seconds}s`
		} else {
			return `${seconds}s`
		}
	}
}
