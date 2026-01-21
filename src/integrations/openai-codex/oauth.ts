import * as crypto from "crypto"
import * as http from "http"
import { URL } from "url"
import type { ExtensionContext } from "vscode"
import { z } from "zod"
import { fetch } from "@/shared/net"

/**
 * OpenAI Codex OAuth Configuration
 *
 * Based on the OpenAI Codex OAuth implementation:
 * - ISSUER: https://auth.openai.com
 * - Authorization endpoint: https://auth.openai.com/oauth/authorize
 * - Token endpoint: https://auth.openai.com/oauth/token
 * - Fixed callback port: 1455
 * - Codex-specific params: codex_cli_simplified_flow=true, originator=cline
 */
export const OPENAI_CODEX_OAUTH_CONFIG = {
	authorizationEndpoint: "https://auth.openai.com/oauth/authorize",
	tokenEndpoint: "https://auth.openai.com/oauth/token",
	clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
	redirectUri: "http://localhost:1455/auth/callback",
	scopes: "openid profile email offline_access",
	callbackPort: 1455,
} as const

// Token storage key
const OPENAI_CODEX_CREDENTIALS_KEY = "openai-codex-oauth-credentials"

// Credentials schema
const openAiCodexCredentialsSchema = z.object({
	type: z.literal("openai-codex"),
	access_token: z.string().min(1),
	refresh_token: z.string().min(1),
	// expires is in milliseconds since epoch
	expires: z.number(),
	email: z.string().optional(),
	// ChatGPT account ID extracted from JWT claims (for ChatGPT-Account-Id header)
	accountId: z.string().optional(),
})

export type OpenAiCodexCredentials = z.infer<typeof openAiCodexCredentialsSchema>

// Token response schema from OpenAI
const tokenResponseSchema = z.object({
	access_token: z.string(),
	refresh_token: z.string().min(1).optional(),
	id_token: z.string().optional(),
	expires_in: z.number(),
	email: z.string().optional(),
	token_type: z.string().optional(),
})

/**
 * JWT claims structure for extracting ChatGPT account ID
 */
interface IdTokenClaims {
	chatgpt_account_id?: string
	organizations?: Array<{ id: string }>
	email?: string
	"https://api.openai.com/auth"?: {
		chatgpt_account_id?: string
	}
}

/**
 * Parse JWT claims from a token
 * Returns undefined if the token is invalid or cannot be parsed
 */
function parseJwtClaims(token: string): IdTokenClaims | undefined {
	const parts = token.split(".")
	if (parts.length !== 3) return undefined
	try {
		// Use base64url decoding (Node.js Buffer handles this)
		const payload = Buffer.from(parts[1], "base64url").toString("utf-8")
		return JSON.parse(payload) as IdTokenClaims
	} catch {
		return undefined
	}
}

/**
 * Extract ChatGPT account ID from JWT claims
 * Checks multiple locations:
 * 1. Root-level chatgpt_account_id
 * 2. Nested under https://api.openai.com/auth
 * 3. First organization ID
 */
function extractAccountIdFromClaims(claims: IdTokenClaims): string | undefined {
	return claims.chatgpt_account_id || claims["https://api.openai.com/auth"]?.chatgpt_account_id || claims.organizations?.[0]?.id
}

/**
 * Extract ChatGPT account ID from token response
 * Tries id_token first, then access_token
 */
function extractAccountId(tokens: { id_token?: string; access_token: string }): string | undefined {
	// Try id_token first (more reliable source)
	if (tokens.id_token) {
		const claims = parseJwtClaims(tokens.id_token)
		const accountId = claims && extractAccountIdFromClaims(claims)
		if (accountId) return accountId
	}
	// Fall back to access_token
	if (tokens.access_token) {
		const claims = parseJwtClaims(tokens.access_token)
		return claims ? extractAccountIdFromClaims(claims) : undefined
	}
	return undefined
}

class OpenAiCodexOAuthTokenError extends Error {
	public readonly status?: number
	public readonly errorCode?: string

	constructor(message: string, opts?: { status?: number; errorCode?: string }) {
		super(message)
		this.name = "OpenAiCodexOAuthTokenError"
		this.status = opts?.status
		this.errorCode = opts?.errorCode
	}

	public isLikelyInvalidGrant(): boolean {
		if (this.errorCode && /invalid_grant/i.test(this.errorCode)) {
			return true
		}
		if (this.status === 400 || this.status === 401 || this.status === 403) {
			return /invalid_grant|revoked|expired|invalid refresh/i.test(this.message)
		}
		return false
	}
}

function parseOAuthErrorDetails(errorText: string): { errorCode?: string; errorMessage?: string } {
	try {
		const json: unknown = JSON.parse(errorText)
		if (!json || typeof json !== "object") {
			return {}
		}

		const obj = json as Record<string, unknown>
		const errorField = obj.error

		const errorCode: string | undefined =
			typeof errorField === "string"
				? errorField
				: errorField && typeof errorField === "object" && typeof (errorField as Record<string, unknown>).type === "string"
					? ((errorField as Record<string, unknown>).type as string)
					: undefined

		const errorDescription = obj.error_description
		const errorMessageFromError =
			errorField && typeof errorField === "object" ? (errorField as Record<string, unknown>).message : undefined

		const errorMessage: string | undefined =
			typeof errorDescription === "string"
				? errorDescription
				: typeof errorMessageFromError === "string"
					? errorMessageFromError
					: typeof obj.message === "string"
						? obj.message
						: undefined

		return { errorCode, errorMessage }
	} catch {
		return {}
	}
}

/**
 * Generates a cryptographically random PKCE code verifier
 * Must be 43-128 characters long using unreserved characters
 */
export function generateCodeVerifier(): string {
	const buffer = crypto.randomBytes(32)
	return buffer.toString("base64url")
}

/**
 * Generates the PKCE code challenge from the verifier using S256 method
 */
export function generateCodeChallenge(verifier: string): string {
	const hash = crypto.createHash("sha256").update(verifier).digest()
	return hash.toString("base64url")
}

/**
 * Generates a random state parameter for CSRF protection
 */
export function generateState(): string {
	return crypto.randomBytes(16).toString("hex")
}

/**
 * Builds the authorization URL for OpenAI Codex OAuth flow
 * Includes Codex-specific parameters per the implementation guide
 */
export function buildAuthorizationUrl(codeChallenge: string, state: string): string {
	const params = new URLSearchParams({
		client_id: OPENAI_CODEX_OAUTH_CONFIG.clientId,
		redirect_uri: OPENAI_CODEX_OAUTH_CONFIG.redirectUri,
		scope: OPENAI_CODEX_OAUTH_CONFIG.scopes,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
		response_type: "code",
		state,
		// Codex-specific parameters
		codex_cli_simplified_flow: "true",
		originator: "cline",
	})

	return `${OPENAI_CODEX_OAUTH_CONFIG.authorizationEndpoint}?${params.toString()}`
}

/**
 * Exchanges the authorization code for tokens
 * Important: Uses application/x-www-form-urlencoded (not JSON)
 * Important: state must NOT be included in token exchange body
 */
export async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<OpenAiCodexCredentials> {
	// Per the implementation guide: use application/x-www-form-urlencoded
	// and do NOT include state in the body (OpenAI returns error if included)
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		client_id: OPENAI_CODEX_OAUTH_CONFIG.clientId,
		code,
		redirect_uri: OPENAI_CODEX_OAUTH_CONFIG.redirectUri,
		code_verifier: codeVerifier,
	})

	const response = await fetch(OPENAI_CODEX_OAUTH_CONFIG.tokenEndpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: body.toString(),
		signal: AbortSignal.timeout(30000),
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(`Token exchange failed: ${response.status} ${response.statusText} - ${errorText}`)
	}

	const data = await response.json()
	const tokenResponse = tokenResponseSchema.parse(data)

	if (!tokenResponse.refresh_token) {
		throw new Error("Token exchange did not return a refresh_token")
	}

	// Per the implementation guide: expires is in milliseconds since epoch
	const expiresAt = Date.now() + tokenResponse.expires_in * 1000

	// Extract ChatGPT account ID from JWT claims
	const accountId = extractAccountId({
		id_token: tokenResponse.id_token,
		access_token: tokenResponse.access_token,
	})

	return {
		type: "openai-codex",
		access_token: tokenResponse.access_token,
		refresh_token: tokenResponse.refresh_token,
		expires: expiresAt,
		email: tokenResponse.email,
		accountId,
	}
}

/**
 * Refreshes the access token using the refresh token
 * Uses application/x-www-form-urlencoded (not JSON)
 */
export async function refreshAccessToken(credentials: OpenAiCodexCredentials): Promise<OpenAiCodexCredentials> {
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		client_id: OPENAI_CODEX_OAUTH_CONFIG.clientId,
		refresh_token: credentials.refresh_token,
	})

	const response = await fetch(OPENAI_CODEX_OAUTH_CONFIG.tokenEndpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: body.toString(),
		signal: AbortSignal.timeout(30000),
	})

	if (!response.ok) {
		const errorText = await response.text()
		const { errorCode, errorMessage } = parseOAuthErrorDetails(errorText)
		const details = errorMessage ? errorMessage : errorText
		throw new OpenAiCodexOAuthTokenError(
			`Token refresh failed: ${response.status} ${response.statusText}${details ? ` - ${details}` : ""}`,
			{ status: response.status, errorCode },
		)
	}

	const data = await response.json()
	const tokenResponse = tokenResponseSchema.parse(data)

	// Per the implementation guide: expires is in milliseconds since epoch
	const expiresAt = Date.now() + tokenResponse.expires_in * 1000

	// Extract new account ID from refreshed tokens, or preserve existing one
	const newAccountId = extractAccountId({
		id_token: tokenResponse.id_token,
		access_token: tokenResponse.access_token,
	})

	return {
		type: "openai-codex",
		access_token: tokenResponse.access_token,
		refresh_token: tokenResponse.refresh_token ?? credentials.refresh_token,
		expires: expiresAt,
		email: tokenResponse.email ?? credentials.email,
		// Prefer newly extracted accountId, fall back to existing
		accountId: newAccountId ?? credentials.accountId,
	}
}

/**
 * Checks if the credentials are expired (with 5 minute buffer)
 * Per the implementation guide: expires is in milliseconds since epoch
 */
export function isTokenExpired(credentials: OpenAiCodexCredentials): boolean {
	const bufferMs = 5 * 60 * 1000 // 5 minutes buffer
	return Date.now() >= credentials.expires - bufferMs
}

/**
 * OpenAiCodexOAuthManager - Handles OAuth flow and token management
 */
export class OpenAiCodexOAuthManager {
	private context: ExtensionContext | null = null
	private credentials: OpenAiCodexCredentials | null = null
	private refreshPromise: Promise<OpenAiCodexCredentials> | null = null
	private pendingAuth: {
		codeVerifier: string
		state: string
		server?: http.Server
	} | null = null

	/**
	 * Initialize the OAuth manager with VS Code extension context
	 */
	initialize(context: ExtensionContext): void {
		this.context = context
	}

	/**
	 * Force a refresh using the stored refresh token even if the access token is not expired.
	 * Useful when the server invalidates an access token early.
	 */
	async forceRefreshAccessToken(): Promise<string | null> {
		if (!this.credentials) {
			await this.loadCredentials()
		}

		if (!this.credentials) {
			return null
		}

		try {
			// De-dupe concurrent refreshes
			if (!this.refreshPromise) {
				this.refreshPromise = refreshAccessToken(this.credentials)
			}

			const newCredentials = await this.refreshPromise
			this.refreshPromise = null
			await this.saveCredentials(newCredentials)
			return newCredentials.access_token
		} catch (error) {
			this.refreshPromise = null
			console.error("[openai-codex-oauth] Failed to force refresh token:", error)
			if (error instanceof OpenAiCodexOAuthTokenError && error.isLikelyInvalidGrant()) {
				console.log("[openai-codex-oauth] Refresh token appears invalid; clearing stored credentials")
				await this.clearCredentials()
			}
			return null
		}
	}

	/**
	 * Load credentials from storage
	 */
	async loadCredentials(): Promise<OpenAiCodexCredentials | null> {
		if (!this.context) {
			return null
		}

		try {
			const credentialsJson = await this.context.secrets.get(OPENAI_CODEX_CREDENTIALS_KEY)
			if (!credentialsJson) {
				return null
			}

			const parsed = JSON.parse(credentialsJson)
			this.credentials = openAiCodexCredentialsSchema.parse(parsed)
			return this.credentials
		} catch (error) {
			console.error("[openai-codex-oauth] Failed to load credentials:", error)
			return null
		}
	}

	/**
	 * Save credentials to storage
	 */
	async saveCredentials(credentials: OpenAiCodexCredentials): Promise<void> {
		if (!this.context) {
			throw new Error("OAuth manager not initialized")
		}

		await this.context.secrets.store(OPENAI_CODEX_CREDENTIALS_KEY, JSON.stringify(credentials))
		this.credentials = credentials
	}

	/**
	 * Clear credentials from storage
	 */
	async clearCredentials(): Promise<void> {
		if (!this.context) {
			return
		}

		await this.context.secrets.delete(OPENAI_CODEX_CREDENTIALS_KEY)
		this.credentials = null
	}

	/**
	 * Get a valid access token, refreshing if necessary
	 */
	async getAccessToken(): Promise<string | null> {
		// Try to load credentials if not already loaded
		if (!this.credentials) {
			await this.loadCredentials()
		}

		if (!this.credentials) {
			return null
		}

		// Check if token is expired and refresh if needed
		if (isTokenExpired(this.credentials)) {
			try {
				// De-dupe concurrent refreshes
				if (!this.refreshPromise) {
					this.refreshPromise = refreshAccessToken(this.credentials)
				}

				const newCredentials = await this.refreshPromise
				this.refreshPromise = null
				await this.saveCredentials(newCredentials)
			} catch (error) {
				this.refreshPromise = null
				console.error("[openai-codex-oauth] Failed to refresh token:", error)

				// Only clear secrets when the refresh token is clearly invalid/revoked.
				if (error instanceof OpenAiCodexOAuthTokenError && error.isLikelyInvalidGrant()) {
					console.log("[openai-codex-oauth] Refresh token appears invalid; clearing stored credentials")
					await this.clearCredentials()
				}
				return null
			}
		}

		return this.credentials.access_token
	}

	/**
	 * Get the user's email from credentials
	 */
	async getEmail(): Promise<string | null> {
		if (!this.credentials) {
			await this.loadCredentials()
		}
		return this.credentials?.email || null
	}

	/**
	 * Get the ChatGPT account ID from credentials
	 * Used for the ChatGPT-Account-Id header required by the Codex API
	 */
	async getAccountId(): Promise<string | null> {
		if (!this.credentials) {
			await this.loadCredentials()
		}
		return this.credentials?.accountId || null
	}

	/**
	 * Check if the user is authenticated
	 */
	async isAuthenticated(): Promise<boolean> {
		const token = await this.getAccessToken()
		return token !== null
	}

	/**
	 * Start the OAuth authorization flow
	 * Returns the authorization URL to open in browser
	 */
	startAuthorizationFlow(): string {
		// Cancel any existing authorization flow before starting a new one
		this.cancelAuthorizationFlow()

		const codeVerifier = generateCodeVerifier()
		const codeChallenge = generateCodeChallenge(codeVerifier)
		const state = generateState()

		this.pendingAuth = {
			codeVerifier,
			state,
		}

		return buildAuthorizationUrl(codeChallenge, state)
	}

	/**
	 * Start a local server to receive the OAuth callback
	 * Returns a promise that resolves when authentication is complete
	 */
	async waitForCallback(): Promise<OpenAiCodexCredentials> {
		if (!this.pendingAuth) {
			throw new Error("No pending authorization flow")
		}

		// Close any existing server before starting a new one
		if (this.pendingAuth.server) {
			try {
				this.pendingAuth.server.close()
			} catch {
				// Ignore errors when closing
			}
			this.pendingAuth.server = undefined
		}

		return new Promise((resolve, reject) => {
			const server = http.createServer(async (req, res) => {
				try {
					const url = new URL(req.url || "", `http://localhost:${OPENAI_CODEX_OAUTH_CONFIG.callbackPort}`)

					if (url.pathname !== "/auth/callback") {
						res.writeHead(404)
						res.end("Not Found")
						return
					}

					const code = url.searchParams.get("code")
					const state = url.searchParams.get("state")
					const error = url.searchParams.get("error")

					if (error) {
						res.writeHead(400)
						res.end(`Authentication failed: ${error}`)
						reject(new Error(`OAuth error: ${error}`))
						server.close()
						return
					}

					if (!code || !state) {
						res.writeHead(400)
						res.end("Missing code or state parameter")
						reject(new Error("Missing code or state parameter"))
						server.close()
						return
					}

					if (state !== this.pendingAuth?.state) {
						res.writeHead(400)
						res.end("State mismatch - possible CSRF attack")
						reject(new Error("State mismatch"))
						server.close()
						return
					}

					try {
						// Note: state is validated above but not passed to exchangeCodeForTokens
						// per the implementation guide (OpenAI rejects it)
						const credentials = await exchangeCodeForTokens(code, this.pendingAuth.codeVerifier)

						await this.saveCredentials(credentials)

						res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
						res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authentication Successful</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    color: #fff;
  }
  .container { text-align: center; padding: 48px; max-width: 420px; }
  .icon {
    width: 72px; height: 72px; margin: 0 auto 24px;
    background: linear-gradient(135deg, #10a37f 0%, #1a7f64 100%);
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
  }
  .icon svg { width: 36px; height: 36px; stroke: #fff; stroke-width: 3; fill: none; }
  h1 { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
  p { font-size: 15px; color: rgba(255,255,255,0.7); line-height: 1.5; }
  .closing { margin-top: 32px; font-size: 13px; color: rgba(255,255,255,0.5); }
</style>
</head>
<body>
<div class="container">
  <div class="icon">
    <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
  </div>
  <h1>Authentication Successful</h1>
  <p>You're now signed in to OpenAI Codex. You can close this window and return to VS Code.</p>
  <p class="closing">This window will close automatically...</p>
</div>
<script>setTimeout(() => window.close(), 3000);</script>
</body>
</html>`)

						this.pendingAuth = null
						server.close()
						resolve(credentials)
					} catch (exchangeError) {
						res.writeHead(500)
						res.end(`Token exchange failed: ${exchangeError}`)
						reject(exchangeError)
						server.close()
					}
				} catch (err) {
					res.writeHead(500)
					res.end("Internal server error")
					reject(err)
					server.close()
				}
			})

			server.on("error", (err: NodeJS.ErrnoException) => {
				this.pendingAuth = null
				if (err.code === "EADDRINUSE") {
					reject(
						new Error(
							`Port ${OPENAI_CODEX_OAUTH_CONFIG.callbackPort} is already in use. ` +
								`Please close any other applications using this port and try again.`,
						),
					)
				} else {
					reject(err)
				}
			})

			// Set a timeout for the callback
			const timeout = setTimeout(
				() => {
					server.close()
					reject(new Error("Authentication timed out"))
				},
				5 * 60 * 1000,
			) // 5 minutes

			server.listen(OPENAI_CODEX_OAUTH_CONFIG.callbackPort, () => {
				if (this.pendingAuth) {
					this.pendingAuth.server = server
				}
			})

			// Clear timeout when server closes
			server.on("close", () => {
				clearTimeout(timeout)
			})
		})
	}

	/**
	 * Cancel any pending authorization flow
	 */
	cancelAuthorizationFlow(): void {
		if (this.pendingAuth?.server) {
			this.pendingAuth.server.close()
		}
		this.pendingAuth = null
	}

	/**
	 * Get the current credentials (for display purposes)
	 */
	getCredentials(): OpenAiCodexCredentials | null {
		return this.credentials
	}
}

// Singleton instance
export const openAiCodexOAuthManager = new OpenAiCodexOAuthManager()
