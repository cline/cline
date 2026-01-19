import * as vscode from "vscode"
import {
	GitHubCopilotLoginRequest,
	GitHubCopilotLoginResponse,
	GitHubCopilotLoginStatus,
} from "@shared/proto/cline/github_copilot"
import { initiateDeviceCodeFlow, completeDeviceCodeFlow } from "@/core/api/providers/github-copilot-auth"
import { Controller } from "../index"
import { StreamingResponseHandler } from "../grpc-handler"

/**
 * Handles the GitHub Copilot OAuth device code login flow.
 * Streams status updates back to the webview.
 */
export async function loginWithGitHubCopilot(
	controller: Controller,
	request: GitHubCopilotLoginRequest,
	responseStream: StreamingResponseHandler<GitHubCopilotLoginResponse>,
	_requestId?: string,
): Promise<void> {
	const enterpriseUrl = request.enterpriseUrl || undefined

	try {
		// Step 1: Initiate device code flow
		const deviceCodeResponse = await initiateDeviceCodeFlow(enterpriseUrl)

		// Step 2: Send the user code and verification URL
		await responseStream(
			{
				status: GitHubCopilotLoginStatus.WAITING_FOR_CODE,
				verificationUrl: deviceCodeResponse.verificationUri,
				userCode: deviceCodeResponse.userCode,
			},
			false,
		)

		// Open the verification URL in browser
		await vscode.env.openExternal(vscode.Uri.parse(deviceCodeResponse.verificationUri))

		// Step 3: Poll for the access token using the complete flow helper
		const result = await completeDeviceCodeFlow(
			deviceCodeResponse.deviceCode,
			deviceCodeResponse.interval,
			deviceCodeResponse.expiresIn,
			enterpriseUrl,
		)

		if (result.success && result.accessToken) {
			// Step 4: Store the token
			controller.stateManager.setSecretsBatch({
				gitHubCopilotAccessToken: result.accessToken,
			})

			// Also store enterprise URL if provided
			if (enterpriseUrl) {
				controller.stateManager.setGlobalStateBatch({
					gitHubCopilotEnterpriseUrl: enterpriseUrl,
				})
			}

			// Post updated state to webview
			await controller.postStateToWebview()

			// Send success
			await responseStream(
				{
					status: GitHubCopilotLoginStatus.SUCCESS,
				},
				true,
			)
		} else {
			// Send failure
			await responseStream(
				{
					status: GitHubCopilotLoginStatus.FAILED,
					error: result.error || "Authentication failed",
				},
				true,
			)
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
		await responseStream(
			{
				status: GitHubCopilotLoginStatus.FAILED,
				error: errorMessage,
			},
			true,
		)
	}
}
