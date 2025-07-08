import type { Controller } from "../index"
import { Empty } from "@shared/proto/common"
import { UserOrganizationUpdateRequest } from "@shared/proto/account"

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

		return Empty.create({})
	} catch (error) {
		throw error
	}
}
