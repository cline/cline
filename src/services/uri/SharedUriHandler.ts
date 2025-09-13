import { WebviewProvider } from "@/core/webview"

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

		console.log("SharedUriHandler: Processing URI:", {
			path: path,
			query: query,
			scheme: parsedUrl.protocol,
		})

		const visibleWebview = WebviewProvider.getVisibleInstance()

		if (!visibleWebview) {
			console.warn("SharedUriHandler: No visible webview found")
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
				case "/auth": {
					const provider = query.get("provider")
					const token = query.get("idToken")

					console.log("SharedUriHandler: Auth callback received:", { path: path, provider: provider })

					if (token) {
						await visibleWebview.controller.handleAuthCallback(token, provider)
						return true
					}
					console.warn("SharedUriHandler: Missing idToken parameter for auth callback")
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
				default:
					console.warn(`SharedUriHandler: Unknown path: ${path}`)
					return false
			}
		} catch (error) {
			console.error("SharedUriHandler: Error processing URI:", error)
			return false
		}
	}
}
