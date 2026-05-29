import { UserOrganization, UserOrganizationsResponse } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

/**
 * Handles fetching all user credits data (balance, usage, payments)
 * @param controller The controller instance
 * @param request Empty request
 * @returns User credits data response
 */
export async function getUserOrganizations(controller: Controller, _request: EmptyRequest): Promise<UserOrganizationsResponse> {
	try {
		if (!controller.accountService) {
			throw new Error("Account service not available")
		}

		// Fetch user organizations from the account service
		const organizations = await controller.accountService.fetchUserOrganizationsRPC()

		return UserOrganizationsResponse.create({
			organizations:
				organizations?.map((org) =>
					UserOrganization.create({
						active: org.active,
						memberId: org.memberId,
						name: org.name,
						organizationId: org.organizationId,
						roles: org.roles ? [...org.roles] : [],
					}),
				) || [],
		})
	} catch (error) {
		throw error
	}
}
