import { WebviewProvider } from "@/core/webview"
import { Logger } from "../logging/Logger"

/**
 * Shared URI handler that processes both VSCode URI events and HTTP server callbacks
 */
export class SharedUriHandler {
	/**
	 * Processes a URI and routes it to the appropriate handler
	 * @param url The URI to process (can be from VSCode or converted from HTTP)
	 * @returns Promise<boolean> indicating success (true) or failure (false)
	 */
	public static async handleUri(url: string): Promise<boolean> {
		const parsedUrl = new URL(url)
		const path = parsedUrl.pathname

		// Create URLSearchParams from the query string, but preserve plus signs
		// by replacing them with a placeholder before parsing
		const queryString = parsedUrl.search.slice(1) // Remove leading '?'
		const query = new URLSearchParams(queryString.replace(/\+/g, "%2B"))

		Logger.info(
			"SharedUriHandler: Processing URI:" +
				JSON.stringify({
					path: path,
					query: query,
					scheme: parsedUrl.protocol,
				}),
		)

		const visibleWebview = WebviewProvider.getVisibleInstance()

		if (!visibleWebview) {
			Logger.warn("SharedUriHandler: No visible webview found")
			return false
		}

		try {
			switch (path) {
				case "/openrouter": {
					const code = query.get("code")
					if (code) {
						await visibleWebview.controller.handleOpenRouterCallback(code)
						return true
					}
					console.warn("SharedUriHandler: Missing code parameter for OpenRouter callback")
					return false
				}
				case "/requesty": {
					const code = query.get("code")
					if (code) {
						await visibleWebview.controller.handleRequestyCallback(code)
						return true
					}
					console.warn("SharedUriHandler: Missing code parameter for Requesty callback")
					return false
				}
				case "/auth": {
					const provider = query.get("provider")

					Logger.info(`SharedUriHandler - Auth callback received for ${provider} - ${path}`)

					const token = query.get("refreshToken") || query.get("idToken") || query.get("code")
					if (token) {
						await visibleWebview.controller.handleAuthCallback(token, provider)
						return true
					}
					Logger.warn("SharedUriHandler: Missing idToken parameter for auth callback")
					return false
				}
				case "/auth/oca": {
					console.log("SharedUriHandler: Oca Auth callback received:", { path: path })

					const code = query.get("code")
					const state = query.get("state")

					if (code && state) {
						await visibleWebview.controller.handleOcaAuthCallback(code, state)
						return true
					}
					console.warn("SharedUriHandler: Missing code parameter for auth callback")
					return false
				}
				case "/task": {
					const prompt = query.get("prompt")
					if (prompt) {
						await visibleWebview.controller.handleTaskCreation(prompt)
						return true
					}
					Logger.warn("SharedUriHandler: Missing prompt parameter for task creation")
					return false
				}
				// Match /mcp-auth/callback/{hash}
				case path.match(/^\/mcp-auth\/callback\/[^/]+$/)?.input: {
					const serverHash = path.split("/").pop()
					const code = query.get("code")
					const state = query.get("state")

					if (!code || !serverHash) {
						Logger.warn("SharedUriHandler: Missing code or hash in MCP OAuth callback")
						return false
					}

					await visibleWebview.controller.handleMcpOAuthCallback(serverHash, code, state)
					return true
				}
				default:
					Logger.warn(`SharedUriHandler: Unknown path: ${path}`)
					return false
			}
		} catch (error) {
			Logger.error("SharedUriHandler: Error processing URI:", error)
			return false
		}
	}
}
