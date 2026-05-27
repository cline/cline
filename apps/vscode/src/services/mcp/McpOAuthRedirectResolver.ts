import { Logger } from "@/shared/services/Logger"

/**
 * Result of resolving an OAuth redirect URL for an MCP server.
 */
export interface RedirectUrlResolution {
	/** The resolved redirect URL to use for OAuth */
	redirectUrl: string
	/** Whether the previously saved client registration can be reused */
	isRegistrationValid: boolean
}

/**
 * Function type for obtaining a callback URL.
 * @param path - The callback path (e.g., /mcp-auth/callback/{hash})
 * @param preferredPort - Optional port to try binding first (ignored by non-loopback providers like VSCode desktop)
 */
export type GetCallbackUrlFn = (path: string, preferredPort?: number) => Promise<string>

/**
 * Pure logic for MCP OAuth redirect URL resolution.
 *
 * Solves the problem where a dynamically-registered OAuth client_id becomes
 * stale when the local callback server port changes between sessions.
 * OAuth servers (like Linear) reject authorization requests where the
 * redirect_uri doesn't match the URI registered for the client_id.
 *
 * Strategy:
 * 1. If we have a saved redirect URL from a previous registration, extract the port
 * 2. Ask the callback URL provider to try that port first
 * 3. If we get the same URL back → existing registration is valid
 * 4. If port was unavailable or URL differs → force re-registration
 *
 * This handles all combinations:
 * - Standalone/JetBrains/CLI (http://127.0.0.1:{port}/...) — dynamic port, can become stale
 * - VSCode Desktop (vscode://extension-id/...) — stable, no port
 * - VSCode Web (https://codespace.github.dev/...) — stable per-codespace
 * - Legacy state (no saved redirect URL) — conservative: assume stale
 * - Cross-platform migration (VSCode → JetBrains) — detect scheme change
 */
export class McpOAuthRedirectResolver {
	/**
	 * Extract the port number from an http://127.0.0.1:{port}/... URL.
	 * Returns undefined for non-loopback URLs (vscode://, https://, etc.)
	 * or URLs that don't match the expected loopback pattern.
	 */
	static extractLoopbackPort(url: string): number | undefined {
		if (!McpOAuthRedirectResolver.isLoopbackUrl(url)) {
			return undefined
		}

		try {
			const parsed = new URL(url)
			const port = Number.parseInt(parsed.port, 10)
			return Number.isNaN(port) || port <= 0 || port > 65535 ? undefined : port
		} catch {
			return undefined
		}
	}

	/**
	 * Determines if a redirect URL is an http://127.0.0.1 loopback URL
	 * (i.e., the type that uses dynamic ports and can become stale).
	 */
	static isLoopbackUrl(url: string): boolean {
		try {
			const parsed = new URL(url)
			return parsed.protocol === "http:" && parsed.hostname === "127.0.0.1"
		} catch {
			return false
		}
	}

	/**
	 * Determines if two redirect URLs are compatible for OAuth client reuse.
	 *
	 * Rules:
	 * - If savedUrl is undefined (legacy state, no tracking), return false (conservative:
	 *   we don't know what URL was registered, so we force re-registration to be safe)
	 * - If both are identical strings → compatible
	 * - Otherwise → incompatible (different port, different scheme, different platform)
	 */
	static isRedirectCompatible(savedRedirectUrl: string | undefined, currentRedirectUrl: string): boolean {
		if (savedRedirectUrl === undefined) {
			return false
		}
		return savedRedirectUrl === currentRedirectUrl
	}

	/**
	 * Resolves the redirect URL, attempting to preserve existing client registrations.
	 *
	 * For loopback URLs (standalone/JetBrains/CLI): extracts the previously-used port
	 * and asks the callback URL provider to try binding it first. If the same URL is
	 * obtained, the existing registration remains valid.
	 *
	 * For scheme URLs (VSCode desktop): no port to prefer, returns URL directly.
	 *
	 * For legacy state (no saved URL): gets a fresh URL, marks registration as invalid
	 * so the SDK will re-register with the new redirect_uri.
	 *
	 * @param savedRedirectUrl - The redirect URL from a previous registration (may be undefined for legacy state)
	 * @param callbackPath - The OAuth callback path (e.g., /mcp-auth/callback/{hash})
	 * @param getCallbackUrl - Function to get a callback URL, optionally with a preferred port
	 */
	static async resolve(
		savedRedirectUrl: string | undefined,
		callbackPath: string,
		getCallbackUrl: GetCallbackUrlFn,
	): Promise<RedirectUrlResolution> {
		// Determine if we have a preferred port to try
		const preferredPort =
			savedRedirectUrl !== undefined ? McpOAuthRedirectResolver.extractLoopbackPort(savedRedirectUrl) : undefined

		// Get the callback URL, passing the preferred port if we have one
		const redirectUrl = await getCallbackUrl(callbackPath, preferredPort)

		// Check if the resolved URL matches the saved one
		const isRegistrationValid = McpOAuthRedirectResolver.isRedirectCompatible(savedRedirectUrl, redirectUrl)

		if (savedRedirectUrl !== undefined && !isRegistrationValid) {
			Logger.log(
				`[McpOAuthRedirectResolver] Redirect URL changed: saved="${savedRedirectUrl}" current="${redirectUrl}" — client re-registration required`,
			)
		}

		return { redirectUrl, isRegistrationValid }
	}
}
