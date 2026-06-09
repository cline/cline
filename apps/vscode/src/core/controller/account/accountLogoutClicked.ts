import type { EmptyRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/**
 * Handles the account logout action.
 * Delegates to the SdkController which uses the SDK-backed AuthService.
 * @param controller The controller instance
 * @param _request The empty request object
 * @returns Empty response
 */
export async function accountLogoutClicked(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await controller.handleSignOut()
	return Empty.create({})
}
