import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/services/logging/Logger"
import { Controller } from ".."

/**
 * Signs out from OpenAI Codex OAuth
 */
export async function codexSignOut(controller: Controller, _: EmptyRequest): Promise<Empty> {
	try {
		// Clear the tokens from StateManager secrets
		controller.stateManager.setSecret("openAiCodexAccessToken", undefined)
		controller.stateManager.setSecret("openAiCodexRefreshToken", undefined)
		controller.stateManager.setSecret("openAiCodexAccountId", undefined)

		// Clear token expiry from global state
		controller.stateManager.setGlobalState("openAiCodexTokenExpiry", undefined)

		// Post updated state to webview
		controller.postStateToWebview()

		Logger.info("Codex: Successfully signed out")
	} catch (error) {
		Logger.error("Codex: Sign out failed", error)
	}

	return {}
}
