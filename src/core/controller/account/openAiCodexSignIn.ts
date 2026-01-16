import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { openExternal } from "@/utils/env"
import { Controller } from ".."

/**
 * Initiates OpenAI Codex OAuth authentication flow
 * Opens the authorization URL in the user's browser
 */
export async function openAiCodexSignIn(controller: Controller, _: EmptyRequest): Promise<Empty> {
	try {
		// Start the authorization flow and get the auth URL
		const authUrl = openAiCodexOAuthManager.startAuthorizationFlow()

		// Open the auth URL in the browser
		await openExternal(authUrl)

		// Wait for the OAuth callback in the background
		// The callback will save credentials when complete
		openAiCodexOAuthManager
			.waitForCallback()
			.then(async () => {
				// Update the state to reflect authentication
				await controller.postStateToWebview()
			})
			.catch((error) => {
				console.error("[openAiCodexSignIn] OAuth callback failed:", error)
				// Cancel the flow on error
				openAiCodexOAuthManager.cancelAuthorizationFlow()
			})
	} catch (error) {
		console.error("[openAiCodexSignIn] Failed to start OAuth flow:", error)
		openAiCodexOAuthManager.cancelAuthorizationFlow()
		throw error
	}

	return {}
}
