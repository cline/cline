import { Controller } from "../index"
import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { OcaTokenManager } from "./util/ocaTokenManager"
import { storeSecret, updateGlobalState } from "@/core/storage/state"
import { Logger } from "@/services/logging/Logger"

/**
 * Handles the user clicking the login link in the UI.
 * Performs the OAuth flow to obtain a token set,
 * which includes access and refresh tokens, as well as the expiration time.
 *
 * @param controller The controller instance.
 * @returns The login URL as a string.
 */
export async function ocaRefreshToken(controller: Controller, unused: EmptyRequest): Promise<Empty> {
	const tokenSet = await OcaTokenManager.getToken()

	if (!tokenSet) {
		Logger.error("Failed to refresh token set")
	} else {
		Logger.info("Successfully refreshed token set")

		await storeSecret(controller.context, "ocaAccessToken", tokenSet.access_token)
		await updateGlobalState(controller.context, "ocaAccessTokenExpiresAt", tokenSet.expires_at)
		await updateGlobalState(controller.context, "ocaAccessTokenSub", tokenSet.sub)

		await controller.postStateToWebview()
	}
	return Empty.create()
}
