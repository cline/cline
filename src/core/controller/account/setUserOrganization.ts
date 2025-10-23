import { UserOrganizationUpdateRequest } from "@shared/proto/cline/account"
import { Empty } from "@shared/proto/cline/common"
import { fetchRemoteConfig } from "@/core/storage/remote-config/fetch"
import type { Controller } from "../index"

/**
 * Handles setting the user's active organization
 * @param controller The controller instance
 * @param request UserOrganization to set as active
 * @returns Empty response
 */
export async function setUserOrganization(controller: Controller, request: UserOrganizationUpdateRequest): Promise<Empty> {
	try {
		if (!controller.accountService) {
			throw new Error("Account service not available")
		}
		// Switch to the specified organization using the account service
		await controller.accountService.switchAccount(request.organizationId)
		await fetchRemoteConfig(controller)
		return {}
	} catch (error) {
		throw error
	}
}
