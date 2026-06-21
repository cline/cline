import { GetOrganizationCreditsRequest, OrganizationCreditsData } from "@shared/proto/cline/account"
import type { Controller } from "../index"

export async function getOrganizationCredits(
	_controller: Controller,
	_request: GetOrganizationCreditsRequest,
): Promise<OrganizationCreditsData> {
	return OrganizationCreditsData.create({})
}
