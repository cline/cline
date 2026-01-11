import { EmptyRequest } from "@shared/proto/cline/common"
import { CodexAuthResult } from "@shared/proto/cline/account"
import { getCodexAuthProvider } from "@/services/auth/providers/CodexAuthProvider"
import { Logger } from "@/services/logging/Logger"
import { Controller } from ".."

/**
 * Initiates OpenAI Codex OAuth sign-in flow
 */
export async function codexSignIn(controller: Controller, _: EmptyRequest): Promise<CodexAuthResult> {
	try {
		const authProvider = getCodexAuthProvider()
		const tokens = await authProvider.signIn()

		// Store the tokens in StateManager secrets
		controller.stateManager.setSecret("openAiCodexAccessToken", tokens.accessToken)
		controller.stateManager.setSecret("openAiCodexRefreshToken", tokens.refreshToken)
		controller.stateManager.setSecret("openAiCodexAccountId", tokens.accountId)

		// Store token expiry in global state
		controller.stateManager.setGlobalState("openAiCodexTokenExpiry", tokens.expiresAt)

		// Post updated state to webview
		controller.postStateToWebview()

		Logger.info("Codex: Successfully authenticated", { email: tokens.email })

		return {
			success: true,
			email: tokens.email,
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error"
		Logger.error("Codex: Authentication failed", error)

		return {
			success: false,
			error: errorMessage,
		}
	}
}
