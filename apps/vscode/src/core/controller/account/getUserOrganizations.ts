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
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		if (!controller.accountService) {
			throw new Error("Account service not available")
		}

		// Fetch user organizations from the account service
		const organizations = await Promise.race([
			controller.accountService.fetchUserOrganizationsRPC(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Account confirmation timed out. Check your connection and try again.")),
					10_000,
				)
			}),
		])
		if (!organizations) throw new Error("Could not confirm the active account. Check your connection and try again.")

		return UserOrganizationsResponse.create({
			organizations:
				organizations?.map((org: any) =>
					UserOrganization.create({
						active: org.active,
						memberId: org.memberId,
						name: org.name,
						organizationId: org.organizationId,
						roles: org.roles ? [...org.roles] : [],
					}),
				) || [],
		})
	} finally {
		clearTimeout(timer)
	}
}
