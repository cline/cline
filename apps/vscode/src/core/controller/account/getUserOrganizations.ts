import { UserOrganizationsResponse } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function getUserOrganizations(_controller: Controller, _request: EmptyRequest): Promise<UserOrganizationsResponse> {
	return UserOrganizationsResponse.create({})
}
