import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { ShowMessageType } from "@shared/proto/host/window"
import { HostProvider } from "@/hosts/host-provider"
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
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message: "Successfully signed in to OpenAI Codex",
				})
				await controller.postStateToWebview()
			})
			.catch((error) => {
				console.error("[openAiCodexSignIn] OAuth callback failed:", error)
				openAiCodexOAuthManager.cancelAuthorizationFlow()
				// Don't show notification for timeouts (user likely just abandoned)
				const errorMessage = error instanceof Error ? error.message : String(error)
				if (!errorMessage.includes("timed out")) {
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: `OpenAI Codex sign in failed: ${errorMessage}`,
					})
				}
			})
	} catch (error) {
		console.error("[openAiCodexSignIn] Failed to start OAuth flow:", error)
		openAiCodexOAuthManager.cancelAuthorizationFlow()
		throw error
	}

	return {}
}
