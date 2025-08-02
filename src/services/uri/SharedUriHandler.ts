import * as vscode from "vscode"
import { WebviewProvider } from "@/core/webview"

/**
 * Shared URI handler that processes both VSCode URI events and HTTP server callbacks
 */
export class SharedUriHandler {
	/**
	 * Processes a URI and routes it to the appropriate handler
	 * @param uri The URI to process (can be from VSCode or converted from HTTP)
	 * @returns Promise<boolean> indicating success (true) or failure (false)
	 */
	public static async handleUri(uri: vscode.Uri): Promise<boolean> {
		console.log("SharedUriHandler: Processing URI:", {
			path: uri.path,
			query: uri.query,
			scheme: uri.scheme,
		})

		const path = uri.path
		const query = new URLSearchParams(uri.query.replace(/\+/g, "%2B"))
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
					console.log("SharedUriHandler: Auth callback received:", { path: uri.path, provider: query.get("provider") })

					const token = query.get("idToken")
					const provider = query.get("provider")

					if (token) {
						await visibleWebview.controller.handleAuthCallback(token, provider)
						return true
					}
					console.warn("SharedUriHandler: Missing idToken parameter for auth callback")
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

	/**
	 * Converts an HTTP URL to a vscode.Uri for unified processing
	 * @param httpUrl The HTTP URL to convert
	 * @returns vscode.Uri representation of the URL
	 */
	public static convertHttpUrlToUri(httpUrl: string): vscode.Uri {
		return vscode.Uri.parse(httpUrl)
	}
}
