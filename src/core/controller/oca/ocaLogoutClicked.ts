import { storeSecret, updateGlobalState, updateWorkspaceState } from "@/core/storage/state"
import { Empty } from "@shared/proto/cline/common"
import type { EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"
import * as vscode from "vscode"
import { Logger } from "@/services/logging/Logger"
import type { ApiProvider } from "@/shared/api"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/index.host"

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
		HostProvider.window.showMessage({
			type: ShowMessageType.INFORMATION,
			message: "Successfully logged out of Oracle Code Assist.",
		})
	} catch (error) {
		Logger.error("Logout failed:", error)
		// Show an error message to the user
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Logout failed.",
		})
	}
	return Empty.create()
}
