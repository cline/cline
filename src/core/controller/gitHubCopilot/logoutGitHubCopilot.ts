import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Controller } from "../index"

/**
 * Handles logging out of GitHub Copilot by clearing the access token.
 */
export async function logoutGitHubCopilot(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	// Clear the access token
	controller.stateManager.setSecretsBatch({
		gitHubCopilotAccessToken: undefined,
	})

	// Clear enterprise URL
	controller.stateManager.setGlobalStateBatch({
		gitHubCopilotEnterpriseUrl: undefined,
	})

	// Post updated state to webview
	await controller.postStateToWebview()

	return Empty.create()
}
