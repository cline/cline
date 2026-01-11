import * as crypto from "crypto"
import * as http from "http"
import * as vscode from "vscode"
import { Logger } from "@/services/logging/Logger"
import { fetch } from "@/shared/net"

// OAuth constants (same as OpenAI Codex CLI)
export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
export const CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize"
export const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token"
export const CODEX_OAUTH_PORT = 1455
export const CODEX_REDIRECT_URI = `http://localhost:${CODEX_OAUTH_PORT}/auth/callback`
export const CODEX_SCOPES = "openid profile email offline_access"

// JWT claim path for ChatGPT account ID
const JWT_CLAIM_PATH = "https://api.openai.com/auth"

export interface CodexOAuthTokens {
	accessToken: string
	refreshToken: string
	expiresAt: number // Unix timestamp in milliseconds
	accountId: string
	email?: string
}

interface TokenResponse {
	access_token: string
	refresh_token: string
	expires_in: number
	token_type: string
}

interface PKCEPair {
	verifier: string
	challenge: string
}

interface AuthorizationFlow {
	pkce: PKCEPair
	state: string
	url: string
}

/**
 * Generate a cryptographically secure random string for PKCE
 */
function generateCodeVerifier(): string {
	return crypto.randomBytes(32).toString("base64url")
}

/**
 * Generate SHA256 hash for PKCE code challenge
 */
function generateCodeChallenge(verifier: string): string {
	return crypto.createHash("sha256").update(verifier).digest("base64url")
}

/**
 * Generate random state for CSRF protection
 */
function generateState(): string {
	return crypto.randomBytes(16).toString("hex")
}

/**
 * Decode a JWT token and extract the payload
 */
function decodeJWT(token: string): Record<string, any> | null {
	try {
		const parts = token.split(".")
		if (parts.length !== 3) {
			return null
		}
		const payload = Buffer.from(parts[1], "base64url").toString("utf-8")
		return JSON.parse(payload)
	} catch {
		return null
	}
}

/**
 * Extract ChatGPT account ID from access token JWT
 */
function extractAccountId(accessToken: string): string | null {
	const decoded = decodeJWT(accessToken)
	if (!decoded) {
		return null
	}

	// Try the official claim path
	const claims = decoded[JWT_CLAIM_PATH]
	if (claims?.chatgpt_account_id) {
		return claims.chatgpt_account_id
	}

	// Fallback: try direct property
	if (decoded.chatgpt_account_id) {
		return decoded.chatgpt_account_id
	}

	return null
}

/**
 * Extract email from access token JWT
 */
function extractEmail(accessToken: string): string | undefined {
	const decoded = decodeJWT(accessToken)
	return decoded?.email
}

export class CodexAuthProvider {
	readonly name = "codex"

	/**
	 * Create the authorization URL with PKCE parameters
	 */
	createAuthorizationFlow(): AuthorizationFlow {
		const verifier = generateCodeVerifier()
		const challenge = generateCodeChallenge(verifier)
		const state = generateState()

		const url = new URL(CODEX_AUTHORIZE_URL)
		url.searchParams.set("response_type", "code")
		url.searchParams.set("client_id", CODEX_CLIENT_ID)
		url.searchParams.set("redirect_uri", CODEX_REDIRECT_URI)
		url.searchParams.set("scope", CODEX_SCOPES)
		url.searchParams.set("code_challenge", challenge)
		url.searchParams.set("code_challenge_method", "S256")
		url.searchParams.set("state", state)
		url.searchParams.set("id_token_add_organizations", "true")
		url.searchParams.set("codex_cli_simplified_flow", "true")
		url.searchParams.set("originator", "cline")

		return {
			pkce: { verifier, challenge },
			state,
			url: url.toString(),
		}
	}

	/**
	 * Start local OAuth callback server
	 */
	startLocalOAuthServer(
		expectedState: string,
	): Promise<{ server: http.Server; getAuthCode: () => Promise<string | null>; close: () => void }> {
		return new Promise((resolve, reject) => {
			let authCode: string | null = null
			let codeReceived = false

			const server = http.createServer((req, res) => {
				try {
					const url = new URL(req.url || "", `http://localhost:${CODEX_OAUTH_PORT}`)

					if (url.pathname !== "/auth/callback") {
						res.statusCode = 404
						res.end("Not found")
						return
					}

					const state = url.searchParams.get("state")
					if (state !== expectedState) {
						res.statusCode = 400
						res.setHeader("Content-Type", "text/html; charset=utf-8")
						res.end(this.getErrorHtml("State mismatch - possible CSRF attack"))
						return
					}

					const error = url.searchParams.get("error")
					if (error) {
						const errorDescription = url.searchParams.get("error_description") || error
						res.statusCode = 400
						res.setHeader("Content-Type", "text/html; charset=utf-8")
						res.end(this.getErrorHtml(errorDescription))
						return
					}

					const code = url.searchParams.get("code")
					if (!code) {
						res.statusCode = 400
						res.setHeader("Content-Type", "text/html; charset=utf-8")
						res.end(this.getErrorHtml("Missing authorization code"))
						return
					}

					authCode = code
					codeReceived = true

					res.statusCode = 200
					res.setHeader("Content-Type", "text/html; charset=utf-8")
					res.end(this.getSuccessHtml())
				} catch (err) {
					Logger.error("Error handling OAuth callback:", err)
					res.statusCode = 500
					res.end("Internal server error")
				}
			})

			server.on("error", (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE") {
					reject(new Error(`Port ${CODEX_OAUTH_PORT} is already in use. Please close any other Codex sessions.`))
				} else {
					reject(err)
				}
			})

			server.listen(CODEX_OAUTH_PORT, "127.0.0.1", () => {
				resolve({
					server,
					getAuthCode: async () => {
						// Poll for auth code with timeout
						const timeout = 120000 // 2 minutes
						const pollInterval = 100
						const startTime = Date.now()

						while (!codeReceived && Date.now() - startTime < timeout) {
							await new Promise((r) => setTimeout(r, pollInterval))
						}

						return authCode
					},
					close: () => {
						server.close()
					},
				})
			})
		})
	}

	/**
	 * Exchange authorization code for tokens
	 */
	async exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<CodexOAuthTokens> {
		const response = await fetch(CODEX_TOKEN_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				client_id: CODEX_CLIENT_ID,
				code,
				code_verifier: codeVerifier,
				redirect_uri: CODEX_REDIRECT_URI,
			}),
		})

		if (!response.ok) {
			const text = await response.text().catch(() => "")
			Logger.error(`Codex token exchange failed: ${response.status}`, text)
			throw new Error(`Failed to exchange authorization code: ${response.status}`)
		}

		const data = (await response.json()) as TokenResponse

		if (!data.access_token || !data.refresh_token || typeof data.expires_in !== "number") {
			throw new Error("Invalid token response from OpenAI")
		}

		const accountId = extractAccountId(data.access_token)
		if (!accountId) {
			throw new Error("Could not extract ChatGPT account ID from token")
		}

		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: Date.now() + data.expires_in * 1000,
			accountId,
			email: extractEmail(data.access_token),
		}
	}

	/**
	 * Refresh access token using refresh token
	 */
	async refreshAccessToken(refreshToken: string): Promise<CodexOAuthTokens> {
		const response = await fetch(CODEX_TOKEN_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: CODEX_CLIENT_ID,
			}),
		})

		if (!response.ok) {
			const text = await response.text().catch(() => "")
			Logger.error(`Codex token refresh failed: ${response.status}`, text)
			throw new Error(`Failed to refresh token: ${response.status}`)
		}

		const data = (await response.json()) as TokenResponse

		if (!data.access_token || !data.refresh_token || typeof data.expires_in !== "number") {
			throw new Error("Invalid token response from OpenAI")
		}

		const accountId = extractAccountId(data.access_token)
		if (!accountId) {
			throw new Error("Could not extract ChatGPT account ID from token")
		}

		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresAt: Date.now() + data.expires_in * 1000,
			accountId,
			email: extractEmail(data.access_token),
		}
	}

	/**
	 * Check if the token needs to be refreshed
	 */
	shouldRefreshToken(expiresAt: number): boolean {
		const bufferMs = 30 * 1000 // 30 seconds buffer
		return Date.now() >= expiresAt - bufferMs
	}

	/**
	 * Open browser to authorization URL
	 */
	async openBrowser(url: string): Promise<boolean> {
		try {
			await vscode.env.openExternal(vscode.Uri.parse(url))
			return true
		} catch (err) {
			Logger.error("Failed to open browser:", err)
			return false
		}
	}

	/**
	 * Full sign-in flow
	 */
	async signIn(): Promise<CodexOAuthTokens> {
		// Create authorization URL with PKCE
		const flow = this.createAuthorizationFlow()

		// Start local server to receive callback
		const { getAuthCode, close } = await this.startLocalOAuthServer(flow.state)

		try {
			// Open browser for user to authenticate
			const opened = await this.openBrowser(flow.url)
			if (!opened) {
				throw new Error("Failed to open browser for authentication")
			}

			// Wait for authorization code
			const code = await getAuthCode()
			if (!code) {
				throw new Error("Authentication timed out or was cancelled")
			}

			// Exchange code for tokens
			return await this.exchangeAuthorizationCode(code, flow.pkce.verifier)
		} finally {
			close()
		}
	}

	private getSuccessHtml(): string {
		return `<!DOCTYPE html>
<html>
<head>
	<title>Authentication Successful</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			display: flex;
			justify-content: center;
			align-items: center;
			height: 100vh;
			margin: 0;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		}
		.container {
			text-align: center;
			background: white;
			padding: 40px 60px;
			border-radius: 16px;
			box-shadow: 0 10px 40px rgba(0,0,0,0.2);
		}
		.checkmark {
			width: 80px;
			height: 80px;
			margin: 0 auto 20px;
			border-radius: 50%;
			background: #10b981;
			display: flex;
			align-items: center;
			justify-content: center;
		}
		.checkmark svg {
			width: 40px;
			height: 40px;
			fill: white;
		}
		h1 { color: #1f2937; margin: 0 0 10px; }
		p { color: #6b7280; margin: 0; }
	</style>
</head>
<body>
	<div class="container">
		<div class="checkmark">
			<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
		</div>
		<h1>Authentication Successful</h1>
		<p>You can close this window and return to Cline.</p>
	</div>
</body>
</html>`
	}

	private getErrorHtml(message: string): string {
		return `<!DOCTYPE html>
<html>
<head>
	<title>Authentication Failed</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			display: flex;
			justify-content: center;
			align-items: center;
			height: 100vh;
			margin: 0;
			background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
		}
		.container {
			text-align: center;
			background: white;
			padding: 40px 60px;
			border-radius: 16px;
			box-shadow: 0 10px 40px rgba(0,0,0,0.2);
		}
		.error-icon {
			width: 80px;
			height: 80px;
			margin: 0 auto 20px;
			border-radius: 50%;
			background: #ef4444;
			display: flex;
			align-items: center;
			justify-content: center;
		}
		.error-icon svg {
			width: 40px;
			height: 40px;
			fill: white;
		}
		h1 { color: #1f2937; margin: 0 0 10px; }
		p { color: #6b7280; margin: 0; }
	</style>
</head>
<body>
	<div class="container">
		<div class="error-icon">
			<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
		</div>
		<h1>Authentication Failed</h1>
		<p>${message}</p>
	</div>
</body>
</html>`
	}
}

// Singleton instance
let codexAuthProvider: CodexAuthProvider | null = null

export function getCodexAuthProvider(): CodexAuthProvider {
	if (!codexAuthProvider) {
		codexAuthProvider = new CodexAuthProvider()
	}
	return codexAuthProvider
}
