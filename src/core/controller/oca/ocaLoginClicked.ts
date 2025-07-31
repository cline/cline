import { Controller } from "../index"
import { Empty } from "@shared/proto/cline/common"
import { OcaTokenManager } from "./util/ocaTokenManager"
import { getAllExtensionState, storeSecret, updateGlobalState } from "@/core/storage/state"
import type { ApiProvider } from "@/shared/api"
import * as vscode from "vscode"
import { Logger } from "@/services/logging/Logger"

/**
 * Handles the user clicking the login link in the UI.
 * Performs the OAuth flow to obtain a token set,
 * which includes access and refresh tokens, as well as the expiration time.
 *
 * @param controller The controller instance.
 * @returns The login URL as a string.
 */
export async function ocaLoginClicked(controller: Controller): Promise<Empty> {
	// Perform oca oauth flow to get token set
	Logger.info("Login button clicked in oca provider page")
	const tokenSet = await OcaTokenManager.getToken()
	if (!tokenSet) {
		throw new Error("Failed to fetch token set")
	}

	await storeSecret(controller.context, "ocaAccessToken", tokenSet.access_token)
	const ocaProvider: ApiProvider = "oca"
	// Get current settings to determine how to update providers
	const { planActSeparateModelsSetting } = await getAllExtensionState(controller.context)
	const currentMode = await controller.getCurrentMode()

	if (planActSeparateModelsSetting) {
		// Only update the current mode's provider
		if (currentMode === "plan") {
			await updateGlobalState(controller.context, "planModeApiProvider", ocaProvider)
		} else {
			await updateGlobalState(controller.context, "actModeApiProvider", ocaProvider)
		}
	} else {
		// Update both modes to keep them in sync
		await Promise.all([
			updateGlobalState(controller.context, "planModeApiProvider", ocaProvider),
			updateGlobalState(controller.context, "actModeApiProvider", ocaProvider),
		])
	}
	await updateGlobalState(controller.context, "ocaAccessTokenExpiresAt", tokenSet.expires_at)
	await updateGlobalState(controller.context, "ocaAccessTokenSub", tokenSet.sub)

	await controller.postStateToWebview()
	vscode.window.showInformationMessage("Successfully logged in to Oracle Code Assist")

	return Empty.create()
}
