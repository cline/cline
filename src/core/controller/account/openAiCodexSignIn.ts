import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { ShowMessageType } from "@shared/proto/host/window"
import { HostProvider } from "@/hosts/host-provider"
import { AuthService } from "@/sdk/auth-service"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Initiates OpenAI Codex OAuth authentication flow.
 * Uses the SDK-backed AuthService which delegates to @clinebot/core's
 * loginOpenAICodex() function.
 */
export async function openAiCodexSignIn(controller: Controller, _: EmptyRequest): Promise<Empty> {
	try {
		const authService = AuthService.getInstance()

		// Start the OAuth flow in the background
		authService
			.openAiCodexLogin()
			.then(async () => {
				HostProvider.window.showMessage({
					type: ShowMessageType.INFORMATION,
					message: "Successfully signed in to OpenAI Codex",
				})
				await controller.postStateToWebview()
			})
			.catch((error) => {
				Logger.error("[openAiCodexSignIn] OAuth flow failed:", error)
				const errorMessage = error instanceof Error ? error.message : String(error)
				if (!errorMessage.includes("timed out")) {
					HostProvider.window.showMessage({
						type: ShowMessageType.ERROR,
						message: `OpenAI Codex sign in failed: ${errorMessage}`,
					})
				}
			})
	} catch (error) {
		Logger.error("[openAiCodexSignIn] Failed to start OAuth flow:", error)
		throw error
	}

	return {}
}
