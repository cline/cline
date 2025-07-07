import { storeSecret, updateGlobalState, updateWorkspaceState } from "@/core/storage/state"
import { Empty } from "@shared/proto/cline/common"
import type { EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"
import * as vscode from "vscode"
import { Logger } from "@/services/logging/Logger"
import type { ApiProvider } from "@/shared/api"

/**
 * Handles the oca account logout action
 * @param controller The controller instance
 * @param _request The empty request object
 * @returns Empty response
 */
export async function ocaLogoutClicked(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		await storeSecret(controller.context, "ocaAccessToken", "logout")
		await updateGlobalState(controller.context, "ocaAccessTokenExpiresAt", undefined)
		await updateGlobalState(controller.context, "ocaAccessTokenSub", undefined)

		await controller.postStateToWebview()
		vscode.window.showInformationMessage("Successfully logged out of Oracle Code Assist")
	} catch (error) {
		Logger.error("Logout failed:", error)
		// Show an error message to the user
		vscode.window.showErrorMessage("Logout failed")
	}
	return Empty.create()
}
