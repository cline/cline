import { vscode } from "../../utils/vscode"

export class CursorAuthError extends Error {
	type: "auth_error" | "network_error" | "timeout_error" | "unknown_error"
	details?: unknown

	constructor(message: string, type: "auth_error" | "network_error" | "timeout_error" | "unknown_error", details?: unknown) {
		super(message)
		this.name = "CursorAuthError"
		this.type = type
		this.details = details
		Object.setPrototypeOf(this, CursorAuthError.prototype)
	}
}

// Constants for token refresh timing
export const TOKEN_REFRESH_INTERVAL = 3300000 // 55 minutes in milliseconds
export const TOKEN_EXPIRY = 3600000 // 1 hour in milliseconds
export const CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB"

/**
 * Generates a PKCE verifier string
 * @returns A random base64URL-encoded string for PKCE verification
 * @throws {Error} If crypto API is not available
 */
export function generatePKCEVerifier(): string {
	if (!window.crypto || !window.crypto.getRandomValues) {
		throw new Error("Crypto API is not available")
	}

	const array = new Uint8Array(32)
	window.crypto.getRandomValues(array)
	const base64 = window.btoa(
		Array.from(array)
			.map((b) => String.fromCharCode(b))
			.join(""),
	)
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

/**
 * Generates a PKCE challenge from a verifier
 * @param verifier The PKCE verifier string
 * @returns A base64URL-encoded SHA-256 hash of the verifier
 * @throws {Error} If crypto API is not available
 */
export async function generatePKCEChallenge(verifier: string): Promise<string> {
	if (!window.crypto || !window.crypto.subtle) {
		throw new Error("Crypto API is not available")
	}

	const encoder = new TextEncoder()
	const verifierBytes = encoder.encode(verifier)
	const hashBuffer = await window.crypto.subtle.digest("SHA-256", verifierBytes)
	const base64 = window.btoa(
		Array.from(new Uint8Array(hashBuffer))
			.map((b) => String.fromCharCode(b))
			.join(""),
	)
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

/**
 * Initiates the Cursor authentication flow
 * @param onSuccess Callback for successful authentication
 * @param onError Callback for authentication errors
 */
export async function initiateCursorAuth(
	onSuccess: (accessToken: string, refreshToken: string) => void,
	onError: (error: CursorAuthError) => void,
): Promise<void> {
	try {
		const pkceVerifier = generatePKCEVerifier()
		const pkceChallenge = await generatePKCEChallenge(pkceVerifier)
		const uuid = crypto.randomUUID()

		// Log auth flow start for debugging
		vscode.postMessage({ type: "log", text: "🔐 [CURSOR AUTH] ========== AUTH FLOW STARTED ==========" })
		vscode.postMessage({ type: "log", text: `🔐 [CURSOR AUTH] UUID: ${uuid}` })
		vscode.postMessage({ type: "log", text: `🔐 [CURSOR AUTH] Verifier length: ${pkceVerifier.length}` })
		vscode.postMessage({ type: "log", text: `🔐 [CURSOR AUTH] Challenge length: ${pkceChallenge.length}` })

		const loginUrl = `https://cursor.sh/loginDeepControl?challenge=${encodeURIComponent(pkceChallenge)}&uuid=${encodeURIComponent(uuid)}`
		vscode.postMessage({ type: "log", text: `🔐 [CURSOR AUTH] Opening login URL: ${loginUrl}` })

		// Open login URL
		vscode.postMessage({
			type: "openExternalUrl",
			url: loginUrl,
		})

		// Start polling
		vscode.postMessage({ type: "log", text: "🔐 [CURSOR AUTH] Starting polling..." })
		vscode.postMessage({ type: "log", text: "🔐 [CURSOR AUTH] ----------------------------------------" })

		vscode.postMessage({
			type: "pollCursorAuth",
			uuid,
			verifier: pkceVerifier,
		})

		// Set up message handler for auth result
		const handleAuthResult = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "cursorAuthSuccess" && message.access_token && message.refresh_token) {
				window.removeEventListener("message", handleAuthResult)
				vscode.postMessage({ type: "log", text: "🔐 [CURSOR AUTH] ========== AUTH FLOW COMPLETED ==========" })
				onSuccess(message.access_token, message.refresh_token)
			} else if (message.type === "cursorAuthError") {
				window.removeEventListener("message", handleAuthResult)
				vscode.postMessage({ type: "log", text: "🔐 [CURSOR AUTH] ========== AUTH FLOW FAILED ==========" })
				vscode.postMessage({ type: "log", text: "🔐 [CURSOR AUTH] Error: " + message.error })
				onError(new CursorAuthError(message.error || "Authentication failed", "auth_error", message.error))
			}
		}

		window.addEventListener("message", handleAuthResult)

		// Set timeout for auth flow
		setTimeout(() => {
			window.removeEventListener("message", handleAuthResult)
			vscode.postMessage({ type: "log", text: "🔐 [CURSOR AUTH] ========== AUTH FLOW TIMED OUT ==========" })
			vscode.postMessage({ type: "log", text: "🔐 [CURSOR AUTH] No response received - user may have cancelled" })
			onError(new CursorAuthError("Authentication timed out", "timeout_error"))
		}, 30000) // 30 second timeout
	} catch (error) {
		vscode.postMessage({ type: "log", text: "🔐 [CURSOR AUTH] ========== AUTH FLOW FAILED ==========" })
		vscode.postMessage({ type: "log", text: "🔐 [CURSOR AUTH] Error: " + error })
		onError(new CursorAuthError(error instanceof Error ? error.message : "Authentication failed", "unknown_error", error))
	}
}

/**
 * Refreshes the Cursor access token
 * @param refreshToken The refresh token to use
 * @returns The new access token and refresh token
 * @throws {CursorAuthError} If the refresh fails
 */
export async function refreshCursorToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string }> {
	try {
		const response = await fetch("https://cursor.us.auth0.com/oauth/token", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				client_id: CLIENT_ID,
				grant_type: "refresh_token",
				refresh_token: refreshToken,
			}),
		})

		if (!response.ok) {
			const errorData = await response.json().catch(() => null)
			vscode.postMessage({ type: "log", text: `❌ Token refresh failed: ${response.status} ${JSON.stringify(errorData)}` })

			if (response.status === 401) {
				throw new CursorAuthError("Authentication failed. Please sign in again.", "auth_error", errorData)
			} else if (response.status === 403) {
				throw new CursorAuthError("Refresh token is invalid or expired. Please sign in again.", "auth_error", errorData)
			} else {
				throw new CursorAuthError(
					`Token refresh failed: ${response.status} ${errorData?.error_description || errorData?.error || "Unknown error"}`,
					"network_error",
					errorData,
				)
			}
		}

		const data = await response.json()
		if (!data.access_token) {
			throw new CursorAuthError("Invalid response from refresh endpoint", "unknown_error", data)
		}

		vscode.postMessage({ type: "log", text: "✅ Token refresh successful" })
		return {
			access_token: data.access_token,
			refresh_token: refreshToken, // Keep the same refresh token
		}
	} catch (error) {
		if (error instanceof CursorAuthError) {
			throw error
		}
		throw new CursorAuthError(error instanceof Error ? error.message : "Token refresh failed", "unknown_error", error)
	}
}
