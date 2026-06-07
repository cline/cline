import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Signs out of OpenAI Codex by clearing stored credentials
 */
export async function openAiCodexSignOut(controller: Controller, _: EmptyRequest): Promise<Empty> {
	try {
		// Clear stored credentials
		await openAiCodexOAuthManager.clearCredentials()

		// Cancel any pending authorization flow
		openAiCodexOAuthManager.cancelAuthorizationFlow()

		// Update the state to reflect sign out
		await controller.postStateToWebview()
	} catch (error) {
		Logger.error("[openAiCodexSignOut] Failed to sign out:", error)
		throw error
	}

	return {}
}
