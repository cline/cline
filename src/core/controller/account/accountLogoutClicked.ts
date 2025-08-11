import { AuthService } from "@/services/auth/AuthService"
import { Empty } from "@shared/proto/cline/common"
import type { EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/**
 * Handles the account logout action
 * @param controller The controller instance
 * @param _request The empty request object
 * @returns Empty response
 */
export async function accountLogoutClicked(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	await controller.handleSignOut()
	await AuthService.getInstance().handleDeauth()
	return Empty.create({})
}
